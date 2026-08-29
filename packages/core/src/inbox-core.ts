import { ImapFlow, type SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { InboundEmail, InboundKind } from './types'

// Spacemail (spaceship.com) IMAP, same mailbox and credentials as sending.
const IMAP_DEFAULTS = { host: 'mail.spacemail.com', port: 993 }

/** Most recent messages to look at in one check. */
const MAX_MESSAGES = 400
/** Per message. Enough for the headers, the reply, and a quoted original. */
const MAX_SOURCE_BYTES = 64 * 1024

function imapConfig() {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) return null
  return {
    host: process.env.IMAP_HOST || IMAP_DEFAULTS.host,
    port: Number(process.env.IMAP_PORT || IMAP_DEFAULTS.port),
    secure: true,
    auth: { user, pass },
  }
}

/** One outbound email we are waiting on, as the client knows it. */
export interface SentRef {
  leadId: string
  messageId: string
  to: string
  sentAt: string
}

/** `<abc@host>` and `abc@host` are the same id. Compare them the same way. */
function normaliseId(id: string): string {
  return id.trim().replace(/^<|>$/g, '').toLowerCase()
}

function allReferencedIds(headers: Map<string, unknown>): string[] {
  const out: string[] = []
  for (const key of ['in-reply-to', 'references']) {
    const raw = headers.get(key)
    const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(' ') : ''
    for (const m of text.matchAll(/<[^>]+>/g)) out.push(normaliseId(m[0]))
  }
  return out
}

function headerText(headers: Map<string, unknown>, key: string): string {
  const raw = headers.get(key)
  if (typeof raw === 'string') return raw.toLowerCase()
  if (Array.isArray(raw)) return raw.join(' ').toLowerCase()
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return String((raw as { value: unknown }).value).toLowerCase()
  }
  return ''
}

// Only unambiguous requests to stop. A plain "not interested" is a soft no and
// often comes qualified, so it stays an ordinary reply for a person to read.
const OPT_OUT =
  /\b(unsubscribe|opt[\s-]?out|remove me|take me off|stop emailing|don'?t (?:contact|email)|do not (?:contact|email))\b/i

export function classifyInbound(args: {
  from: string
  subject: string
  text: string
  headers: Map<string, unknown>
  contentType: string
}): InboundKind {
  const { from, subject, text, headers, contentType } = args

  // A bounce is the mail system talking, not the business.
  if (
    /(mailer-daemon|postmaster|no-?reply@.*(mail|smtp))/i.test(from) ||
    /report-type=delivery-status/i.test(contentType) ||
    /^(undeliverable|delivery status notification|returned mail|mail delivery failed)/i.test(
      subject,
    )
  ) {
    return 'bounce'
  }

  // An out of office threads exactly like a real reply. Nobody has read it.
  const autoSubmitted = headerText(headers, 'auto-submitted')
  const precedence = headerText(headers, 'precedence')
  if (
    (autoSubmitted && autoSubmitted !== 'no') ||
    headers.has('x-autoreply') ||
    headers.has('x-autorespond') ||
    ['bulk', 'auto_reply', 'junk'].includes(precedence) ||
    /^(out of office|automatic reply|auto[\s-]?reply|away from)/i.test(subject)
  ) {
    return 'auto_reply'
  }

  if (OPT_OUT.test(text)) return 'opt_out'
  return 'reply'
}

/** The first few lines they actually wrote, without the quoted thread. */
export function replySnippet(text: string): string {
  const lines = text.split(/\r?\n/)
  const own: string[] = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) break
    if (/^\s*(on .*wrote:|-{2,}\s*original message|from:\s)/i.test(line)) break
    own.push(line)
  }
  const cleaned = own.join('\n').replace(/\n{3,}/g, '\n\n').trim() || text.trim()
  return cleaned.length > 500 ? `${cleaned.slice(0, 500)}…` : cleaned
}

/**
 * Reads the outreach mailbox and returns anything that came back against the
 * emails we have sent. Opens INBOX read-only, so nothing is marked as read and
 * no flags change. Writing the results onto leads is the caller's job, because
 * Firestore is reached with the signed-in user's credentials on the client.
 */
export async function performReplyCheck(sent: SentRef[]): Promise<{
  found: Array<{ leadId: string; reply: InboundEmail }>
  scanned: number
}> {
  const config = imapConfig()
  if (!config) {
    throw new Error(
      'Reading replies is not set up. Set SMTP_USER and SMTP_PASS in .env (the same Spacemail mailbox that sends).',
    )
  }
  if (sent.length === 0) return { found: [], scanned: 0 }

  const byMessageId = new Map(sent.map((s) => [normaliseId(s.messageId), s.leadId]))
  const byAddress = new Map<string, string>()
  for (const s of sent) {
    const addr = s.to.trim().toLowerCase()
    // First send wins, so a shared address does not bounce between leads.
    if (addr && !byAddress.has(addr)) byAddress.set(addr, s.leadId)
  }

  // Look back to just before the earliest thing we are waiting on.
  const earliest = sent.reduce(
    (min, s) => Math.min(min, new Date(s.sentAt).getTime()),
    Date.now(),
  )
  const since = new Date(earliest - 24 * 60 * 60 * 1000)
  const ourAddress = config.auth.user.toLowerCase()

  const client = new ImapFlow({ ...config, logger: false })
  const found: Array<{ leadId: string; reply: InboundEmail }> = []
  let scanned = 0

  await client.connect()
  // Read-only: this is the user's real inbox and we are a guest in it.
  const lock = await client.getMailboxLock('INBOX', { readOnly: true })
  try {
    // Ask the server for candidates rather than downloading the whole window.
    // A TEXT search covers headers and body, so one clause per sent email finds
    // both a threaded reply and a bounce that quotes the original headers.
    const clauses: SearchObject[] = [
      ...[...byMessageId.keys()].map((id) => ({ text: id })),
      ...[...byAddress.keys()].map((addr) => ({ from: addr })),
    ]
    let uids: number[] = []
    try {
      const query: SearchObject =
        clauses.length === 1 ? { since, ...clauses[0] } : { since, or: clauses }
      uids = (await client.search(query, { uid: true })) || []
    } catch {
      // Some servers baulk at a long OR chain. Fall back to the date window.
      uids = (await client.search({ since }, { uid: true })) || []
    }
    // Bounded, newest first, so one click can never become a long download.
    uids = uids.slice(-MAX_MESSAGES)
    if (uids.length) {
      for await (const message of client.fetch(
        uids,
        // Partial fetch. Headers, the reply text and the quoted original all
        // sit near the top; the rest is usually an attachment we never read.
        { source: { maxLength: MAX_SOURCE_BYTES }, uid: true },
        { uid: true },
      )) {
        if (!message.source) continue
        scanned++
        const parsed = await simpleParser(message.source)
        const from = parsed.from?.value[0]?.address?.toLowerCase() ?? ''

        // Mail from our own address - notifications to ourselves, or the BCC
        // Sent copies older sends left behind - is not a reply.
        if (!from || from === ourAddress) continue

        const referenced = allReferencedIds(parsed.headers as Map<string, unknown>)
        const raw = message.source.toString('utf8')

        let leadId = referenced.map((id) => byMessageId.get(id)).find(Boolean)
        let matchedLoosely = false

        // A bounce quotes the original message rather than threading to it,
        // so look for one of our ids anywhere in the raw source.
        if (!leadId) {
          for (const [id, candidate] of byMessageId) {
            if (raw.toLowerCase().includes(id)) {
              leadId = candidate
              break
            }
          }
        }
        // Last resort: they started a fresh email instead of replying.
        if (!leadId) {
          leadId = byAddress.get(from)
          matchedLoosely = Boolean(leadId)
        }
        if (!leadId) continue

        const text = parsed.text ?? ''
        const subject = parsed.subject ?? '(no subject)'
        found.push({
          leadId,
          reply: {
            kind: classifyInbound({
              from,
              subject,
              text,
              headers: parsed.headers as Map<string, unknown>,
              contentType: String(parsed.headers.get('content-type') ?? ''),
            }),
            from,
            fromName: parsed.from?.value[0]?.name ?? '',
            subject,
            snippet: replySnippet(text),
            receivedAt: (parsed.date ?? new Date()).toISOString(),
            messageId: normaliseId(parsed.messageId ?? `${message.uid}@local`),
            inReplyTo: referenced[0] ?? null,
            matchedLoosely,
          },
        })
      }
    }
  } finally {
    lock.release()
    await client.logout()
  }

  return { found, scanned }
}

/** Whether the mailbox can be read at all. */
export function imapConfigured(): boolean {
  return imapConfig() !== null
}
