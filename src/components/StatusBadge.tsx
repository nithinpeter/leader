import { STATUS_LABELS, type LeadStatus } from '../lib/types'
import { Badge, cn } from './ui'

const STATUS_STYLES: Record<LeadStatus, { badge: string; dot: string }> = {
  new: {
    badge: 'border-border bg-muted/60 text-foreground/80',
    dot: 'bg-zinc-400',
  },
  researched: {
    badge: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400',
    dot: 'bg-sky-500',
  },
  doc_ready: {
    badge:
      'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-400',
    dot: 'bg-violet-500',
  },
  contacted: {
    badge:
      'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  in_conversation: {
    badge:
      'border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
  won: {
    badge:
      'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  lost: {
    badge: 'border-border bg-muted/40 text-muted-foreground',
    dot: 'bg-zinc-400',
  },
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  const style = STATUS_STYLES[status]
  return (
    <Badge className={cn('border', style.badge)}>
      <span className={cn('size-1.5 rounded-full', style.dot)} />
      {STATUS_LABELS[status]}
    </Badge>
  )
}
