import { STATUS_LABELS, type LeadStatus } from '../lib/types'

const STATUS_STYLES: Record<LeadStatus, string> = {
  new: 'border-rule-strong text-ink-soft',
  researched: 'border-sage text-sage-deep',
  doc_ready: 'border-sage-deep bg-sage-deep/10 text-sage-deep',
  contacted: 'border-clay/60 text-clay',
  in_conversation: 'border-clay bg-clay/10 text-clay',
  won: 'border-sage-deep bg-sage-deep text-paper',
  lost: 'border-rule text-rule-control line-through',
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.1em] ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
