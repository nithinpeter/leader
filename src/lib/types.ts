export type LeadStatus =
  | 'new'
  | 'researched'
  | 'doc_ready'
  | 'contacted'
  | 'in_conversation'
  | 'won'
  | 'lost'

export const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'researched',
  'doc_ready',
  'contacted',
  'in_conversation',
  'won',
  'lost',
]

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  researched: 'Researched',
  doc_ready: 'Doc ready',
  contacted: 'Contacted',
  in_conversation: 'In conversation',
  won: 'Won',
  lost: 'Lost',
}

export interface SiteExtraction {
  url: string
  domain: string
  companyName: string
  title: string
  description: string
  headings: string[]
  navigation: string[]
  services: string[]
  textSample: string
  pagesCrawled: string[]
  emails: string[]
  phones: string[]
  socialLinks: string[]
  techSignals: string[]
  fetchedAt: string
}

export interface AiUseCase {
  title: string
  /** The pain in the business as it runs today, written back to the client. */
  problem: string
  /** What the automation does, concretely. */
  automation: string
  /** What it saves or unlocks. */
  impact: string
  /** Systems it would plug into. */
  integrations: string
}

/** One straight answer to a question a cautious owner actually asks. */
export interface PitchQuestion {
  question: string
  answer: string
}

/**
 * The client pitch doc: less about their business, more about what working
 * with Westringia looks like. Optional so leads written before this existed
 * still render.
 */
export interface PitchContent {
  /** One sentence the client could repeat to a business partner. */
  headline: string
  /** Two or three sentences: the whole offer, plainly. */
  shortVersion: string
  /** Why Westringia suits this business in particular. Confident, not loud. */
  whyUsForYou: string
  /** Who we are a poor fit for. Honest, and it makes the rest believable. */
  whoWeAreNotFor: string
  /** Four questions a cautious owner in their industry would ask. */
  questions: PitchQuestion[]
  /** The smallest sensible next step. */
  nextStep: string
}

/**
 * A cold email draft, plus the follow-up if the first one goes quiet. The
 * follow-up is optional because `draftEmail` in server/email.ts re-drafts just
 * the first email, and leads written before the follow-up existed do not carry
 * one.
 */
export interface EmailDraft {
  subject: string
  body: string
  followUpSubject?: string
  followUp?: string
}

export interface Proposition {
  /** What the business does, written back to them in the second person. */
  companySummary: string
  industry: string
  /** Why Westringia thinks it can help this business in particular. */
  uniqueProposition: string
  useCases: AiUseCase[]
  /** Where AI plausibly fits across their operation, doc prose. */
  whereAiFits: string
  /** Where the hours likely go today, grounded in what the site shows. */
  whereTimeGoes?: string
  /** What we would deliberately leave alone, and why. */
  notAutomating?: string
  /** What this doc may have got wrong, said plainly. */
  whereWeMightBeWrong?: string
  /** Suggested outreach opening line. */
  openingLine: string
  pitch?: PitchContent
  email?: EmailDraft
  generatedAt: string
  model: string
}

export interface OutreachEmail {
  to: string
  subject: string
  body: string
  sentAt: string
  sentBy: string
  messageId: string
}

export interface Lead {
  id: string
  url: string
  domain: string
  companyName: string
  status: LeadStatus
  notes: string
  createdBy: string
  createdAt: string
  updatedAt: string
  extraction?: SiteExtraction
  proposition?: Proposition
  emails?: OutreachEmail[]
}
