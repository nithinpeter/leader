import { createHash } from 'node:crypto'
import { http, type Request, type Response } from '@google-cloud/functions-framework'
import { FieldValue } from 'firebase-admin/firestore'
import { z } from 'zod'
import { performSend } from '../../packages/core/src/email-core'
import { performExtraction } from '../../packages/core/src/extract-core'
import { performGeneration } from '../../packages/core/src/generate-core'
import type {
  ContactRequest,
  Lead,
  Proposition,
  SiteExtraction,
} from '../../packages/core/src/types'
import { db } from './firebase'
import { guardedFetch, parsePublicUrl } from './safe-fetch'

/**
 * The public API behind westringia.com's contact page, deployed as
 * `leader-westringia` with unauthenticated invoke. Two POST routes:
 *
 *   /research  - the visitor names their website, leaves their email and ticks
 *                consent; they get the same first look the CRM would produce.
 *                An already-researched lead answers from what is stored; a new
 *                site runs the normal extraction + generation pipeline. Either
 *                way the visit lands on a lead in the `leads` collection.
 *   /enquiry   - the contact form. Appends to the lead the research created
 *                (or finds/creates one) and emails whoever reads the inbox.
 *
 * Everything a visitor controls is treated as hostile: URLs fetch through the
 * SSRF guard, all strings echoed back are stripped and capped, and the raw
 * network address is never stored - only a salted daily hash.
 */

// Where a no-JS form post lands after the enquiry stores, and where one lands
// when it could not be stored. The static site owns both pages; this API only
// knows the addresses. A urlencoded post must never end on raw JSON.
const SENT_URL = 'https://westringia.com/contact/sent'
const PROBLEM_URL = 'https://westringia.com/contact/problem'

// The exact sentences the visitor agrees to, stored on the lead as proof of
// consent. The contact page renders the same words beside the checkbox; if
// either changes, change both.
const RESEARCH_CONSENT_TEXT =
  'You may email me about this read of my website. A person replies; there is no mailing list.'
const ENQUIRY_CONSENT_TEXT =
  'Sent the contact form asking for a reply from a person.'

const OFFLINE_MSG = 'The website reader is not available right now'
const BAD_ADDRESS_MSG =
  "That doesn't look like a website address. Check it and try again."
const UNREADABLE_MSG =
  "We couldn't read that site. Some sites block readers like ours, and some are mostly pictures."
const NO_SENSE_MSG = 'We could not make sense of that website.'
const RATE_MSG =
  'That is a lot of goes in a short time, so we have paused this for a while. Email or ring instead – both reach the same people.'

const ALLOWED_ORIGINS = new Set([
  'https://westringia.com',
  'https://www.westringia.com',
])

function applyCors(req: Request, res: Response): void {
  const origin = req.get('origin')
  const allowed =
    origin && (ALLOWED_ORIGINS.has(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin))
  if (!allowed) return
  res.set('access-control-allow-origin', origin)
  res.set('vary', 'Origin')
  res.set('access-control-allow-methods', 'POST, OPTIONS')
  res.set('access-control-allow-headers', 'content-type')
  // Lets the contact page read the real 429 cooldown instead of guessing one.
  res.set('access-control-expose-headers', 'retry-after')
  res.set('access-control-max-age', '86400')
}

// ---------------------------------------------------------------------------
// Abuse controls. Per-instance state is best-effort by design: the function
// scales to a handful of instances at most, and the worst case is a caller
// getting a few extra goes - the daily fuse and Gemini's own quota still cap
// the spend.

// The LAST x-forwarded-for entry is the one Google's front end appended - the
// only one a client cannot choose.
function clientKey(req: Request): string {
  const forwarded = req.get('x-forwarded-for') ?? ''
  const entries = forwarded.split(',').map((e) => e.trim()).filter(Boolean)
  return entries[entries.length - 1] || req.ip || 'unknown'
}

interface RateWindow {
  count: number
  resetAt: number
}

function createRateLimiter(options: { max: number; windowMs: number; name: string }) {
  const windows = new Map<string, RateWindow>()
  return {
    /** Seconds until the caller may try again - 0 when the request is allowed. */
    check(req: Request): number {
      const now = Date.now()
      if (windows.size >= 10_000) {
        for (const [key, win] of windows) {
          if (win.resetAt <= now) windows.delete(key)
        }
      }
      const key = `${options.name}:${clientKey(req)}`
      const win = windows.get(key)
      if (!win || win.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + options.windowMs })
        return 0
      }
      win.count += 1
      if (win.count <= options.max) return 0
      return Math.max(1, Math.ceil((win.resetAt - now) / 1000))
    },
  }
}

const researchLimit = createRateLimiter({ max: 5, windowMs: 3_600_000, name: 'research' })
const enquiryLimit = createRateLimiter({ max: 10, windowMs: 3_600_000, name: 'enquiry' })

// Global daily fuse on Gemini spend for this surface: over the cap, the route
// goes 503 and the page falls back to its plain email + phone floor.
let fuseDate = ''
let fuseCount = 0
function underDailyCap(): boolean {
  const cap = Number(process.env.CONTACT_DAILY_RESEARCH_CAP ?? 300)
  const today = new Date().toISOString().slice(0, 10)
  if (today !== fuseDate) {
    fuseDate = today
    fuseCount = 0
  }
  if (fuseCount >= cap) return false
  fuseCount += 1
  return true
}

// Salted with the server-side secret: a bare sha256(ip:date) can be
// brute-forced across the IPv4 space by anyone who can read the collection,
// which would break the privacy page's "scrambled form" promise.
function hashIp(req: Request): string {
  const day = new Date().toISOString().slice(0, 10)
  const salt = process.env.CRON_SECRET ?? ''
  return createHash('sha256')
    .update(`${salt}:${clientKey(req)}:${day}`)
    .digest('hex')
}

// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const researchSchema = z.object({
  url: z.string().min(1).max(300),
  email: z.string().trim().max(200).regex(EMAIL_RE),
  consent: z.literal(true),
})

// "Email or phone" is one field on the form; accept either shape.
function isReachable(reply: string): boolean {
  if (EMAIL_RE.test(reply)) return true
  const digits = reply.replace(/[\s()+-]/g, '')
  return /^\d{8,}$/.test(digits)
}

const enquirySchema = z.object({
  name: z.string().trim().min(1).max(120),
  reply: z.string().trim().min(1).max(200),
  slow: z.string().trim().min(1).max(2000),
  business: z.string().trim().max(120).optional(),
  website: z.string().trim().max(300).optional(),
  callTimes: z.string().trim().max(200).optional(),
  leadId: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9_-]*$/)
    .optional(),
  pickedJob: z.string().trim().max(120).optional(),
  // Honeypot. Real visitors never see it; bots helpfully fill it in.
  company_website: z.string().optional(),
})

// Belt-and-braces: the page renders via textContent, but markup has no
// business in this data either way.
function publicText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Firestore rejects undefined values, so optional fields must be absent. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T
}

function appendNote(notes: string | undefined, line: string): string {
  const existing = (notes ?? '').trim()
  return existing ? `${existing}\n\n${line}` : line
}

/** A proposition the contact page may show; the template draft is generic by design. */
function usable(p: Proposition | undefined): p is Proposition {
  return Boolean(p && p.model !== 'template-fallback')
}

interface FoundLead {
  ref: FirebaseFirestore.DocumentReference
  lead: Omit<Lead, 'id'>
}

/**
 * "Already processed" is matched on domain, the same normalisation the
 * extractor and the bulk import use. Prefers the doc that already has research
 * so a duplicate shell never shadows the finished lead.
 */
async function findLeadByDomain(domain: string): Promise<FoundLead | null> {
  const snap = await db.collection('leads').where('domain', '==', domain).limit(10).get()
  if (snap.empty) return null
  const docs = snap.docs.map((d) => ({ ref: d.ref, lead: d.data() as Omit<Lead, 'id'> }))
  return (
    docs.find((d) => usable(d.lead.proposition)) ??
    docs.find((d) => d.lead.extraction) ??
    docs[0]
  )
}

function appUrl(leadId: string): string {
  const base = (process.env.APP_URL || '').replace(/\/$/, '')
  return base ? `${base}/leads/${leadId}` : `lead ${leadId}`
}

/**
 * Tells a person a lead just walked in. Best-effort on purpose: the lead is
 * already stored, and a mail hiccup must not turn a stored enquiry into an
 * error page. The body is visitor-written text - fine in a plain-text email,
 * but escape it before any richer format.
 */
async function notify(subject: string, lines: string[]): Promise<void> {
  const to = process.env.NOTIFY_EMAIL || process.env.SMTP_USER
  if (!to) {
    console.warn('Contact-page activity stored with no notification path configured')
    return
  }
  try {
    await performSend({
      to,
      subject,
      body: lines.join('\n'),
      noCopy: true,
      plain: true,
    })
  } catch (e) {
    console.error('Contact-page notification failed:', e)
  }
}

// ---------------------------------------------------------------------------

async function research(req: Request, res: Response): Promise<void> {
  const retryAfter = researchLimit.check(req)
  if (retryAfter > 0) {
    res
      .status(429)
      .set('retry-after', String(retryAfter))
      .json({ error: RATE_MSG, retryAfter })
    return
  }

  const parsed = researchSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    // Name the field that actually failed, so a two-second edit is not
    // misdiagnosed as a broken tool.
    const failed = new Set(parsed.error.issues.map((i) => i.path[0]))
    res.status(400).json({
      error: failed.has('consent')
        ? 'Tick the box that says we may email you, and this can run.'
        : failed.has('email')
          ? "That doesn't look like an email address. Check it and try again."
          : BAD_ADDRESS_MSG,
    })
    return
  }

  const url = parsePublicUrl(parsed.data.url)
  if (!url) {
    res.status(400).json({ error: BAD_ADDRESS_MSG })
    return
  }
  const email = parsed.data.email.trim().toLowerCase()
  const domain = url.hostname.replace(/^www\./, '').toLowerCase()

  const existing = await findLeadByDomain(domain)
  let extraction: SiteExtraction | undefined = existing?.lead.extraction
  let proposition: Proposition | undefined = usable(existing?.lead.proposition)
    ? existing?.lead.proposition
    : undefined
  const reused = Boolean(proposition)

  if (!proposition) {
    // The public page must never show the generic template draft, so no key
    // means the reader is off, same as the fuse being spent.
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY || !underDailyCap()) {
      res.status(503).json({ error: OFFLINE_MSG })
      return
    }
    if (!extraction) {
      try {
        extraction = await performExtraction(url.href, guardedFetch)
      } catch (e) {
        console.error(`Contact research could not read ${domain}:`, e)
        res.status(422).json({ error: UNREADABLE_MSG })
        return
      }
    }
    try {
      proposition = await performGeneration(extraction)
    } catch (e) {
      console.error(`Contact research could not generate for ${domain}:`, e)
      res.status(422).json({ error: NO_SENSE_MSG })
      return
    }
  }

  const now = new Date().toISOString()
  const request: ContactRequest = {
    kind: 'research',
    at: now,
    email,
    consent: { text: RESEARCH_CONSENT_TEXT, at: now, ipHash: hashIp(req) },
  }
  const noteLine = `Contact page, ${now.slice(0, 10)}: asked for a first look at ${domain} and agreed to be emailed (${email}).`

  let leadId: string
  let companyName = extraction?.companyName || existing?.lead.companyName || domain
  if (existing) {
    companyName = existing.lead.companyName || companyName
    const patch: Record<string, unknown> = {
      contactRequests: [...(existing.lead.contactRequests ?? []), request],
      notes: appendNote(existing.lead.notes, noteLine),
      updatedAt: now,
    }
    if (!existing.lead.contactEmail?.trim()) patch.contactEmail = email
    if (!existing.lead.extraction && extraction) {
      patch.extraction = extraction
      patch.domain = extraction.domain
      patch.companyName = extraction.companyName
      companyName = extraction.companyName
    }
    if (!usable(existing.lead.proposition)) {
      // This visit finished the research a queued import would have done, so
      // it finishes the bookkeeping the same way importLead does.
      patch.proposition = proposition
      patch.importState = FieldValue.delete()
      patch.importError = FieldValue.delete()
      if (['new', 'researched'].includes(existing.lead.status)) {
        patch.status = 'doc_ready'
      }
    }
    await existing.ref.set(patch, { merge: true })
    leadId = existing.ref.id
  } else {
    const doc: Omit<Lead, 'id'> = {
      url: url.href,
      domain: extraction?.domain ?? domain,
      companyName,
      status: 'doc_ready',
      notes: noteLine,
      createdBy: 'westringia-contact',
      createdAt: now,
      updatedAt: now,
      extraction,
      proposition,
      contactEmail: email,
      source: 'westringia-contact',
      contactRequests: [request],
    }
    const ref = await db.collection('leads').add(compact(doc as Record<string, unknown>))
    leadId = ref.id
  }

  await notify(`[Leader] Contact page: first look for ${domain}`, [
    `${email} asked for a first look at ${domain} and agreed to be emailed.`,
    reused
      ? 'Answered from research already on the lead.'
      : 'Fresh research ran for it.',
    '',
    `Lead: ${appUrl(leadId)}`,
  ])

  res.json({
    leadId,
    site: url.href,
    domain,
    companyName: publicText(companyName, 120),
    pagesRead: (extraction?.pagesCrawled ?? []).slice(0, 6),
    summary: publicText(proposition.companySummary, 800),
    software: (extraction?.techSignals ?? [])
      .map((s) => publicText(s, 40))
      .filter(Boolean)
      .slice(0, 6),
    jobs: (proposition.useCases ?? [])
      .map((u) => ({
        title: publicText(u.title, 80),
        problem: publicText(u.problem, 400),
        automation: publicText(u.automation, 400),
        impact: publicText(u.impact, 300),
      }))
      .filter((j) => j.title && j.problem)
      .slice(0, 3),
    mightBeWrong: publicText(proposition.whereWeMightBeWrong ?? '', 500),
    cached: reused,
  })
}

async function enquiry(req: Request, res: Response): Promise<void> {
  const isFormPost = (req.get('content-type') ?? '').includes(
    'application/x-www-form-urlencoded',
  )
  // A urlencoded post gets a redirect on EVERY outcome - success or failure -
  // because its sender has no script to read a JSON body and would otherwise
  // land on raw API output.
  const problem = () => res.redirect(303, PROBLEM_URL)
  const sent = () => res.redirect(303, SENT_URL)

  const retryAfter = enquiryLimit.check(req)
  if (retryAfter > 0) {
    if (isFormPost) return void problem()
    res
      .status(429)
      .set('retry-after', String(retryAfter))
      .json({ error: RATE_MSG, retryAfter })
    return
  }

  const parsed = enquirySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    if (isFormPost) return void problem()
    const replyFailed = parsed.error.issues.some((i) => i.path[0] === 'reply')
    res.status(400).json({
      error: replyFailed
        ? 'Tell us an email address or a phone number we can reach you on'
        : 'Name, a way to reach you, and what takes too long are all we need.',
    })
    return
  }
  const body = parsed.data
  if (!isReachable(body.reply)) {
    if (isFormPost) return void problem()
    res.status(400).json({
      error: 'Tell us an email address or a phone number we can reach you on',
    })
    return
  }

  // A filled honeypot succeeds outwardly and stores nothing.
  if (body.company_website) {
    if (isFormPost) return void sent()
    res.json({ ok: true })
    return
  }

  const now = new Date().toISOString()
  const email = EMAIL_RE.test(body.reply) ? body.reply.toLowerCase() : undefined
  const website = body.website ? parsePublicUrl(body.website) : null
  const websiteDomain = website
    ? website.hostname.replace(/^www\./, '').toLowerCase()
    : null

  // The lead the first look created rides along by id; failing that, match on
  // the website's domain. A bogus or aged-out id is silently ignored - an
  // enquiry never fails because a first look expired.
  let target: FoundLead | null = null
  if (body.leadId) {
    try {
      const snap = await db.collection('leads').doc(body.leadId).get()
      if (snap.exists) {
        target = { ref: snap.ref, lead: snap.data() as Omit<Lead, 'id'> }
      }
    } catch (e) {
      console.error('Contact enquiry lead lookup failed:', e)
    }
  }
  if (!target && websiteDomain) {
    target = await findLeadByDomain(websiteDomain)
  }

  const request: ContactRequest = compact({
    kind: 'enquiry',
    at: now,
    email,
    name: body.name,
    reply: body.reply,
    message: body.slow,
    business: body.business || undefined,
    callTimes: body.callTimes || undefined,
    pickedJob: body.pickedJob || undefined,
    consent: { text: ENQUIRY_CONSENT_TEXT, at: now, ipHash: hashIp(req) },
  }) as ContactRequest
  const noteLine = `Contact page, ${now.slice(0, 10)}: ${body.name} wrote in (${body.reply}). "${body.slow.slice(0, 300)}"`

  let leadId: string
  if (target) {
    const patch: Record<string, unknown> = {
      contactRequests: [...(target.lead.contactRequests ?? []), request],
      notes: appendNote(target.lead.notes, noteLine),
      updatedAt: now,
    }
    if (!target.lead.contactEmail?.trim() && email) patch.contactEmail = email
    // Somebody wrote to us: the lead is a conversation now, wherever the
    // pipeline had it. Statuses a person set past that point stay put.
    if (['new', 'researched', 'doc_ready', 'contacted'].includes(target.lead.status)) {
      patch.status = 'in_conversation'
    }
    await target.ref.set(patch, { merge: true })
    leadId = target.ref.id
  } else {
    const doc: Omit<Lead, 'id'> = {
      url: website?.href ?? '',
      domain: websiteDomain ?? '',
      companyName: body.business || body.name,
      status: 'in_conversation',
      notes: noteLine,
      createdBy: 'westringia-contact',
      createdAt: now,
      updatedAt: now,
      contactEmail: email,
      source: 'westringia-contact',
      contactRequests: [request],
    }
    const ref = await db.collection('leads').add(compact(doc as Record<string, unknown>))
    leadId = ref.id
  }

  // The same-day-reply promise needs a human to actually see the message.
  await notify(`[Leader] Enquiry from ${body.name}`, [
    body.slow,
    '',
    `Name: ${body.name}`,
    `Reach them on: ${body.reply}`,
    ...(body.business ? [`Business: ${body.business}`] : []),
    ...(body.website ? [`Website: ${body.website}`] : []),
    ...(body.callTimes ? [`Good times to ring: ${body.callTimes}`] : []),
    ...(body.pickedJob ? [`Picked from the first look: ${body.pickedJob}`] : []),
    '',
    `Lead: ${appUrl(leadId)}`,
  ])

  if (isFormPost) return void sent()
  res.json({ ok: true })
}

/**
 * One public entry point, routed on path. Deployed with
 * --allow-unauthenticated on purpose - anonymous visitors are the audience -
 * so everything above treats the caller as hostile.
 */
http('westringia', async (req, res) => {
  applyCors(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }
  const path = (req.path || '/').replace(/\/+$/, '')
  try {
    if (path.endsWith('/research')) await research(req, res)
    else if (path.endsWith('/enquiry')) await enquiry(req, res)
    else res.status(404).json({ error: 'Not found' })
  } catch (e) {
    console.error('westringia handler failed:', e)
    if (res.headersSent) return
    if ((req.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
      res.redirect(303, PROBLEM_URL)
    } else {
      res.status(500).json({ error: 'Something went wrong at our end.' })
    }
  }
})
