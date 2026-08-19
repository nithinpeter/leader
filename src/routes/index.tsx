import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { AppShell, Protected } from '../components/AppShell'
import { StatusBadge } from '../components/StatusBadge'
import { subscribeToLeads } from '../lib/leads'
import { LEAD_STATUSES, STATUS_LABELS, type Lead, type LeadStatus } from '../lib/types'

export const Route = createFileRoute('/')({
  component: () => (
    <AppShell>
      <Protected>
        <Dashboard />
      </Protected>
    </AppShell>
  ),
})

function Dashboard() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all')

  useEffect(
    () => subscribeToLeads(setLeads, (e) => setError(e.message)),
    [],
  )

  const counts = useMemo(() => {
    const c = new Map<LeadStatus, number>()
    for (const l of leads ?? []) c.set(l.status, (c.get(l.status) ?? 0) + 1)
    return c
  }, [leads])

  const visible = useMemo(
    () => (leads ?? []).filter((l) => filter === 'all' || l.status === filter),
    [leads, filter],
  )

  return (
    <div className="wrap py-10">
      <p className="kicker">01 · Pipeline</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Leads
        </h1>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <FilterChip
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label={`All ${leads?.length ?? 0}`}
          />
          {LEAD_STATUSES.map((s) => (
            <FilterChip
              key={s}
              active={filter === s}
              onClick={() => setFilter(s)}
              label={`${STATUS_LABELS[s]} ${counts.get(s) ?? 0}`}
            />
          ))}
        </div>
      </div>

      {error ? (
        <p className="mt-8 border-l-2 border-clay pl-4 text-sm text-ink-soft">
          Could not load leads: {error}
        </p>
      ) : leads === null ? (
        <p className="mt-8 text-sm text-rule-control">Loading the pipeline…</p>
      ) : visible.length === 0 ? (
        <div className="mt-10 border-t border-rule pt-10">
          <p className="max-w-xl text-lg text-ink-soft">
            {leads.length === 0
              ? 'Nothing here yet. Paste in the website of a business worth talking to, and Leader will do the reading.'
              : 'No leads with that status.'}
          </p>
          {leads.length === 0 ? (
            <Link
              to="/leads/new"
              className="mt-6 inline-block rounded-sm bg-sage-deep px-5 py-2.5 font-medium text-paper hover:bg-sage"
            >
              Research your first lead
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-rule border-t border-rule">
          {visible.map((lead) => (
            <li key={lead.id}>
              <Link
                to="/leads/$leadId"
                params={{ leadId: lead.id }}
                className="group flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4 hover:bg-paper-deep/50"
              >
                <span className="font-display text-xl font-semibold group-hover:text-sage-deep">
                  {lead.companyName}
                </span>
                <span className="text-sm text-rule-control">{lead.domain}</span>
                <span className="ml-auto flex items-center gap-3">
                  {lead.proposition ? (
                    <span className="text-xs text-sage-deep">Doc ready</span>
                  ) : null}
                  <StatusBadge status={lead.status} />
                  <span className="text-xs text-rule-control">
                    {new Date(lead.createdAt).toLocaleDateString('en-AU', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </span>
                {lead.proposition ? (
                  <span className="w-full text-sm text-ink-soft">
                    {lead.proposition.companySummary.slice(0, 160)}
                    {lead.proposition.companySummary.length > 160 ? '…' : ''}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 ${
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-rule-strong text-ink-soft hover:border-ink'
      }`}
    >
      {label}
    </button>
  )
}
