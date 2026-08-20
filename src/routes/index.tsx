import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { AppShell, Protected } from '../components/AppShell'
import { StatusBadge } from '../components/StatusBadge'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MailIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SparklesIcon,
  TrendingUpIcon,
  UploadIcon,
  UsersIcon,
} from '../components/icons'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  Separator,
  Skeleton,
  Spinner,
  buttonClass,
} from '../components/ui'
import { subscribeToLeads } from '../lib/leads'
import { needsAttention, syncReplies, type ReplySyncResult } from '../lib/replies'
import {
  IMPORT_LABELS,
  LEAD_STATUSES,
  STATUS_LABELS,
  type Lead,
  type LeadStatus,
} from '../lib/types'

export const Route = createFileRoute('/')({
  component: () => (
    <AppShell breadcrumbs={[{ label: 'Dashboard' }, { label: 'Leads' }]}>
      <Protected>
        <Dashboard />
      </Protected>
    </AppShell>
  ),
})

const PAGE_SIZES = [10, 20, 50]

function Dashboard() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState<ReplySyncResult | null>(null)

  useEffect(
    () => subscribeToLeads(setLeads, (e) => setError(e.message)),
    [],
  )

  const awaitingReply = (leads ?? []).some((l) => l.emails?.length)

  async function check() {
    if (!leads) return
    setChecking(true)
    setError(null)
    setChecked(null)
    try {
      setChecked(await syncReplies(leads))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the mailbox')
    } finally {
      setChecking(false)
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (leads ?? []).filter(
      (l) =>
        (filter === 'all' || l.status === filter) &&
        (!q ||
          l.companyName.toLowerCase().includes(q) ||
          l.domain.toLowerCase().includes(q)),
    )
  }, [leads, filter, query])

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = visible.slice(safePage * pageSize, (safePage + 1) * pageSize)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every business Leader has researched, and where each conversation is up to.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {awaitingReply ? (
            <Button
              variant="outline"
              onClick={() => void check()}
              disabled={checking}
            >
              {checking ? <Spinner className="size-3.5" /> : <RefreshIcon size={16} />}
              {checking ? 'Reading the mailbox…' : 'Check for replies'}
            </Button>
          ) : null}
          <Link to="/leads/import" className={buttonClass('outline', 'default')}>
            <UploadIcon size={16} />
            Bulk import
          </Link>
          <Link to="/leads/new" className={buttonClass('default', 'default')}>
            <PlusIcon size={16} />
            Add lead
          </Link>
        </div>
      </div>

      <StatCards leads={leads} />

      {checked ? (
        <Alert tone={checked.added ? 'success' : 'default'}>
          {checked.added === 0
            ? `Nothing new against the ${checked.watched} ${
                checked.watched === 1 ? 'email' : 'emails'
              } we are waiting on.`
            : `${checked.added} new ${checked.added === 1 ? 'message' : 'messages'}.`}
          {checked.advanced
            ? ` ${checked.advanced} ${
                checked.advanced === 1 ? 'lead' : 'leads'
              } moved to in conversation.`
            : ''}
          {checked.bounces
            ? ` ${checked.bounces} bounced, so the address is wrong.`
            : ''}
          {checked.optOuts
            ? ` ${checked.optOuts} asked us to stop. Honour that within five working days.`
            : ''}
        </Alert>
      ) : null}

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-2 p-4">
            <label className="relative">
              <SearchIcon
                size={15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(0)
                }}
                placeholder="Filter leads…"
                className="h-8 w-56 pl-8 lg:w-72"
              />
            </label>
            <Select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as LeadStatus | 'all')
                setPage(0)
              }}
              className="h-8"
            >
              <option value="all">All statuses</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            {filter !== 'all' || query ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilter('all')
                  setQuery('')
                  setPage(0)
                }}
              >
                Reset
              </Button>
            ) : null}
            <p className="ml-auto text-sm text-muted-foreground">
              {leads === null ? '…' : `${visible.length} of ${leads.length} leads`}
            </p>
          </div>

          <LeadTable leads={leads} rows={pageRows} filtered={visible.length} />

          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              {visible.length === 0
                ? 'No rows'
                : `Showing ${safePage * pageSize + 1}–${Math.min(
                    (safePage + 1) * pageSize,
                    visible.length,
                  )} of ${visible.length}`}
            </p>
            <div className="flex flex-wrap items-center gap-4 lg:gap-6">
              <label className="flex items-center gap-2 text-sm">
                <span className="hidden text-muted-foreground sm:inline">
                  Rows per page
                </span>
                <Select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(0)
                  }}
                  className="h-8"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
              <p className="text-sm font-medium">
                Page {safePage + 1} of {pageCount}
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={safePage === 0}
                  onClick={() => setPage(0)}
                  aria-label="First page"
                >
                  <ChevronsLeftIcon size={15} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={safePage === 0}
                  onClick={() => setPage(safePage - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon size={15} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(safePage + 1)}
                  aria-label="Next page"
                >
                  <ChevronRightIcon size={15} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(pageCount - 1)}
                  aria-label="Last page"
                >
                  <ChevronsRightIcon size={15} />
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function StatCards({ leads }: { leads: Lead[] | null }) {
  const stats = useMemo(() => {
    const all = leads ?? []
    const now = Date.now()
    const newThisWeek = all.filter(
      (l) => now - new Date(l.createdAt).getTime() < WEEK_MS,
    ).length
    const docs = all.filter((l) => l.proposition).length
    const active = all.filter((l) =>
      ['contacted', 'in_conversation'].includes(l.status),
    ).length
    const won = all.filter((l) => l.status === 'won').length
    return [
      {
        label: 'Total leads',
        value: all.length,
        icon: UsersIcon,
        delta: `+${newThisWeek} this week`,
        note: 'Businesses researched so far',
      },
      {
        label: 'Docs ready',
        value: docs,
        icon: FileTextIcon,
        delta: all.length
          ? `${Math.round((docs / all.length) * 100)}% of leads`
          : '—',
        note: 'Opportunity docs written',
      },
      {
        label: 'In conversation',
        value: active,
        icon: MailIcon,
        delta: `${all.filter((l) => l.status === 'contacted').length} contacted`,
        note: 'Outreach under way',
      },
      {
        label: 'Won',
        value: won,
        icon: SparklesIcon,
        delta: all.length
          ? `${Math.round((won / all.length) * 100)}% conversion`
          : '—',
        note: 'Now clients of the lab',
      },
    ]
  }, [leads])

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label} className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">{s.label}</p>
            <s.icon size={16} className="text-muted-foreground" />
          </div>
          {leads === null ? (
            <Skeleton className="mt-2 h-8 w-16" />
          ) : (
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
              {s.value}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge className="border-border bg-muted/60 text-foreground/80">
              <TrendingUpIcon size={12} />
              {s.delta}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{s.note}</p>
        </Card>
      ))}
    </div>
  )
}

function LeadTable({
  leads,
  rows,
  filtered,
}: {
  leads: Lead[] | null
  rows: Lead[]
  filtered: number
}) {
  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="h-10 px-4 font-medium">Company</th>
            <th className="h-10 px-4 font-medium">Status</th>
            <th className="hidden h-10 px-4 font-medium md:table-cell">Doc</th>
            <th className="hidden h-10 px-4 font-medium sm:table-cell">Added</th>
            <th className="h-10 w-12 px-4" />
          </tr>
        </thead>
        <tbody>
          {leads === null ? (
            Array.from({ length: 5 }, (_, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-3.5 w-40" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-24" />
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <Skeleton className="h-4 w-14" />
                </td>
                <td className="hidden px-4 py-3 sm:table-cell">
                  <Skeleton className="h-4 w-16" />
                </td>
                <td className="px-4 py-3" />
              </tr>
            ))
          ) : filtered === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-16 text-center">
                <p className="text-sm text-muted-foreground">
                  {(leads?.length ?? 0) === 0
                    ? 'Nothing here yet. Paste in the website of a business worth talking to, and Leader will do the reading.'
                    : 'No leads match the current filters.'}
                </p>
                {(leads?.length ?? 0) === 0 ? (
                  <Link
                    to="/leads/new"
                    className={buttonClass('default', 'sm', 'mt-4')}
                  >
                    <PlusIcon size={14} />
                    Research your first lead
                  </Link>
                ) : null}
              </td>
            </tr>
          ) : (
            rows.map((lead) => <LeadRow key={lead.id} lead={lead} />)
          )}
        </tbody>
      </table>
    </div>
  )
}

/** Bulk-import progress, shown only while the machinery still owns the lead. */
function ImportBadge({ lead }: { lead: Lead }) {
  if (!lead.importState) return null
  if (lead.importState === 'failed') {
    return (
      <Badge
        className="border-destructive/25 bg-destructive/10 text-destructive"
        title={lead.importError}
      >
        {IMPORT_LABELS.failed}
      </Badge>
    )
  }
  return (
    <Badge className="border-border bg-muted/60 text-foreground/80">
      {lead.importState === 'running' ? <Spinner className="size-2.5" /> : null}
      {IMPORT_LABELS[lead.importState]}
    </Badge>
  )
}

/**
 * What came back on this lead, at a glance: bounces and opt-outs first
 * (they need a person to act), then a genuine reply.
 */
function InboundBadge({ lead }: { lead: Lead }) {
  const attention = needsAttention(lead)
  if (attention.length) {
    return (
      <>
        {attention.map((r) => (
          <Badge
            key={r.messageId}
            className="border-destructive/25 bg-destructive/10 text-destructive"
          >
            {r.kind === 'bounce' ? 'Bounced' : 'Asked us to stop'}
          </Badge>
        ))}
      </>
    )
  }
  if (lead.replies?.some((r) => r.kind === 'reply')) {
    return (
      <Badge className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        Replied
      </Badge>
    )
  }
  return null
}

function LeadRow({ lead }: { lead: Lead }) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <tr
      className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/50"
      onClick={() => void navigate({ to: '/leads/$leadId', params: { leadId: lead.id } })}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={lead.companyName} />
          <div className="min-w-0 leading-tight">
            <p className="truncate font-medium">{lead.companyName}</p>
            <p className="truncate text-xs text-muted-foreground">{lead.domain}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={lead.status} />
          <ImportBadge lead={lead} />
          <InboundBadge lead={lead} />
        </div>
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        {lead.proposition ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileTextIcon size={13} className="text-violet-500" />
            Ready
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/60">—</span>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground sm:table-cell">
        {new Date(lead.createdAt).toLocaleDateString('en-AU', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${lead.companyName}`}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontalIcon size={16} />
          </Button>
          {menuOpen ? (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
                <Link
                  to="/leads/$leadId"
                  params={{ leadId: lead.id }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <UsersIcon size={14} />
                  View lead
                </Link>
                {lead.proposition ? (
                  <Link
                    to="/doc/$leadId"
                    params={{ leadId: lead.id }}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <FileTextIcon size={14} />
                    Opportunity doc
                  </Link>
                ) : null}
                <a
                  href={lead.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <ExternalLinkIcon size={14} />
                  Visit website
                </a>
              </div>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  )
}
