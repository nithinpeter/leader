import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Protected } from '../components/AppShell'
import { subscribeToLead } from '../lib/leads'
import type { Lead } from '../lib/types'

export const Route = createFileRoute('/doc/$leadId')({
  component: () => (
    <Protected>
      <OpportunityDoc />
    </Protected>
  ),
})

function OpportunityDoc() {
  const { leadId } = Route.useParams()
  const [lead, setLead] = useState<Lead | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () => subscribeToLead(leadId, setLead, (e) => setError(e.message)),
    [leadId],
  )

  if (error) return <p className="wrap py-16 text-sm text-clay">{error}</p>
  if (lead === undefined) {
    return <p className="wrap py-16 text-sm text-rule-control">Loading…</p>
  }
  if (lead === null || !lead.proposition) {
    return (
      <div className="wrap py-16">
        <p className="text-lg text-ink-soft">
          {lead === null
            ? 'This lead no longer exists.'
            : 'This lead has no opportunity doc yet.'}
        </p>
        <Link to="/" className="mt-4 inline-block text-sage-deep underline">
          Back to the pipeline
        </Link>
      </div>
    )
  }

  const p = lead.proposition
  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="min-h-screen bg-paper-deep py-10 print:bg-white print:py-0">
      <div className="no-print fixed left-0 right-0 top-0 z-10 border-b border-rule bg-paper">
        <div className="wrap flex items-center justify-between py-3">
          <Link
            to="/leads/$leadId"
            params={{ leadId: lead.id }}
            className="text-sm text-ink-soft hover:text-ink"
          >
            ← Back to {lead.companyName}
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-sm bg-sage-deep px-4 py-2 text-sm font-medium text-paper hover:bg-sage"
          >
            Print / save as PDF
          </button>
        </div>
      </div>

      <article className="mx-auto mt-14 max-w-3xl bg-paper px-10 py-12 shadow-sm print:mt-0 print:max-w-none print:bg-white print:px-0 print:py-0 print:shadow-none">
        {/* Masthead */}
        <header className="border-b-2 border-ink pb-8">
          <p className="kicker">Opportunity note · Prepared for a conversation</p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight tracking-tight">
            Westringia <span className="text-sage-deep">Labs</span>
            <span className="mx-3 font-light text-rule-control">×</span>
            {lead.companyName}
          </h1>
          <p className="mt-4 text-sm text-ink-soft">
            {lead.domain} · {p.industry} · {today}
          </p>
        </header>

        <DocSection n="01" title="The business">
          <p>{p.companySummary}</p>
        </DocSection>

        <DocSection n="02" title={`Why Westringia suits ${lead.companyName}`}>
          <p>{p.uniqueProposition}</p>
          <p className="mt-4 text-sm text-ink-soft">
            Our method does not start with software. Two weeks inside the
            business watching how the work actually gets done, then a ranked
            list of what AI would actually save, then a fixed price to build the
            top one. If nothing is worth building, we say so.
          </p>
        </DocSection>

        <DocSection n="03" title="Two automations worth building">
          <div className="space-y-6">
            {p.useCases.map((uc, i) => (
              <div key={i} className="print-page border border-rule-strong bg-paper-card p-6">
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-2xl font-light text-rule-control">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="font-display text-xl font-semibold">{uc.title}</h3>
                </div>
                <dl className="mt-4 space-y-3 text-[0.95rem] leading-relaxed">
                  <DocItem label="The problem today">{uc.problem}</DocItem>
                  <DocItem label="What we would build">{uc.automation}</DocItem>
                  <DocItem label="What it saves">{uc.impact}</DocItem>
                  <DocItem label="Plugs into">{uc.integrations}</DocItem>
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-ink-soft">
            A person stays in the loop on both. Nothing goes to a customer
            unreviewed until the numbers say it can.
          </p>
        </DocSection>

        <DocSection n="04" title="Where AI fits, and where it does not">
          <p>{p.whereAiFits}</p>
        </DocSection>

        <DocSection n="05" title="How we would work">
          <ol className="space-y-3">
            <DocStep n="Weeks one and two">
              We watch. A half-day workshop with whoever runs the work, then
              sessions sitting with the people who do it.
            </DocStep>
            <DocStep n="End of week two">
              A document and a decision. Five to eight opportunities, ranked on
              hours saved, cost to build, and how likely they are to break.
            </DocStep>
            <DocStep n="Then">
              A fixed price to build the top one, connected to what already
              runs. Tested before it goes live, handed over with written
              procedures.
            </DocStep>
            <DocStep n="After">
              Monthly review, monitoring, and a written record of what the AI
              does.
            </DocStep>
          </ol>
        </DocSection>

        <footer className="mt-12 border-t-2 border-ink pt-6 text-sm text-ink-soft">
          <p className="font-display text-lg font-semibold text-ink">
            Westringia <span className="text-sage-deep">Labs</span>
          </p>
          <p className="mt-1">
            Sydney, NSW · hello@westringia.com · 02 8531 8610 · westringia.com
          </p>
          <p className="mt-3 text-xs text-rule-control">
            Prepared from public information on {lead.domain}. Every claim worth
            acting on gets verified in conversation first.
          </p>
        </footer>
      </article>
    </div>
  )
}

function DocSection({
  n,
  title,
  children,
}: {
  n: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="print-page mt-10">
      <p className="kicker">
        {n} · {title}
      </p>
      <div className="mt-3 text-[1.02rem] leading-relaxed">{children}</div>
    </section>
  )
}

function DocItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-sage-deep">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  )
}

function DocStep({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="w-36 shrink-0 pt-0.5 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-sage-deep">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}
