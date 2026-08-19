import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppShell, Protected } from '../components/AppShell'
import { OutreachPanel } from '../components/OutreachPanel'
import { StatusBadge } from '../components/StatusBadge'
import { deleteLead, subscribeToLead, updateLead } from '../lib/leads'
import { LEAD_STATUSES, STATUS_LABELS, type Lead, type LeadStatus } from '../lib/types'
import { generateProposition } from '../server/generate'

export const Route = createFileRoute('/leads/$leadId')({
  component: () => (
    <AppShell>
      <Protected>
        <LeadDetail />
      </Protected>
    </AppShell>
  ),
})

function LeadDetail() {
  const { leadId } = Route.useParams()
  const navigate = useNavigate()
  const [lead, setLead] = useState<Lead | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(
    () => subscribeToLead(leadId, setLead, (e) => setError(e.message)),
    [leadId],
  )

  useEffect(() => {
    if (lead && !notesDirty) setNotes(lead.notes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.notes])

  if (error) {
    return <p className="wrap py-16 text-sm text-clay">Could not load lead: {error}</p>
  }
  if (lead === undefined) {
    return <p className="wrap py-16 text-sm text-rule-control">Loading…</p>
  }
  if (lead === null) {
    return (
      <div className="wrap py-16">
        <p className="text-lg text-ink-soft">This lead no longer exists.</p>
        <Link to="/" className="mt-4 inline-block text-sage-deep underline">
          Back to the pipeline
        </Link>
      </div>
    )
  }

  const p = lead.proposition
  let sectionNo = 0
  const nextN = () => String(++sectionNo).padStart(2, '0')

  async function regenerate() {
    if (!lead?.extraction) return
    setBusy('regenerate')
    try {
      const proposition = await generateProposition({
        data: { extraction: lead.extraction },
      })
      await updateLead(lead.id, { proposition })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!lead) return
    if (!window.confirm(`Delete ${lead.companyName}? This cannot be undone.`)) return
    await deleteLead(lead.id)
    await navigate({ to: '/' })
  }

  return (
    <div className="wrap max-w-4xl py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="kicker">Lead</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            {lead.companyName}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            <a
              href={lead.url}
              target="_blank"
              rel="noreferrer"
              className="text-sage-deep underline"
            >
              {lead.domain}
            </a>{' '}
            · added{' '}
            {new Date(lead.createdAt).toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={lead.status} />
          <select
            value={lead.status}
            onChange={(e) => void updateLead(lead.id, { status: e.target.value as LeadStatus })}
            className="rounded-sm border border-rule-strong bg-paper-card px-2 py-1.5 text-sm"
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 border-y border-rule py-4">
        {p ? (
          <Link
            to="/doc/$leadId"
            params={{ leadId: lead.id }}
            className="rounded-sm bg-sage-deep px-4 py-2 text-sm font-medium text-paper hover:bg-sage"
          >
            Open opportunity doc
          </Link>
        ) : null}
        {lead.extraction ? (
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={busy === 'regenerate'}
            className="rounded-sm border border-rule-strong px-4 py-2 text-sm hover:border-ink disabled:opacity-60"
          >
            {busy === 'regenerate'
              ? 'Rewriting…'
              : p
                ? 'Regenerate proposition'
                : 'Generate proposition'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void remove()}
          className="ml-auto rounded-sm px-3 py-2 text-sm text-clay hover:underline"
        >
          Delete lead
        </button>
      </div>

      {p ? (
        <>
          <Section n={nextN()} title="The business">
            <p>{p.companySummary}</p>
            <p className="mt-2 text-sm text-rule-control">{p.industry}</p>
          </Section>
          <Section n={nextN()} title="Westringia's angle">
            <p>{p.uniqueProposition}</p>
          </Section>
          <Section n={nextN()} title="Two automations worth building">
            <div className="grid gap-5 sm:grid-cols-2">
              {p.useCases.map((uc, i) => (
                <div key={i} className="border border-rule bg-paper-card p-5">
                  <p className="kicker">Use case {i + 1}</p>
                  <h3 className="mt-1 font-display text-lg font-semibold">{uc.title}</h3>
                  <dl className="mt-3 space-y-2.5 text-sm text-ink-soft">
                    <Item label="The problem">{uc.problem}</Item>
                    <Item label="The automation">{uc.automation}</Item>
                    <Item label="What it saves">{uc.impact}</Item>
                    <Item label="Plugs into">{uc.integrations}</Item>
                  </dl>
                </div>
              ))}
            </div>
          </Section>
          <Section n={nextN()} title="Opening line">
            <p className="border-l-2 border-sage pl-4 font-display text-lg italic">
              “{p.openingLine}”
            </p>
            <p className="mt-3 text-xs text-rule-control">
              Written {new Date(p.generatedAt).toLocaleString('en-AU')} ·{' '}
              {p.model === 'template-fallback'
                ? 'template draft – add a GOOGLE_GENERATIVE_AI_API_KEY for the real thing'
                : p.model}
            </p>
          </Section>
        </>
      ) : (
        <p className="mt-8 text-ink-soft">
          No proposition yet.{' '}
          {lead.extraction
            ? 'Generate one from the research below.'
            : 'This lead has no site research attached.'}
        </p>
      )}

      <Section n={nextN()} title="Outreach">
        <OutreachPanel lead={lead} />
      </Section>

      {lead.extraction ? (
        <Section n={nextN()} title="What the site says">
          <div className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
            <Fact label="Title" value={lead.extraction.title} />
            <Fact label="Description" value={lead.extraction.description} />
            <Fact label="Emails" value={lead.extraction.emails.join(', ')} />
            <Fact label="Phones" value={lead.extraction.phones.join(', ')} />
            <Fact label="Runs on" value={lead.extraction.techSignals.join(', ')} />
            <Fact label="Pages read" value={lead.extraction.pagesCrawled.join('  ·  ')} />
          </div>
          {lead.extraction.headings.length ? (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-rule-control">
                Headings on the site
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lead.extraction.headings.slice(0, 20).map((h) => (
                  <span
                    key={h}
                    className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-ink-soft"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section n={nextN()} title="Notes">
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            setNotesDirty(true)
          }}
          rows={5}
          placeholder="Calls made, who answered, what they said…"
          className="w-full rounded-sm border border-rule-strong bg-paper-card p-3 text-sm outline-none placeholder:text-rule-control focus:border-sage-deep"
        />
        <button
          type="button"
          disabled={!notesDirty}
          onClick={async () => {
            await updateLead(lead.id, { notes })
            setNotesDirty(false)
          }}
          className="mt-2 rounded-sm border border-rule-strong px-4 py-1.5 text-sm hover:border-ink disabled:opacity-50"
        >
          {notesDirty ? 'Save notes' : 'Saved'}
        </button>
      </Section>
    </div>
  )
}

function Section({
  n,
  title,
  children,
}: {
  n: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-10 border-t border-rule pt-8">
      <p className="kicker">
        {n} · {title}
      </p>
      <div className="mt-3 max-w-3xl text-[0.95rem] leading-relaxed">{children}</div>
    </section>
  )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-rule-control">
        {label}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-rule-control">
        {label}
      </p>
      <p className="mt-0.5 break-words text-ink-soft">{value}</p>
    </div>
  )
}
