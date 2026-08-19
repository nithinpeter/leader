import { createServerFn } from '@tanstack/react-start'
import { generateText, Output } from 'ai'
import { google } from '@ai-sdk/google'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import type { EmailDraft, Proposition, SiteExtraction } from '../lib/types'

const DEFAULT_MODEL = 'gemini-3-pro-preview'

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

export const emailConfigured = createServerFn({ method: 'GET' }).handler(
  async () => ({ configured: smtpConfig() !== null, from: process.env.SMTP_USER ?? null }),
)

const DraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
})

const DRAFT_SYSTEM = `You write cold outreach emails for Westringia Labs, a Sydney consultancy that builds AI into Australian businesses of ten to two hundred people. Their method: two weeks inside the business watching how the work actually gets done, a ranked list of what AI would actually save, then a fixed price to build the top one. If nothing is worth building, they say so.

The voice is plain, concrete and honest. Short sentences. No hype, no "unlock", "leverage", "transform", "excited". No flattery about the recipient's website. Australian English. It should read like one busy tradesperson-adjacent professional writing to another, not like marketing.

Rules for the email:
- Subject: under 8 words, concrete, lowercase except proper nouns, no clickbait.
- Body: 90 to 140 words. Plain text only, no markdown, no bullet lists.
- Open with the supplied opening line or a tighter version of it.
- Name ONE specific automation opportunity from the research, in one or two sentences, stated conservatively.
- Offer a free half-hour call. Make clear there is no deck and no sales process, and that if nothing is worth building they will say so.
- Sign off as the sender name supplied, Westringia Labs, Sydney, with phone 02 8531 8610 and westringia.com.
- End with exactly this line after the signature: "If you'd rather not hear from us, just reply and say so - that's the last you'll get."
- Do not invent facts about the recipient that are not in the research.`

export const draftEmail = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      extraction: SiteExtraction
      proposition: Proposition
      senderName: string
    }) => {
      if (!input?.extraction || !input?.proposition) {
        throw new Error('Extraction and proposition are required')
      }
      return input
    },
  )
  .handler(async ({ data }): Promise<EmailDraft> => {
    const { extraction: e, proposition: p, senderName } = data
    const sender = senderName || 'The team'

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return {
        subject: `a question about how ${e.companyName} runs`,
        body: [
          p.openingLine,
          '',
          `We build AI into Australian businesses like yours. From the outside, ${p.useCases[0]?.title.toLowerCase() ?? 'the paperwork behind each job'} looks like the place to start: ${p.useCases[0]?.impact ?? 'hours a week back, stated conservatively'}.`,
          '',
          'Worth a free half-hour call? No deck, no sales process. You describe how the work gets done now, and if nothing here is worth building, we will say so.',
          '',
          sender,
          'Westringia Labs, Sydney',
          '02 8531 8610 · westringia.com',
          '',
          "If you'd rather not hear from us, just reply and say so - that's the last you'll get.",
        ].join('\n'),
      }
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
    const { output } = await generateText({
      model: google(model),
      system: DRAFT_SYSTEM,
      prompt: [
        `Sender name: ${sender}`,
        `Recipient business: ${e.companyName} (${e.domain})`,
        `What they do: ${p.companySummary}`,
        `Industry: ${p.industry}`,
        `Westringia's angle: ${p.uniqueProposition}`,
        `Opening line to use: ${p.openingLine}`,
        `Automation opportunity 1: ${p.useCases[0]?.title} - ${p.useCases[0]?.problem} ${p.useCases[0]?.automation} ${p.useCases[0]?.impact}`,
        `Automation opportunity 2: ${p.useCases[1]?.title} - ${p.useCases[1]?.problem}`,
        `Pick the stronger, more concrete opportunity for the email.`,
      ].join('\n'),
      output: Output.object({ schema: DraftSchema }),
    })

    if (!output) throw new Error('Could not draft the email. Try again.')
    return output
  })

export const sendLeadEmail = createServerFn({ method: 'POST' })
  .validator((input: { to: string; subject: string; body: string }) => {
    const to = input?.to?.trim()
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new Error('A valid recipient address is required')
    }
    if (!input.subject?.trim()) throw new Error('A subject is required')
    if (!input.body?.trim()) throw new Error('A body is required')
    return { to, subject: input.subject.trim(), body: input.body }
  })
  .handler(async ({ data }): Promise<{ messageId: string; from: string }> => {
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

    const info = await transporter.sendMail({
      from: { name: config.fromName, address: config.auth.user },
      to: data.to,
      // Spacemail's SMTP does not copy to the Sent folder; keep a copy in the inbox.
      bcc: config.auth.user,
      subject: data.subject,
      text: data.body,
    })

    return { messageId: info.messageId, from: config.auth.user }
  })
