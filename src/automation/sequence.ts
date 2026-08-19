import { generateText, Output } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { DEFAULT_MODEL } from '../server/generate-core'
import type { InboundEmail, Lead, OutreachEmail } from '../lib/types'

const DraftSchema = z.object({ subject: z.string(), body: z.string() })
export type Draft = z.infer<typeof DraftSchema>

/**
 * The four follow-ups, each with its own job. Without a distinct angle per step
 * a model writes the same email four times in different words, which is what
 * makes most sequences read like a machine.
 */
export const FOLLOW_UP_ANGLES = [
  {
    /** Days to wait after the previous email before this one goes. */
    afterDays: 4,
    angle:
      'The other idea. The first email led with one of the two automations, so lead with the second one this time, in a sentence or two. Do not restate the first idea and do not summarise the earlier email.',
  },
  {
    afterDays: 7,
    angle:
      'The specific mechanic. Take the idea they have not responded to and show one concrete step of how it would actually work at their business, so it stops being abstract. One short example of the sequence of events, from the thing arriving to a person approving it.',
  },
  {
    afterDays: 11,
    angle:
      'The wrong person check. It is possible this is not their call or not their problem. Ask, plainly and without apology, whether someone else in the business owns this, and offer to send it there instead.',
  },
  {
    afterDays: 14,
    angle:
      'The close out. Say this is the last email, with no guilt and no false deadline. Leave one sentence of genuine value they can use whether or not they ever reply, and make it easy to come back later if the timing changes.',
  },
] as const

export const MAX_FOLLOW_UPS = FOLLOW_UP_ANGLES.length

const VOICE = `You write for Westringia Labs, a Sydney consultancy that builds AI into Australian businesses of ten to two hundred people. Their method: two weeks watching how the work gets done, a ranked list of what AI would actually save, then a fixed price to build the top one. If nothing is worth building they say so. They connect to what the business already runs, and a person always approves anything that reaches a customer.

VOICE:
- Simple, clear language. Short sentences. Read on a phone between jobs.
- Plain words over industry words. Humble, but never underselling.
- Australian English. Honest about what AI cannot do.
- Write as one person to another. Never "we at Westringia are excited to".

BANNED, without exception:
- The characters "—" and "–". Use a full stop or a comma.
- Hype words: unlock, leverage, empower, transform, seamless, streamline, revolutionise, game-changing, solution as a noun.
- Invented commercial terms. No refunds, guarantees, free work, discounts, trials, deadlines or dollar figures. Nothing beyond the method above is agreed. If money comes up, the two weeks are priced on their own and the build is quoted at a fixed price before it starts.
- Invented facts. No client names, case studies, statistics or claims about their business that are not in the research below.
- Sentences that would read the same about a different company.
- Exclamation marks, and any sign-off after "Thanks,". The sender's name is added afterwards.`

function leadBrief(lead: Lead): string {
  const p = lead.proposition
  return [
    `Business: ${lead.companyName} (${lead.domain})`,
    p ? `What they do: ${p.companySummary}` : '',
    p ? `Industry: ${p.industry}` : '',
    p?.useCases[0]
      ? `Idea one, ${p.useCases[0].title}: ${p.useCases[0].problem} ${p.useCases[0].automation} ${p.useCases[0].impact}`
      : '',
    p?.useCases[1]
      ? `Idea two, ${p.useCases[1].title}: ${p.useCases[1].problem} ${p.useCases[1].automation} ${p.useCases[1].impact}`
      : '',
    p?.whereTimeGoes ? `Where their time goes: ${p.whereTimeGoes}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function thread(emails: OutreachEmail[]): string {
  return emails
    .map((e, i) => `--- Email ${i + 1}, sent ${e.sentAt}\nSubject: ${e.subject}\n${e.body}`)
    .join('\n\n')
}

function model() {
  return google(process.env.GEMINI_MODEL || DEFAULT_MODEL)
}

/** Strip the dashes the prompt bans, in case the model slips anyway. */
function clean(draft: Draft): Draft {
  const fix = (s: string) =>
    s
      .replace(/(\d)\s*[—–]\s*(\d)/g, '$1 to $2')
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/\s+([,.])/g, '$1')
  return { subject: fix(draft.subject), body: fix(draft.body) }
}

/**
 * Writes follow-up number `step` (1 based) for a lead that has not replied.
 * The whole thread so far goes in the prompt, so it can avoid repeating itself.
 */
export async function draftFollowUp(lead: Lead, step: number): Promise<Draft> {
  const spec = FOLLOW_UP_ANGLES[step - 1]
  if (!spec) throw new Error(`No follow-up defined for step ${step}`)

  const sent = (lead.emails ?? []).filter((e) => e.kind !== 'reply')
  const { output } = await generateText({
    model: model(),
    system: `${VOICE}

You are writing follow-up ${step} of ${MAX_FOLLOW_UPS} in a cold outreach sequence. They have not replied to anything yet, so they owe you nothing and may never have read the earlier emails.

THE JOB OF THIS EMAIL: ${spec.angle}

RULES:
- 40 to 80 words. Shorter than the email before it.
- Do not reference the earlier emails, do not apologise for writing again, and never write "just following up", "circling back", "checking in", "bumping this" or "in case you missed it".
- Open with the new thought itself, in the first sentence.
- Say something they have not been told yet. If you cannot, say less.
- No links, no attachments, no booking links, no meeting times.
- Subject: reply style, so it sits in the same thread. Reuse the original subject exactly as given, with no "re:" prefix added, unless this email genuinely changes topic.
- End with "Thanks," on its own line, nothing after it.`,
    prompt: `${leadBrief(lead)}

The emails already sent, oldest first:

${thread(sent)}`,
    output: Output.object({ schema: DraftSchema }),
  })

  if (!output) throw new Error('The model returned an unparseable follow-up')
  return clean(output)
}

/**
 * Writes a reply to something a person actually sent back. This one is answering
 * a human, so it does what they asked before anything else.
 */
export async function draftReply(
  lead: Lead,
  incoming: InboundEmail,
): Promise<Draft> {
  const sent = (lead.emails ?? []).filter((e) => e.kind !== 'reply')
  const { output } = await generateText({
    model: model(),
    system: `${VOICE}

Someone from the business has written back. You are drafting the reply that goes to them.

RULES:
- Answer what they actually asked or said, first, in plain words. That comes before anything else.
- If they asked for the write-up, say it is attached or coming, and that a person will send it shortly. Do not claim to have attached anything yourself.
- If they asked a question you cannot answer from the research, say a person will come back to them on it. Never guess at a price, a timeline or a commitment.
- If they sound interested, the next step to offer is a short phone call. Do not propose a specific time or a booking link, ask what suits them.
- If they sound negative or unsure, accept it gracefully and leave the door open. Do not argue and do not pitch again.
- 40 to 90 words. One or two short paragraphs.
- Do not restate their message back to them and do not open with "Thanks for getting back to me" alone.
- Subject: reuse theirs exactly.
- End with "Thanks," on its own line, nothing after it.`,
    prompt: `${leadBrief(lead)}

What we sent them, oldest first:

${thread(sent)}

--- What they have just written back
From: ${incoming.fromName || incoming.from}
Subject: ${incoming.subject}

${incoming.snippet}`,
    output: Output.object({ schema: DraftSchema }),
  })

  if (!output) throw new Error('The model returned an unparseable reply')
  return clean(output)
}
