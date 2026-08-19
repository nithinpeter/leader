import { createServerFn } from '@tanstack/react-start'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { Proposition, SiteExtraction } from '../lib/types'

const MODEL = 'claude-opus-5'

const UseCaseSchema = z.object({
  title: z.string(),
  problem: z.string(),
  automation: z.string(),
  impact: z.string(),
  integrations: z.string(),
})

const PropositionSchema = z.object({
  companySummary: z.string(),
  industry: z.string(),
  uniqueProposition: z.string(),
  useCases: z.array(UseCaseSchema),
  whereAiFits: z.string(),
  openingLine: z.string(),
})

const SYSTEM_PROMPT = `You write internal sales-research documents for Westringia Labs, a Sydney consultancy that builds AI into Australian businesses of ten to two hundred people. Westringia's method: two weeks inside the business watching how the work actually gets done, then a ranked list of what AI would actually save them, then a fixed price to build the top one. They connect to what businesses already run - Xero or MYOB, ERPs, ServiceM8 or Simpro, CRMs, Microsoft 365. They keep it running afterwards with monthly review and monitoring.

Westringia's voice is plain, concrete and honest. No hype, no buzzwords, no "unlock", "leverage", "empower", "transform" or "game-changing". Short declarative sentences. Specific over general. Willing to say what AI cannot do. Write everything in that voice, in Australian English.

You will be given raw research extracted from a prospect's website. Produce:
- companySummary: 2-3 sentences on what the business actually does, for someone who has never heard of them.
- industry: a short label, e.g. "Plumbing and gas fitting" or "Boutique accounting firm".
- uniqueProposition: 2-3 sentences on why Westringia specifically suits THIS business - tie it to how their work visibly runs (their services, their booking flow, their scale). This is Westringia's pitch angle, not generic AI benefits.
- useCases: EXACTLY TWO automation opportunities. Each one must be grounded in something visible in the research (a service they offer, a form on their site, a phone number as the main contact channel, quoting, scheduling, compliance paperwork). For each: title (short, concrete), problem (the pain as the business likely lives it today), automation (what gets built, concretely, including how a person stays in the loop), impact (hours or errors saved, stated conservatively), integrations (the systems it would plug into, using what the research shows or sensible guesses for their trade).
- whereAiFits: one paragraph of doc prose on where AI plausibly fits across their operation and where it does not.
- openingLine: one sentence a Westringia person could open a cold email with. Specific to this business, no flattery.

If the research is thin, stay conservative and say only what can be reasonably inferred.`

function extractionBrief(e: SiteExtraction): string {
  return [
    `URL: ${e.url}`,
    `Company name: ${e.companyName}`,
    `Page title: ${e.title}`,
    `Meta description: ${e.description || '(none)'}`,
    `Navigation: ${e.navigation.join(' | ') || '(none)'}`,
    `Headings: ${e.headings.join(' | ') || '(none)'}`,
    `Contact emails: ${e.emails.join(', ') || '(none)'}`,
    `Contact phones: ${e.phones.join(', ') || '(none)'}`,
    `Tech signals: ${e.techSignals.join(', ') || '(none)'}`,
    `Pages read: ${e.pagesCrawled.join(', ')}`,
    ``,
    `Page text (truncated):`,
    e.textSample,
  ].join('\n')
}

/**
 * Plain draft used when no ANTHROPIC_API_KEY is configured, so the pipeline
 * still works end to end. Clearly marked as a template in the model field.
 */
function templateProposition(e: SiteExtraction): Proposition {
  const name = e.companyName
  const services = e.services.slice(0, 3).join(', ')
  return {
    companySummary: `${name} (${e.domain}) — ${
      e.description || e.title || 'no description found on the site'
    }`,
    industry: 'To be confirmed',
    uniqueProposition: `${name} runs on the kind of day-to-day operational work Westringia looks at first${
      services ? ` — ${services.toLowerCase()}` : ''
    }. Two weeks watching how that work actually gets done would show where the hours go, and whether any of it is worth automating. If none of it is, we say so.`,
    useCases: [
      {
        title: 'First response to enquiries',
        problem: `Enquiries reach ${name} by ${
          e.phones.length ? 'phone' : 'email or web form'
        } and wait for someone to stop what they are doing and answer. Some wait too long. Some are never followed up.`,
        automation:
          'An assistant that reads each enquiry, drafts the reply or books the call, and queues it for a person to approve before anything is sent. Nothing goes out unreviewed.',
        impact:
          'Conservatively, an hour or two a day of interrupted time back, and fewer enquiries that quietly go cold.',
        integrations: `Email, the website${e.techSignals.length ? `, ${e.techSignals.slice(0, 2).join(' and ')}` : ''}, and whatever calendar or job system ${name} already runs.`,
      },
      {
        title: 'Paperwork behind the job',
        problem: `Behind every job at ${name} sits quoting, invoicing or compliance paperwork that is retyped from one place into another.`,
        automation:
          'Take one document flow end to end — quote to invoice, or job sheet to record — and have AI draft it from what already exists, with a person checking before it is final.',
        impact:
          'Hours a week of retyping gone, and fewer transcription errors reaching customers.',
        integrations:
          'Xero or MYOB, Microsoft 365, and the job or practice system already in use.',
      },
    ],
    whereAiFits: `This is a template draft: no AI generation ran because no API key is configured. Treat the two use cases above as the standard starting hypotheses Westringia tests in the first two weeks — first response to enquiries, and the paperwork behind each job. What the watching fortnight actually surfaces for ${name} may be different, and if nothing clears the bar, the honest recommendation is to build nothing.`,
    openingLine: `Had a look at ${e.domain} — a question about how ${name} handles the paperwork behind each job.`,
    generatedAt: new Date().toISOString(),
    model: 'template-fallback',
  }
}

export const generateProposition = createServerFn({ method: 'POST' })
  .validator((input: { extraction: SiteExtraction }) => {
    if (!input?.extraction?.url) throw new Error('An extraction is required')
    return input
  })
  .handler(async ({ data }): Promise<Proposition> => {
    const { extraction } = data
    if (!process.env.ANTHROPIC_API_KEY) {
      return templateProposition(extraction)
    }

    const client = new Anthropic()
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Website research for a prospective lead:\n\n${extractionBrief(extraction)}`,
        },
      ],
      output_config: {
        format: zodOutputFormat(PropositionSchema),
      },
    })

    const parsed = response.parsed_output
    if (!parsed) {
      throw new Error('The model returned an unparseable proposition. Try again.')
    }
    return {
      ...parsed,
      useCases: parsed.useCases.slice(0, 2),
      generatedAt: new Date().toISOString(),
      model: MODEL,
    }
  })
