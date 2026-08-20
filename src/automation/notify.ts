import { performSend } from '../server/email-core'
import type { CycleAction, CycleReport } from './cycle'

/** Where the "we just sent this" emails go. Defaults to the outreach mailbox. */
function notifyAddress(): string | null {
  return process.env.NOTIFY_EMAIL || process.env.SMTP_USER || null
}

function appUrl(leadId: string): string {
  const base = (process.env.APP_URL || '').replace(/\/$/, '')
  return base ? `${base}/leads/${leadId}` : `lead ${leadId}`
}

/**
 * Tells a person what just went out in their name, immediately, with the full
 * text. If the automation writes something wrong, this is how it gets caught
 * while there is still time to send a correction.
 */
export async function notifyOfSend(
  action: CycleAction,
  email: { subject: string; body: string },
): Promise<void> {
  const to = notifyAddress()
  if (!to) return

  const what =
    action.kind === 'reply'
      ? `Replied to ${action.company}`
      : `${action.detail} to ${action.company}`

  await performSend({
    to,
    subject: `[Leader] ${what}`,
    body: [
      `${what}.`,
      '',
      `Sent to: ${action.to}`,
      `Why: ${action.detail}`,
      `Lead: ${appUrl(action.leadId)}`,
      '',
      'This went out automatically. Nobody read it first.',
      '',
      `Subject: ${email.subject}`,
      '',
      email.body,
    ].join('\n'),
    // No BCC: this is already going to our own mailbox. No footer either.
    noCopy: true,
    plain: true,
  })
}

/** A single summary after a run that did something. Quiet runs stay quiet. */
export async function notifyOfRun(report: CycleReport): Promise<void> {
  const to = notifyAddress()
  if (!to) return
  const acted = report.repliesSent + report.followUpsSent + report.stopped
  if (acted === 0 && report.errors.length === 0) return

  await performSend({
    to,
    subject: `[Leader] ${report.repliesSent} replied, ${report.followUpsSent} followed up`,
    body: [
      `Run at ${report.ranAt}.`,
      '',
      `Leads considered: ${report.leadsConsidered}`,
      `New messages recorded: ${report.inboundRecorded}`,
      `Replies sent: ${report.repliesSent}`,
      `Follow-ups sent: ${report.followUpsSent}`,
      `Stopped (bounced or asked us to stop): ${report.stopped}`,
      '',
      ...report.actions.map((a) => `${a.company}: ${a.detail} (${a.to})`),
      ...(report.errors.length ? ['', 'Errors:', ...report.errors] : []),
    ].join('\n'),
    noCopy: true,
    plain: true,
  })
}
