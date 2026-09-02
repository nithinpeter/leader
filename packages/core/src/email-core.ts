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
    // Fail fast with a real error. Nodemailer's defaults wait around two
    // minutes on a connection that will never open, which is what a host with
    // blocked SMTP egress looks like: the UI spins until something upstream
    // gives up, and the actual cause never surfaces.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  })

  // A reply needs both headers to sit in the same thread everywhere.
  const threading = input.inReplyTo
    ? { inReplyTo: input.inReplyTo, references: [input.inReplyTo] }
    : {}

  const content = {
    text: `${input.body.trimEnd()}\n\n\n${textFooter()}`,
    html: renderOutreachHtml(input.body),
  }

  let info: { messageId: string }
  try {
    info = await transporter.sendMail({
      from: { name: config.fromName, address: config.auth.user },
      to: input.to,
      subject: input.subject,
      ...content,
      ...threading,
    })
  } catch (e) {
    throw new Error(explainSendFailure(e, config.host, config.port), { cause: e })
  }

  return { messageId: info.messageId, from: config.auth.user }
}

/**
 * Turns nodemailer's error codes into a sentence that names the next step.
 * The one that matters most: a connection that times out rather than being
 * refused almost always means the host the app runs on blocks outbound SMTP
 * (Railway does this on some plans), not that anything here is misconfigured.
 */
function explainSendFailure(e: unknown, host: string, port: number): string {
  const code = (e as { code?: string })?.code
  const message = e instanceof Error ? e.message : String(e)
  switch (code) {
    case 'ETIMEDOUT':
    case 'ESOCKET':
    case 'ECONNECTION':
      return `Could not reach ${host}:${port} (${code}). The hosting platform is probably blocking outbound SMTP - Railway does on trial plans - or the mail host is down. Test from the app's host with: nc -vz ${host} ${port}.`
    case 'EAUTH':
      return `The mail server at ${host} rejected the login for ${process.env.SMTP_USER}. Check SMTP_PASS is that mailbox's current password.`
    case 'EENVELOPE':
      return `The mail server rejected the addresses on the email: ${message}`
    default:
      return `Sending through ${host}:${port} failed: ${message}`
  }
}

/** Whether sending is set up at all. */
export function smtpConfigured(): boolean {
  return smtpConfig() !== null
}

/** The mailbox everything sends from. */
export function sendingMailbox(): string | null {
  return process.env.SMTP_USER ?? null
}
