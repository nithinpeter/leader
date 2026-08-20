import { createServerFn } from '@tanstack/react-start'
import { generateText, Output } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import type { EmailDraft, Proposition, SiteExtraction } from '../lib/types'
import { performSend, sendingMailbox, smtpConfigured } from './email-core'
// One model default for both AI calls. gemini-3-pro-preview, which this used
// to name, has been retired and now 404s.
import {
  assembleColdEmail,
  ColdEmailPartsSchema,
  DEFAULT_MODEL,
  firstNameFromEmail,
} from './generate-core'

export const emailConfigured = createServerFn({ method: 'GET' }).handler(
  async () => ({ configured: smtpConfigured(), from: sendingMailbox() }),
)

const DraftSchema = ColdEmailPartsSchema.extend({ subject: z.string() })

const DRAFT_SYSTEM = `You write cold outreach emails for Westringia Labs, a Sydney consultancy that builds AI into Australian businesses of ten to two hundred people. Their method: two weeks inside the business watching how the work actually gets done, a ranked list of what AI would actually save, then a fixed price to build the top one. If nothing is worth building, they say so.

The email reads like a short, friendly note from one busy person to another. Casual and warm, contractions and all ("we'd", "there's", "you're"), but still plain, concrete and honest. Short sentences. No hype, no "unlock", "leverage", "transform", "excited". No flattery about the recipient's website. No exclamation marks, and never the characters "—" or "–". Australian English. Do not invent facts about the recipient that are not in the research.

The email is assembled from the parts you return, in this order: greeting, opener, the two ideas as a numbered list, closer, then "Thanks," on its own line. A branded footer with our logo and contact details goes on underneath at send time, so never sign a name and never write contact details into the body. No links, no attachments.

- subject: under 8 words, concrete, lowercase except proper nouns, no clickbait. Name the piece of their work it is about, never the technology.
- greeting: "Hey <first name>," when the research clearly names the person you are writing to: an owner or manager named in the site text, or a first name plainly readable in a contact email address (sam@... is Sam, info@... is nobody). First name only, never a surname or a title. When no name is certain, exactly "Hi there," and never a name guessed from the company name.
- opener: one or two casual sentences, under 35 words. A specific, true observation about how their business runs, from the research, stated as a fact about the business, not about their website. End it by leading into the list in your own words, along the lines of "A couple of things we reckon we could take off your plate:".
- ideaOne and ideaTwo: the two automation opportunities, one sentence each, under 20 words. Plain words, described in terms of their day rather than the technology. Say what stops happening, not what gets deployed. No leading numbers, the list numbers itself on assembly.
- closer: one or two sentences, under 30 words. Who Westringia is in half a sentence, no credentials, no adjectives. Then the low friction question: worth sending over the two page write-up, or have they got this handled already? Do not ask for a meeting, do not propose a time.`

export const draftEmail = createServerFn({ method: 'POST' })
  .validator(
    (input: { extraction: SiteExtraction; proposition: Proposition }) => {
      if (!input?.extraction || !input?.proposition) {
        throw new Error('Extraction and proposition are required')
      }
      return input
    },
  )
  .handler(async ({ data }): Promise<EmailDraft> => {
    const { extraction: e, proposition: p } = data

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      const first = firstNameFromEmail(e.emails[0])
      return {
        subject: `a question about how ${e.companyName} runs`,
        body: assembleColdEmail({
          greeting: first ? `Hey ${first},` : 'Hi there,',
          opener: `${p.openingLine} A couple of things we reckon we could take off your plate:`,
          ideaOne:
            p.useCases[0]?.title ?? 'The first reply to every enquiry drafted for you.',
          ideaTwo:
            p.useCases[1]?.title ?? 'The paperwork behind each job written once, not twice.',
          closer: `We're a small Sydney team called Westringia Labs and we build this sort of thing for businesses your size. I've written both ideas up, about two pages. Worth sending over, or is this already handled?`,
        }),
      }
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
    const { output } = await generateText({
      model: google(model),
      system: DRAFT_SYSTEM,
      prompt: [
        `Recipient business: ${e.companyName} (${e.domain})`,
        `What they do: ${p.companySummary}`,
        `Industry: ${p.industry}`,
        `Westringia's angle: ${p.uniqueProposition}`,
        `Opening line to build the opener from: ${p.openingLine}`,
        `Idea 1: ${p.useCases[0]?.title} - ${p.useCases[0]?.problem} ${p.useCases[0]?.automation} ${p.useCases[0]?.impact}`,
        `Idea 2: ${p.useCases[1]?.title} - ${p.useCases[1]?.problem} ${p.useCases[1]?.automation} ${p.useCases[1]?.impact}`,
        `Contact emails found on their site: ${e.emails.join(', ') || '(none)'}`,
        ``,
        `Text from their site, which may name the owner or manager:`,
        e.textSample.slice(0, 2500),
      ].join('\n'),
      output: Output.object({ schema: DraftSchema }),
    })

    if (!output) throw new Error('Could not draft the email. Try again.')
    const { subject, ...parts } = output
    return { subject, body: assembleColdEmail(parts) }
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
  .handler(async ({ data }) => performSend(data))
