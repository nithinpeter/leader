import { performReplyCheck, type SentRef } from '../server/inbox-core'
import { performExtraction } from '../server/extract-core'
import { performGeneration } from '../server/generate-core'
import type { SendInput } from '../server/email-core'
import { draftFollowUp, draftReply, FOLLOW_UP_ANGLES, MAX_FOLLOW_UPS } from './sequence'
import { leadEmail, type InboundEmail, type Lead, type OutreachEmail } from '../lib/types'

/**
 * Storage the cycle needs. The app reaches Firestore as the signed-in user and
 * the cron reaches it as a service account, so the cycle takes whichever.
 */
export interface LeadStore {
  list(): Promise<Lead[]>
  update(id: string, patch: Partial<Lead>): Promise<void>
}

export interface CycleAction {
  leadId: string
  company: string
  to: string
  kind: 'cold' | 'reply' | 'follow_up' | 'stopped'
  detail: string
}

export interface CycleReport {
  ranAt: string
  leadsConsidered: number
  inboundRecorded: number
  coldSent: number
  repliesSent: number
  followUpsSent: number
  stopped: number
  actions: CycleAction[]
  errors: string[]
}

/**
 * How many first-contact emails one run may send when nothing else is set.
 * A lead finder can drop fifty leads in at once; the mailbox's reputation
 * cannot absorb fifty cold emails in one burst, so the rest wait for the
 * next half-hourly run.
 */
export const DEFAULT_COLD_PER_RUN = 3

function sentEmails(lead: Lead): OutreachEmail[] {
  return (lead.emails ?? []).filter((e) => e.kind !== 'reply')
}

function followUpsSoFar(lead: Lead): number {
  return (lead.emails ?? []).filter((e) => e.kind === 'follow_up').length
}

function lastOutboundAt(lead: Lead): number {
  const times = (lead.emails ?? []).map((e) => new Date(e.sentAt).getTime())
  return times.length ? Math.max(...times) : 0
}

/** Inbound we have not already answered with an outbound reply. */
function unansweredReplies(lead: Lead): InboundEmail[] {
  const answered = new Set(
    (lead.emails ?? [])
      .filter((e) => e.kind === 'reply' && e.inReplyTo)
      .map((e) => e.inReplyTo as string),
  )
  return (lead.replies ?? []).filter(
    (r) => r.kind === 'reply' && !answered.has(r.messageId),
  )
}

/**
 * One full pass: read the mailbox, record what came back, answer anyone who
 * wrote to us, make first contact with anyone never emailed, and move the
 * sequence along for anyone who has gone quiet.
 *
 * A lead finder can add a lead with nothing but a URL; this pass does whatever
 * research is still missing (extraction, then generation) before the first
 * email, writing the same shapes the app writes so the lead page shows it all.
 *
 * Never emails a lead marked doNotContact, never answers anything that is not a
 * person writing back, and sends at most one email per lead per run.
 */
export async function runCycle(opts: {
  store: LeadStore
  /** Injected so a dry run can draft everything without emailing a prospect. */
  send: (input: SendInput) => Promise<{ messageId: string; from: string }>
  /** Called after every automated send, before the next lead is handled. */
  notify: (action: CycleAction, email: { subject: string; body: string }) => Promise<void>
  /** Cap on first-contact emails per run. 0 turns first contact off. */
  maxColdPerRun?: number
  now?: Date
}): Promise<CycleReport> {
  const { store, send, notify } = opts
  const maxColdPerRun = opts.maxColdPerRun ?? DEFAULT_COLD_PER_RUN
  const now = opts.now ?? new Date()
  const report: CycleReport = {
    ranAt: now.toISOString(),
    leadsConsidered: 0,
    inboundRecorded: 0,
    coldSent: 0,
    repliesSent: 0,
    followUpsSent: 0,
    stopped: 0,
    actions: [],
    errors: [],
  }

  const leads = await store.list()
  report.leadsConsidered = leads.length

  // 1. Read the mailbox once for every lead we are waiting on.
  const sent: SentRef[] = leads.flatMap((lead) =>
    (lead.emails ?? []).map((e) => ({
      leadId: lead.id,
      messageId: e.messageId,
      to: e.to,
      sentAt: e.sentAt,
    })),
  )

  const byLead = new Map<string, InboundEmail[]>()
  if (sent.length) {
    const { found } = await performReplyCheck(sent)
    for (const { leadId, reply } of found) {
      byLead.set(leadId, [...(byLead.get(leadId) ?? []), reply])
    }
  }

  // 2. Record it, then decide what each lead needs.
  for (const lead of leads) {
    try {
      const incoming = byLead.get(lead.id) ?? []
      const known = new Set((lead.replies ?? []).map((r) => r.messageId))
      const fresh = incoming.filter((r) => !known.has(r.messageId))

      let current: Lead = lead
      if (fresh.length) {
        const replies = [...(lead.replies ?? []), ...fresh].sort((a, b) =>
          a.receivedAt.localeCompare(b.receivedAt),
        )
        const patch: Partial<Lead> = { replies }

        // Asked to stop, or the address is dead. Either way we are done here.
        const optOut = fresh.find((r) => r.kind === 'opt_out')
        const bounce = fresh.find((r) => r.kind === 'bounce')
        if (optOut) {
          patch.doNotContact = true
          patch.doNotContactReason = `Asked us to stop on ${optOut.receivedAt.slice(0, 10)}.`
          patch.status = 'lost'
        } else if (bounce) {
          patch.doNotContact = true
          patch.doNotContactReason = `Mail to ${bounce.from} bounced. The address is wrong.`
        } else if (
          fresh.some((r) => r.kind === 'reply') &&
          ['new', 'researched', 'doc_ready', 'contacted'].includes(lead.status)
        ) {
          patch.status = 'in_conversation'
        }

        await store.update(lead.id, patch)
        current = { ...lead, ...patch }
        report.inboundRecorded += fresh.length

        if (optOut || bounce) {
          report.stopped++
          report.actions.push({
            leadId: lead.id,
            company: lead.companyName,
            to: (optOut ?? bounce)!.from,
            kind: 'stopped',
            detail: patch.doNotContactReason ?? 'Stopped.',
          })
          continue
        }
      }

      // Nothing else may email this lead, on the cron or by hand.
      if (current.doNotContact) continue

      // 3a. Never emailed. Finish the research if the lead finder only left a
      // URL, then send the first email. Statuses past doc_ready mean a person
      // moved the lead along by hand, so the cold email is not ours to send.
      if (!sentEmails(current).length) {
        if (!['new', 'researched', 'doc_ready'].includes(current.status)) continue
        if (report.coldSent >= maxColdPerRun) continue

        let extraction = current.extraction
        if (!extraction) {
          extraction = await performExtraction(current.url)
          const patch: Partial<Lead> = { extraction }
          if (current.status === 'new') patch.status = 'researched'
          await store.update(current.id, patch)
          current = { ...current, ...patch }
        }

        let proposition = current.proposition
        if (!proposition) {
          proposition = await performGeneration(extraction)
          await store.update(current.id, { proposition, status: 'doc_ready' })
          current = { ...current, proposition, status: 'doc_ready' }
        }

        // The template draft only exists so the app runs without an API key.
        // It is generic by design and must never reach a prospect; the lead
        // stays at doc_ready for a person to email by hand.
        if (proposition.model === 'template-fallback') continue

        const draft = proposition.email
        const coldTo = leadEmail(current)
        if (!draft || !coldTo) continue

        const result = await send({
          to: coldTo,
          subject: draft.subject,
          body: draft.body,
          inReplyTo: null,
        })
        const record: OutreachEmail = {
          to: coldTo,
          subject: draft.subject,
          body: draft.body,
          sentAt: now.toISOString(),
          sentBy: 'automation',
          messageId: result.messageId,
          // The first touch. Follow-ups count from here.
          kind: 'cold',
          auto: true,
          inReplyTo: null,
        }
        await store.update(current.id, {
          emails: [...(current.emails ?? []), record],
          status: 'contacted',
          lastAutomatedAt: now.toISOString(),
        })
        report.coldSent++
        const action: CycleAction = {
          leadId: current.id,
          company: current.companyName,
          to: coldTo,
          kind: 'cold',
          detail: 'First email',
        }
        report.actions.push(action)
        await notify(action, { subject: draft.subject, body: draft.body })
        continue
      }

      // A hand-set address wins over where the thread went so far: it exists
      // precisely because somebody decided the earlier address was wrong.
      const to =
        current.contactEmail?.trim() ||
        sentEmails(current)[0]?.to ||
        current.extraction?.emails[0]
      if (!to) continue

      // 3b. Somebody wrote back. Answering them beats everything else.
      const waiting = unansweredReplies(current)
      if (waiting.length) {
        const answering = waiting[waiting.length - 1]
        const draft = await draftReply(current, answering)
        // The branded footer goes on at send time; the record keeps the draft.
        const body = draft.body
        const result = await send({
          to: answering.from,
          subject: draft.subject,
          body,
          inReplyTo: `<${answering.messageId}>`,
        })
        const record: OutreachEmail = {
          to: answering.from,
          subject: draft.subject,
          body,
          sentAt: now.toISOString(),
          sentBy: 'automation',
          messageId: result.messageId,
          kind: 'reply',
          auto: true,
          inReplyTo: answering.messageId,
        }
        await store.update(current.id, {
          emails: [...(current.emails ?? []), record],
          lastAutomatedAt: now.toISOString(),
        })
        report.repliesSent++
        const action: CycleAction = {
          leadId: current.id,
          company: current.companyName,
          to: answering.from,
          kind: 'reply',
          detail: `Answered "${answering.subject}"`,
        }
        report.actions.push(action)
        await notify(action, { subject: draft.subject, body })
        continue
      }

      // 3c. Gone quiet. Move the sequence along if it is due.
      const done = followUpsSoFar(current)
      if (done >= MAX_FOLLOW_UPS) continue
      if ((current.replies ?? []).some((r) => r.kind === 'reply')) continue

      const waitDays = FOLLOW_UP_ANGLES[done].afterDays
      const dueAt = lastOutboundAt(current) + waitDays * 24 * 60 * 60 * 1000
      if (now.getTime() < dueAt) continue

      const step = done + 1
      const draft = await draftFollowUp(current, step)
      const body = draft.body
      const first = sentEmails(current)[0]
      const result = await send({
        to,
        subject: draft.subject,
        body,
        inReplyTo: first ? `<${first.messageId.replace(/^<|>$/g, '')}>` : null,
      })
      const record: OutreachEmail = {
        to,
        subject: draft.subject,
        body,
        sentAt: now.toISOString(),
        sentBy: 'automation',
        messageId: result.messageId,
        kind: 'follow_up',
        auto: true,
        inReplyTo: first?.messageId ?? null,
      }
      await store.update(current.id, {
        emails: [...(current.emails ?? []), record],
        lastAutomatedAt: now.toISOString(),
      })
      report.followUpsSent++
      const action: CycleAction = {
        leadId: current.id,
        company: current.companyName,
        to,
        kind: 'follow_up',
        detail: `Follow-up ${step} of ${MAX_FOLLOW_UPS}`,
      }
      report.actions.push(action)
      await notify(action, { subject: draft.subject, body })
    } catch (e) {
      report.errors.push(
        `${lead.companyName}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  return report
}
