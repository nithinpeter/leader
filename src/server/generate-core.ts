import { generateText, Output } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import type { Proposition, SiteExtraction } from '../lib/types'

// This is copywriting a client reads, so it wants a pro model. The flash
// models draft faster and write blander, and they break the voice rules more
// often. Override with GEMINI_MODEL if this preview id is retired.
export const DEFAULT_MODEL = 'gemini-3.1-pro-preview'

const UseCaseSchema = z.object({
  title: z.string(),
  problem: z.string(),
  automation: z.string(),
  impact: z.string(),
  integrations: z.string(),
})

const PitchSchema = z.object({
  headline: z.string(),
  shortVersion: z.string(),
  whyUsForYou: z.string(),
  whoWeAreNotFor: z.string(),
  questions: z.array(z.object({ question: z.string(), answer: z.string() })),
  nextStep: z.string(),
})

/**
 * The body comes back in named parts rather than one string, so the shape of
 * the email (greeting, opener, the two ideas as a numbered list, closer) is
 * guaranteed by assembly instead of hoped for from the model. A wall of text
 * is the fastest way to have a cold email deleted.
 */
export const ColdEmailPartsSchema = z.object({
  greeting: z.string(),
  opener: z.string(),
  ideaOne: z.string(),
  ideaTwo: z.string(),
  closer: z.string(),
})
export type ColdEmailParts = z.infer<typeof ColdEmailPartsSchema>

const EmailSchema = ColdEmailPartsSchema.extend({
  subject: z.string(),
  followUpSubject: z.string(),
  followUp: z.string(),
})

/**
 * The one place the cold email is put together. Ends at "Thanks," with no name
 * under it; the branded footer goes on at send time (server/email-template.ts).
 */
export function assembleColdEmail(parts: ColdEmailParts): string {
  // Models sometimes number the items anyway. The list numbers itself here.
  const item = (s: string) => s.trim().replace(/^\d+[.)]\s*/, '')
  return [
    parts.greeting.trim(),
    parts.opener.trim(),
    `1. ${item(parts.ideaOne)}\n2. ${item(parts.ideaTwo)}`,
    parts.closer.trim(),
    'Thanks,',
  ].join('\n\n')
}

/** Mailboxes that are a desk, not a person. Never greet these by name. */
const ROLE_MAILBOXES =
  /^(info|hello|hi|admin|office|contact|sales|enquir|inquir|accounts|support|team|mail|reception|bookings|jobs|service|help|no-?reply)/i

/**
 * "sam@..." is probably Sam; "info@..." is nobody. Used by the template
 * fallback; the AI path reads names out of the site text itself.
 */
export function firstNameFromEmail(email: string | undefined): string | null {
  const local = email?.split('@')[0] ?? ''
  if (!/^[a-z]{2,12}$/i.test(local) || ROLE_MAILBOXES.test(local)) return null
  return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase()
}

const PropositionSchema = z.object({
  companySummary: z.string(),
  industry: z.string(),
  uniqueProposition: z.string(),
  useCases: z.array(UseCaseSchema),
  whereTimeGoes: z.string(),
  whereAiFits: z.string(),
  notAutomating: z.string(),
  whereWeMightBeWrong: z.string(),
  openingLine: z.string(),
  pitch: PitchSchema,
  email: EmailSchema,
})

const SYSTEM_PROMPT = `You write client-facing documents for Westringia Labs, a Sydney consultancy that builds AI into Australian businesses of ten to two hundred people.

Everything you write here will be read by the prospective client themselves. It is not internal research. The owner or general manager of the business opens these documents cold, having never heard of Westringia. Write to them.

WESTRINGIA'S METHOD, stated plainly:
- Two weeks inside the business, watching how the work actually gets done. A half-day workshop with whoever runs the work, then sessions sitting with the people who do it.
- At the end of week two, a written list of five to eight opportunities, ranked on hours saved, cost to build, and how likely each is to break. If nothing on the list is worth building, we say so and there is no obligation to continue.
- Then a fixed price to build the top one. Quoted before work starts. No hourly billing.
- It connects to what the business already runs: Xero or MYOB, ERPs, ServiceM8 or Simpro, CRMs, Microsoft 365.
- Tested before it goes live, handed over with written procedures so their own people can run it.
- Monthly review and monitoring afterwards, and a written record of what the AI does.

VOICE, and this matters more than anything else:
- Simple, clear language. Short sentences. A busy person reading on a phone between jobs should understand every line on the first pass.
- Plain words over industry words. Say "answering the phone", not "inbound channel management". Say "we would build", not "we would deploy a solution".
- Humble, but never underselling. State what Westringia does and what it is worth, clearly and once, then stop. Confidence is quiet. Do not brag, do not hedge, do not apologise for existing.
- Honest about limits. Name what AI cannot do here and what you would leave alone. This is what makes the rest believable.
- Specific over general. Every claim should point at something real in their business.
- Australian English.
- Conservative with numbers. Say "an hour or two a day" rather than inventing a percentage. Never invent a dollar figure, a client name, a case study or a statistic.

BANNED, without exception:
- Em dashes and en dashes. Never use the characters "—" or "–". Use a full stop, a comma, or two sentences instead.
- Hype words: unlock, leverage, empower, transform, revolutionise, game-changing, seamless, cutting-edge, supercharge, elevate, robust, best-in-class, synergy, holistic, journey, streamline, solution as a noun.
- Flattery openers: "I came across your impressive website", "I love what you are doing".
- Exclamation marks, capitalised words for emphasis, and rhetorical questions stacked on each other.
- Invented commercial terms. Do not offer refunds, guarantees, free work, instalments, discounts, trials, deadlines or dollar figures. Nothing beyond the method above is agreed. Where money comes up, the honest answer is that the two weeks are priced on their own and the build is quoted at a fixed price before it starts.
- Sentences that would read the same if they were about a different company. "We help businesses like yours", "this frees up staff time", "we understand the challenges of your industry". If a sentence would survive a find and replace of the company name, rewrite it or cut it.

You will be given raw research extracted from a prospect's public website. Produce the following.

FOR THE OPPORTUNITY DOCUMENT, which is about their business:
- companySummary: 2 to 3 sentences on what the business does, written back to them in the second person ("You run...", "Your work is..."). Show that someone actually read the site rather than skimmed the homepage.
- industry: a short label, for example "Plumbing and gas fitting" or "Boutique accounting firm".
- uniqueProposition: 2 to 3 sentences on why Westringia suits this business in particular. Tie it to how their work visibly runs: their services, how enquiries reach them, their size, the paperwork their trade carries. Written to them, not about them.
- whereTimeGoes: one short paragraph on where the hours most likely go in a week at this business today, grounded in what the site shows. Frame it as an educated guess they can correct, because it is one.
- useCases: EXACTLY TWO things worth building. Each must be grounded in something visible in the research, such as a service they list, a form on their site, a phone number as the main way in, quoting, scheduling, or compliance paperwork. For each one:
  - title: short and concrete, in their words not ours.
  - problem: the pain as they live it today, described so accurately they nod. Second person.
  - automation: what we would build, concretely, including exactly where a person stays in the loop and approves before anything reaches a customer.
  - impact: hours or errors saved, stated conservatively and honestly.
  - integrations: the systems it would plug into, using what the research shows, or sensible guesses named as guesses.
- whereAiFits: one paragraph on where AI plausibly fits across their operation and where it does not. Be specific about the "does not".
- notAutomating: 2 to 3 sentences on what you would deliberately leave alone at this business, and why. The judgement calls, the relationships, the work that is the business itself.
- whereWeMightBeWrong: 2 sentences. This document was written from their public website before any conversation, so some of it will be wrong. Say so plainly and invite the correction.

FOR THE PITCH DOCUMENT, which is about working with Westringia:
- pitch.headline: one sentence the reader could repeat to a business partner over lunch. It should describe what actually happens, such as the two weeks and the fixed price, not a benefit slogan about being smoother or more efficient.
- pitch.shortVersion: 2 to 3 sentences covering the whole offer. If they read nothing else, this is enough.
- pitch.whyUsForYou: 2 to 3 sentences on why Westringia fits this business specifically. Quiet confidence. No comparisons to other agencies.
- pitch.whoWeAreNotFor: 1 to 2 sentences naming honestly who Westringia is a poor fit for. This is real, not a humblebrag.
- pitch.questions: EXACTLY FOUR questions this particular owner would actually ask, in their words, with a straight answer to each. Cover at least: whether it replaces their people, what happens if it does not work, and who owns and controls it afterwards. The fourth should be specific to their trade or profession, such as a regulatory, licensing, privacy or client confidentiality concern. Answers are 2 to 3 sentences, direct, and never defensive.
- pitch.nextStep: 1 to 2 sentences on the smallest sensible next step. Low commitment and clearly described.

FOR THE COLD EMAIL:
This is the first contact. It has never been sent before, the reader owes us nothing, and it must not read like it was written by a machine or sent to a hundred businesses. It reads like a short, friendly note from one busy person to another: casual and warm, contractions and all ("we'd", "there's", "you're"), while keeping every voice rule above. Short beats clever.

The email is assembled from the parts below, in this order: greeting, opener, the two use cases as a numbered list, closer, then "Thanks," on its own line. A branded footer with our logo and contact details goes on underneath at send time, so never sign a name and never write contact details into the body. No links, no attachments, no images.
- openingLine: one sentence a Westringia person could open a cold email with. Specific to this business. No flattery.
- email.subject: 4 to 7 words. Lowercase except proper nouns. Reads like a colleague wrote it, not marketing. Name the piece of their work it is about, never the technology, so do not use the words AI, automation, software or tool in the subject. No company name stuffing, no "quick question" cliche, no numbers or symbols, no words like free, offer, guaranteed or opportunity.
- email.greeting: "Hey <first name>," when the research clearly names the person you are writing to: an owner or manager named in the site text, or a first name plainly readable in a contact email address (sam@... is Sam, info@... is nobody). First name only, never a surname or a title. When no name is certain, exactly "Hi there," and never a name guessed from the company name.
- email.opener: one or two casual sentences, under 35 words. A specific, true observation about how their business runs, taken from the research. It must be something only a person who actually looked would say, stated as a fact about their business, not about their website. Write "You match jobs to local branches by postcode", never "Your website shows that you match jobs". End it by leading into the list in your own words, along the lines of "A couple of things we reckon we could take off your plate:".
- email.ideaOne and email.ideaTwo: the two use cases, one sentence each, under 20 words. Plain words, described in terms of their day rather than the technology. Say what stops happening, not what gets deployed. No leading numbers, the list numbers itself on assembly.
- email.closer: one or two sentences, under 30 words. Who Westringia is in half a sentence, no credentials, no client list, no adjectives. Then the low friction question: worth sending over the two page write-up, or have they got this handled already? Do not ask for a meeting, do not propose a time.
- email.followUpSubject: a reply-style subject for a follow-up sent about a week later.
- email.followUp: 40 to 60 words. Open with the new thought itself, in the first sentence, as though continuing a train of thought rather than chasing a reply. It must add something real, either a second observation about their business or a narrowing of the idea to the part most likely to matter. Do not reference the earlier email at all. Never write "just bumping this", "circling back", "following up", or "checking in". End by making it easy to say no, and mean it.

If the research is thin, stay conservative. Say only what can reasonably be inferred, and lean harder on whereWeMightBeWrong.`

function extractionBrief(e: SiteExtraction): string {
  return [
    `URL: ${e.url}`,
    `Company name: ${e.companyName}`,
    `Page title: ${e.title}`,
    `Meta description: ${e.description || '(none)'}`,
    `Navigation: ${e.navigation.join(' | ') || '(none)'}`,
    `Headings: ${e.headings.join(' | ') || '(none)'}`,
    `Services: ${e.services.join(' | ') || '(none)'}`,
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
 * The prompt bans em and en dashes, but models slip. This is the guarantee:
 * number ranges become "to", everything else becomes ordinary punctuation.
 */
function stripDashes(s: string): string {
  return s
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\./g, '.')
}

/** Apply stripDashes to every string in a generated object, at any depth. */
function clean<T>(value: T): T {
  if (typeof value === 'string') return stripDashes(value) as T
  if (Array.isArray(value)) return value.map(clean) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, clean(v)]),
    ) as T
  }
  return value
}

/**
 * Plain draft used when no GOOGLE_GENERATIVE_AI_API_KEY is configured, so the
 * pipeline still works end to end. Clearly marked as a template in the model
 * field, and never send this to a client as it stands.
 */
function templateProposition(e: SiteExtraction): Proposition {
  const name = e.companyName
  const services = e.services.slice(0, 3).join(', ')
  const byPhone = e.phones.length > 0
  return {
    companySummary: `You run ${name} out of ${e.domain}. ${
      e.description || e.title || 'The site does not say much more than the name.'
    }${services ? ` The site lists ${services.toLowerCase()}.` : ''}`,
    industry: 'To be confirmed',
    uniqueProposition: `Most of what a business like yours does in a week is operational work that repeats. Enquiries, quotes, scheduling, the paperwork behind each job. That is the work we look at first. We spend two weeks watching how it actually gets done, then tell you honestly whether any of it is worth automating.`,
    useCases: [
      {
        title: 'The first reply to an enquiry',
        problem: `Enquiries reach you by ${
          byPhone ? 'phone' : 'email or the form on your site'
        } and wait until someone can stop what they are doing. Some wait too long. A few are never followed up at all, and you only find out when the customer goes elsewhere.`,
        automation:
          'An assistant that reads each enquiry as it arrives, drafts the reply or books the call, and puts it in a queue for one of your people to approve. Nothing is sent to a customer until a person has read it.',
        impact:
          'Conservatively, an hour or two a day of interrupted time back, and fewer enquiries that quietly go cold.',
        integrations: `Your email, your website${
          e.techSignals.length ? `, ${e.techSignals.slice(0, 2).join(' and ')}` : ''
        }, and whichever calendar or job system you already use.`,
      },
      {
        title: 'The paperwork behind each job',
        problem: `Behind every job there is a quote, an invoice or a compliance form, and the same details get typed in twice. Once into one system, again into another. It is slow, and it is where the errors come from.`,
        automation:
          'We take one document flow end to end, quote to invoice or job sheet to record, and have the draft written from what already exists in your systems. A person checks it before it is final.',
        impact:
          'Hours a week of retyping gone, and fewer wrong numbers reaching customers.',
        integrations:
          'Xero or MYOB, Microsoft 365, and the job or practice system you already run.',
      },
    ],
    whereTimeGoes: `Without having spoken to you, our guess is that the week goes on three things. Answering and chasing enquiries, getting quotes and invoices out, and the coordination that sits between the two. None of that is the work you are actually paid for, but it has to happen.`,
    whereAiFits: `This is a template draft. No AI generation ran, because no API key is configured. Treat the two ideas above as the standard starting points we test in the first fortnight, not as findings about ${name}.`,
    notAutomating: `We would leave the judgement calls alone. Pricing a difficult job, handling an unhappy customer, deciding who to hire. AI is good at the repeated work around those decisions, and poor at the decisions themselves.`,
    whereWeMightBeWrong: `This was written from your public website before we spoke, so some of it will be wrong. Tell us which parts and we will drop them.`,
    openingLine: `Had a look at ${e.domain} and had a question about how ${name} handles the paperwork behind each job.`,
    pitch: {
      headline: `We spend two weeks working out what AI would actually save you, then quote a fixed price to build the one thing worth building.`,
      shortVersion: `We are a small Sydney team that builds AI into Australian businesses of ten to two hundred people. We start by watching how your work gets done for two weeks. Then you get a ranked list of what is worth automating, and a fixed price for the top one. If nothing on the list is worth it, we tell you.`,
      whyUsForYou: `We build on top of what you already run rather than asking you to change systems. Your people keep the final say on anything that reaches a customer, and you get written procedures so you are not dependent on us to keep it going.`,
      whoWeAreNotFor: `If you want a chatbot on the website by Friday, we are the wrong people. We are slower than that and we ask a lot of questions first.`,
      questions: [
        {
          question: 'Is this going to replace my staff?',
          answer:
            'No. We automate the repeated work around the job, not the judgement in it. In practice your people stop retyping things and spend that time on work only they can do.',
        },
        {
          question: 'What if it does not work?',
          answer:
            'The two weeks end in a written recommendation, and sometimes that recommendation is to build nothing. You are not committed to a build until you see a fixed price and agree to it.',
        },
        {
          question: 'Who owns it once it is built?',
          answer:
            'You do. It runs in your systems, on your accounts, and you get written procedures so your own people can operate it. We stay on monthly for review and monitoring only if you want us to.',
        },
        {
          question: 'What happens to our data?',
          answer:
            'It stays in the systems you already use. We do not move your customer records somewhere new, and we write down exactly what the AI can see and what it cannot.',
        },
      ],
      nextStep: `A twenty minute phone call. You tell us what a normal week looks like, and we tell you honestly whether there is anything here worth your time.`,
    },
    email: {
      subject: 'a thought about your quoting',
      body: assembleColdEmail({
        greeting: (() => {
          const first = firstNameFromEmail(e.emails[0])
          return first ? `Hey ${first},` : 'Hi there,'
        })(),
        opener: `Had a look at ${e.domain} this morning. Looks like ${
          byPhone
            ? 'most enquiries come in by phone'
            : 'enquiries come in through the form on your site'
        }, so someone's stopping what they're doing every time one lands. A couple of things we reckon we could take off your plate:`,
        ideaOne:
          'The first reply to every enquiry drafted for you, and one of your people just approves it.',
        ideaTwo:
          'The paperwork behind each job written once, instead of typed into two systems.',
        closer: `We're a small Sydney team called Westringia Labs and we build this sort of thing for businesses your size. I've written both ideas up for ${name}, about two pages. Worth sending over, or is this already handled?`,
      }),
      followUpSubject: 're: a thought about your quoting',
      followUp: `One more thought since I wrote. If the quoting side is already sorted, the other place this usually pays off is the follow-up on quotes that go quiet. Happy to leave it there if the timing is wrong. Just say and I will not chase.`,
    },
    generatedAt: new Date().toISOString(),
    model: 'template-fallback',
  }
}


/**
 * Writes the client-facing opportunity doc, the pitch doc and the cold email
 * from a site extraction. Pure so it can be run outside a request, which is
 * how the drafts get eyeballed before anyone sends one.
 */
export async function performGeneration(
  extraction: SiteExtraction,
): Promise<Proposition> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return clean(templateProposition(extraction))
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
  const { output } = await generateText({
    model: google(model),
    system: SYSTEM_PROMPT,
    prompt: `Website research for a prospective client:\n\n${extractionBrief(extraction)}`,
    output: Output.object({ schema: PropositionSchema }),
  })

  if (!output) {
    throw new Error('The model returned an unparseable proposition. Try again.')
  }
  const { greeting, opener, ideaOne, ideaTwo, closer, ...email } = output.email
  return clean({
    ...output,
    useCases: output.useCases.slice(0, 2),
    pitch: { ...output.pitch, questions: output.pitch.questions.slice(0, 4) },
    email: {
      ...email,
      body: assembleColdEmail({ greeting, opener, ideaOne, ideaTwo, closer }),
    },
    generatedAt: new Date().toISOString(),
    model,
  })
}
