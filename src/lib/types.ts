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
  /** The pain in the business as it runs today. */
  problem: string
  /** What the automation does, concretely. */
  automation: string
  /** What it saves or unlocks. */
  impact: string
  /** Systems it would plug into. */
  integrations: string
}

export interface Proposition {
  companySummary: string
  industry: string
  /** Westringia's unique proposition for this specific business. */
  uniqueProposition: string
  useCases: AiUseCase[]
  /** Where AI plausibly fits across their operation, doc prose. */
  whereAiFits: string
  /** Suggested outreach opening line. */
  openingLine: string
  generatedAt: string
  model: string
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
}
