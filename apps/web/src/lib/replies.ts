import { checkReplies } from '../server/inbox'
import { updateLead } from './leads'
import type { InboundEmail, Lead } from '@leader/core/types'

export interface ReplySyncResult {
  /** Messages newly recorded against a lead. */
  added: number
  /** Of those, ones that need a person to act. */
  bounces: number
  optOuts: number
  /** Candidate messages the mailbox returned for our sent emails. */
  scanned: number
  /** Sent emails we are waiting on. */
  watched: number
  /** Leads that moved to in conversation because a human wrote back. */
  advanced: number
}

/**
 * Reads the outreach mailbox and records anything that came back.
 *
 * Deliberately does not decide anything: a bounce or an opt-out is recorded and
 * surfaced, never actioned. Only a genuine reply moves a lead, and only from
 * the statuses that sit before a conversation.
 */
export async function syncReplies(leads: Lead[]): Promise<ReplySyncResult> {
  const sent = leads.flatMap((lead) =>
    (lead.emails ?? []).map((email) => ({
      leadId: lead.id,
      messageId: email.messageId,
      to: email.to,
      sentAt: email.sentAt,
    })),
  )

  const result: ReplySyncResult = {
    added: 0,
    bounces: 0,
    optOuts: 0,
    scanned: 0,
    watched: sent.length,
    advanced: 0,
  }
  if (sent.length === 0) return result

  const { found, scanned } = await checkReplies({ data: { sent } })
  result.scanned = scanned

  const byLead = new Map<string, InboundEmail[]>()
  for (const { leadId, reply } of found) {
    byLead.set(leadId, [...(byLead.get(leadId) ?? []), reply])
  }

  for (const [leadId, incoming] of byLead) {
    const lead = leads.find((l) => l.id === leadId)
    if (!lead) continue

    const known = new Set((lead.replies ?? []).map((r) => r.messageId))
    const fresh = incoming.filter((r) => !known.has(r.messageId))
    if (fresh.length === 0) continue

    const replies = [...(lead.replies ?? []), ...fresh].sort((a, b) =>
      a.receivedAt.localeCompare(b.receivedAt),
    )

    // Only a person writing back is progress. A bounce means the opposite, and
    // an out of office means nothing yet.
    const humanReplied = fresh.some((r) => r.kind === 'reply')
    const advance =
      humanReplied && ['new', 'researched', 'doc_ready', 'contacted'].includes(lead.status)

    await updateLead(leadId, {
      replies,
      ...(advance ? { status: 'in_conversation' as const } : {}),
    })

    result.added += fresh.length
    result.bounces += fresh.filter((r) => r.kind === 'bounce').length
    result.optOuts += fresh.filter((r) => r.kind === 'opt_out').length
    if (advance) result.advanced++
  }

  return result
}

/** Anything on this lead that a person still needs to deal with. */
export function needsAttention(lead: Lead): InboundEmail[] {
  return (lead.replies ?? []).filter(
    (r) => r.kind === 'bounce' || r.kind === 'opt_out',
  )
}
