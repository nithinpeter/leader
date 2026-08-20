import nodemailer from 'nodemailer'
import { renderOutreachHtml, textFooter } from './email-template'

// Spacemail (spaceship.com) SMTP. Username is the full mailbox address.
const SMTP_DEFAULTS = { host: 'mail.spacemail.com', port: 465 }

function smtpConfig() {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) return null
  const port = Number(process.env.SMTP_PORT || SMTP_DEFAULTS.port)
  return {
    host: process.env.SMTP_HOST || SMTP_DEFAULTS.host,
    port,
    secure: port === 465,
    auth: { user, pass },
    fromName: process.env.SMTP_FROM_NAME || 'Westringia Labs',
  }
}

export interface SendInput {
  to: string
  subject: string
  body: string
  /** Message-ID being answered, so their client threads it. */
  inReplyTo?: string | null
  /** Skip the BCC copy, used for notifications to ourselves. */
  noCopy?: boolean
  /**
   * Send the body as-is, with no branded footer and no HTML part. For
   * notifications to ourselves; anything going to a prospect leaves this off.
   */
  plain?: boolean
}

/**
 * Sends one email from the outreach mailbox. Shared by the app and by the
 * automation, which runs outside any request. Outreach goes out as
 * text + HTML: the drafted body, with the branded footer (identity, contact
 * details, badge, opt-out) appended here so no draft ever carries it twice.
 */
export async function performSend(
  input: SendInput,
): Promise<{ messageId: string; from: string }> {
  const config = smtpConfig()
  if (!config) {
    throw new Error(
      'Email is not configured. Set SMTP_USER and SMTP_PASS in .env (Spacemail mailbox address and password).',
    )
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  })

  // A reply needs both headers to sit in the same thread everywhere.
  const threading = input.inReplyTo
    ? { inReplyTo: input.inReplyTo, references: [input.inReplyTo] }
    : {}

  const content = input.plain
    ? { text: input.body }
    : {
        text: `${input.body.trimEnd()}\n\n\n${textFooter()}`,
        html: renderOutreachHtml(input.body),
      }

  const info = await transporter.sendMail({
    from: { name: config.fromName, address: config.auth.user },
    to: input.to,
    // Spacemail's SMTP does not copy to the Sent folder; keep a copy in the inbox.
    ...(input.noCopy ? {} : { bcc: config.auth.user }),
    subject: input.subject,
    ...content,
    ...threading,
  })

  return { messageId: info.messageId, from: config.auth.user }
}

/** Whether sending is set up at all. */
export function smtpConfigured(): boolean {
  return smtpConfig() !== null
}

/** The mailbox everything sends from. */
export function sendingMailbox(): string | null {
  return process.env.SMTP_USER ?? null
}
