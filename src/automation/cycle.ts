import { performReplyCheck, type SentRef } from '../server/inbox-core'
import type { SendInput } from '../server/email-core'
import { draftFollowUp, draftReply, FOLLOW_UP_ANGLES, MAX_FOLLOW_UPS } from './sequence'
import type { InboundEmail, Lead, OutreachEmail } from '../lib/types'

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
  kind: 'reply' | 'follow_up' | 'stopped'
  detail: string
}

export interface CycleReport {
  ranAt: string
  leadsConsidered: number
  inboundRecorded: number
  repliesSent: number
  followUpsSent: number
  stopped: number
  actions: CycleAction[]
  errors: string[]
}

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
 * wrote to us, and move the sequence along for anyone who has gone quiet.
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
  now?: Date
}): Promise<CycleReport> {
  const { store, send, notify } = opts
  const now = opts.now ?? new Date()
  const report: CycleReport = {
    ranAt: now.toISOString(),
    leadsConsidered: 0,
    inboundRecorded: 0,
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

      // A hand-set address wins over where the thread went so far: it exists
      // precisely because somebody decided the earlier address was wrong.
      const to =
        current.contactEmail?.trim() ||
        sentEmails(current)[0]?.to ||
        current.extraction?.emails[0]
      if (!to) continue

      // 3a. Somebody wrote back. Answering them beats everything else.
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

      // 3b. Gone quiet. Move the sequence along if it is due.
      const done = followUpsSoFar(current)
      if (done >= MAX_FOLLOW_UPS) continue
      if ((current.replies ?? []).some((r) => r.kind === 'reply')) continue
      if (!sentEmails(current).length) continue

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
