import { performReplyCheck, type SentRef } from '../inbox-core'
import { performExtraction } from '../extract-core'
import { performGeneration } from '../generate-core'
import type { SendInput } from '../email-core'
import { verifyEmailAddress } from '../verify-email'
import { draftFollowUp, draftReply, FOLLOW_UP_ANGLES, MAX_FOLLOW_UPS } from './sequence'
import {
  dailyCap,
  dayKey,
  inMemoryLedger,
  stateForToday,
  type WarmupLedger,
  type WarmupState,
} from './warmup'
import {
  leadEmail,
  type EmailCheck,
  type InboundEmail,
  type Lead,
  type OutreachEmail,
} from '../types'

/**
 * Storage the cycle needs. The app reaches Firestore as the signed-in user and
 * the cron reaches it as a service account, so the cycle takes whichever.
 */
export interface LeadStore {
  list(): Promise<Lead[]>
  update(id: string, patch: Partial<Lead>): Promise<void>
  /** Deletes the lead outright. Used when a send attempt to them errors. */
  remove(id: string): Promise<void>
}

export interface CycleAction {
  leadId: string
  company: string
  to: string
  kind: 'cold' | 'reply' | 'follow_up' | 'stopped' | 'unverified' | 'removed'
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
  /** Leads deleted because the attempt to email them errored. */
  removed: number
  /** Addresses the pre-send check rejected outright. Nothing was sent to them. */
  unverified: number
  /** Checks that could not complete, usually DNS. Those leads wait for the next run. */
  checksUnavailable: number
  /** Today's marketing allowance, and how much of it is gone. */
  dailyCap: number
  sentToday: number
  /** Leads that were due an email and did not get one because the day is spent. */
  heldByCap: number
  actions: CycleAction[]
  errors: string[]
}

/**
 * How many first-contact emails one run may send when nothing else is set.
 * A lead finder can drop fifty leads in at once; the mailbox's reputation
 * cannot absorb fifty cold emails in one burst, so the rest wait for the
 * next half-hourly run. The daily allowance in warmup.ts is the other half of
 * this: it limits the day, where this limits the burst.
 */
export const DEFAULT_COLD_PER_RUN = 3

/**
 * How long a good verdict stands before the address is checked again. A domain
 * that dies mid-sequence is rare and a bounce catches it anyway, so this is
 * about not letting a months-old verdict speak for an address rather than
 * about catching anything quickly.
 */
const CHECK_STALE_AFTER_DAYS = 30

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
 *
 * Two things gate every marketing email: the address has to survive a pre-send
 * check, and the day's allowance has to have room left in it. Replies pass
 * both, because a person waiting on an answer is not marketing.
 *
 * A contact attempt that errors deletes the lead. Errors before any send, in
 * research, drafting or the address check, leave the lead for the next run.
 */
export async function runCycle(opts: {
  store: LeadStore
  /** Injected so a dry run can draft everything without emailing a prospect. */
  send: (input: SendInput) => Promise<{ messageId: string; from: string }>
  /**
   * Called when a person writes back, with what they sent. Replies are the
   * only thing worth an email; everything else the run does stays quiet.
   */
  notify: (lead: Lead, reply: InboundEmail) => Promise<void>
  /**
   * The day's marketing allowance. A dry run passes a throwaway one so the
   * cycle behaves exactly as it would with sending on without spending the
   * real budget. Omitted entirely, the allowance is not enforced across runs.
   */
  ledger?: WarmupLedger
  /** Injected for tests; the real one does DNS. */
  verify?: (address: string) => Promise<EmailCheck>
  /** Cap on first-contact emails per run. 0 turns first contact off. */
  maxColdPerRun?: number
  now?: Date
}): Promise<CycleReport> {
  const { store, send, notify } = opts
  const maxColdPerRun = opts.maxColdPerRun ?? DEFAULT_COLD_PER_RUN
  const verify = opts.verify ?? verifyEmailAddress
  const ledger = opts.ledger ?? inMemoryLedger()
  const now = opts.now ?? new Date()
  const report: CycleReport = {
    ranAt: now.toISOString(),
    leadsConsidered: 0,
    inboundRecorded: 0,
    coldSent: 0,
    repliesSent: 0,
    followUpsSent: 0,
    stopped: 0,
    removed: 0,
    unverified: 0,
    checksUnavailable: 0,
    dailyCap: 0,
    sentToday: 0,
    heldByCap: 0,
    actions: [],
    errors: [],
  }

  // The day's allowance, before anything else. A ledger we cannot read fails
  // closed: replies still go out, marketing does not. Guessing the count high
  // costs a day of outreach, guessing it low costs the domain.
  const today = dayKey(now)
  let warmup: WarmupState = { startedAt: today, day: today, sentToday: 0 }
  let cap = 0
  try {
    warmup = { ...stateForToday(await ledger.read(), today) }
    cap = dailyCap(warmup, today)
  } catch (e) {
    report.errors.push(
      `Could not read the sending allowance, so no marketing mail went out: ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
  }
  report.dailyCap = cap
  report.sentToday = warmup.sentToday

  /** Room left in the day for one more cold email or follow-up. */
  const roomToMarket = () => warmup.sentToday < cap

  /**
   * Spend one of the day's sends. Written straight through rather than
   * accumulated and saved at the end, because a run that times out halfway
   * must not forget what it already sent.
   *
   * A failed write must not throw: the email is already gone, and letting this
   * bubble up would skip the notification that tells a person what went out in
   * their name. The in-memory count still holds for the rest of the run, so
   * the worst case is that a later run repeats today's allowance.
   */
  async function recordMarketingSend(): Promise<void> {
    warmup = { ...warmup, sentToday: warmup.sentToday + 1, updatedAt: now.toISOString() }
    report.sentToday = warmup.sentToday
    try {
      await ledger.write(warmup)
    } catch (e) {
      report.errors.push(
        `Sent, but could not record it against today's allowance: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
  }

  /**
   * The pre-send check, reusing the stored verdict while it is for the same
   * address and still fresh. Keying on the address is what makes a bad verdict
   * self-healing: put a better address in `contactEmail` and the next run
   * checks that one instead.
   */
  async function checkAddress(lead: Lead, to: string): Promise<EmailCheck> {
    const address = to.trim().toLowerCase()
    const held = lead.emailCheck
    const fresh =
      held &&
      held.address === address &&
      now.getTime() - Date.parse(held.checkedAt) < CHECK_STALE_AFTER_DAYS * 86_400_000
    if (fresh) return held

    const check = await verify(address)
    // An unknown is our resolver failing, not their address being wrong.
    // Storing it would freeze a good address behind one bad DNS moment.
    if (check.result !== 'unknown') await store.update(lead.id, { emailCheck: check })
    return check
  }

  /** True when it is safe to send. Records the refusal when it is not. */
  async function addressUsable(lead: Lead, to: string): Promise<boolean> {
    const check = await checkAddress(lead, to)
    if (check.result === 'deliverable') return true
    if (check.result === 'unknown') {
      report.checksUnavailable++
      return false
    }
    report.unverified++
    report.actions.push({
      leadId: lead.id,
      company: lead.companyName,
      to,
      kind: 'unverified',
      detail: `Not emailed: ${check.reason}`,
    })
    return false
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
    // The address of a send that has been attempted and has not come back
    // clean. An error while this is set means the contact attempt itself
    // failed, and that removes the lead: retrying the same dead address
    // every half hour would never go anywhere.
    let attemptedTo: string | null = null
    const attempt: typeof send = async (input) => {
      attemptedTo = input.to
      const result = await send(input)
      attemptedTo = null
      return result
    }
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

        // A person wrote back. This is the one thing that emails the owner.
        for (const reply of fresh) {
          if (reply.kind === 'reply') await notify(current, reply)
        }

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
        // A lead that walked in through the contact page asked to hear from a
        // person; the cold sequence is not that. A human replies instead.
        if (current.source === 'westringia-contact') continue
        if (report.coldSent >= maxColdPerRun) continue
        // Before the crawl and the model call, not after: research we cannot
        // act on today is spend with nothing to show for it, and the lead is
        // still here on the next run.
        if (!roomToMarket()) {
          report.heldByCap++
          continue
        }

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
        if (!(await addressUsable(current, coldTo))) continue

        const result = await attempt({
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
        await recordMarketingSend()
        report.actions.push({
          leadId: current.id,
          company: current.companyName,
          to: coldTo,
          kind: 'cold',
          detail: 'First email',
        })
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
        const result = await attempt({
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
        report.actions.push({
          leadId: current.id,
          company: current.companyName,
          to: answering.from,
          kind: 'reply',
          detail: `Answered "${answering.subject}"`,
        })
        continue
      }

      // 3c. Gone quiet. Move the sequence along if it is due.
      const done = followUpsSoFar(current)
      if (done >= MAX_FOLLOW_UPS) continue
      if ((current.replies ?? []).some((r) => r.kind === 'reply')) continue

      const waitDays = FOLLOW_UP_ANGLES[done].afterDays
      const dueAt = lastOutboundAt(current) + waitDays * 24 * 60 * 60 * 1000
      if (now.getTime() < dueAt) continue

      // A follow-up is marketing too, and it spends from the same day. Both
      // gates go before the model call that drafts it.
      if (!roomToMarket()) {
        report.heldByCap++
        continue
      }
      if (!(await addressUsable(current, to))) continue

      const step = done + 1
      const draft = await draftFollowUp(current, step)
      const body = draft.body
      const first = sentEmails(current)[0]
      const result = await attempt({
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
      await recordMarketingSend()
      report.actions.push({
        leadId: current.id,
        company: current.companyName,
        to,
        kind: 'follow_up',
        detail: `Follow-up ${step} of ${MAX_FOLLOW_UPS}`,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      report.errors.push(`${lead.companyName}: ${message}`)

      // The contact attempt itself errored, so the lead goes. Errors before
      // any send (research, drafting, the address check) leave the lead in
      // place for the next run.
      if (attemptedTo) {
        try {
          await store.remove(lead.id)
          report.removed++
          report.actions.push({
            leadId: lead.id,
            company: lead.companyName,
            to: attemptedTo,
            kind: 'removed',
            detail: `Removed: emailing them failed (${message})`,
          })
        } catch (removeError) {
          report.errors.push(
            `${lead.companyName}: could not remove the lead after the failed send: ${
              removeError instanceof Error ? removeError.message : String(removeError)
            }`,
          )
        }
      }
    }
  }

  return report
}
