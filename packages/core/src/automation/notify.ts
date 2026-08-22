import { performSend } from '../email-core'
import type { InboundEmail, Lead } from '../types'

/** Where the "someone replied" emails go. Defaults to the outreach mailbox. */
function notifyAddress(): string | null {
  return process.env.NOTIFY_EMAIL || process.env.SMTP_USER || null
}

function appUrl(leadId: string): string {
  const base = (process.env.APP_URL || '').replace(/\/$/, '')
  return base ? `${base}/leads/${leadId}` : `lead ${leadId}`
}

/**
 * Tells a person that a prospect wrote back, with what they said. This is the
 * only email the automation sends about itself: routine sends, follow-ups and
 * run summaries stay quiet, and the app is where to see those.
 */
export async function notifyOfReply(
  lead: Lead,
  reply: InboundEmail,
): Promise<void> {
  const to = notifyAddress()
  if (!to) return

  await performSend({
    to,
    subject: `[Leader] ${lead.companyName} replied`,
    body: [
      `${reply.fromName || reply.from} at ${lead.companyName} wrote back.`,
      '',
      `Subject: ${reply.subject}`,
      `Lead: ${appUrl(lead.id)}`,
      '',
      reply.snippet,
    ].join('\n'),
    // No BCC: this is already going to our own mailbox. No footer either.
    noCopy: true,
    plain: true,
  })
}
