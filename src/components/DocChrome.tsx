import { Link } from '@tanstack/react-router'
import type { Lead } from '../lib/types'

/**
 * Shared print chrome for the two client-facing documents. Both are meant to
 * be saved as a PDF and sent, so everything on screen that is not the document
 * itself carries .no-print.
 */
export function DocFrame({
  lead,
  kicker,
  title,
  subtitle,
  intro,
  children,
}: {
  lead: Lead
  kicker: string
  title: React.ReactNode
  subtitle: string
  intro?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-paper-deep py-10 text-ink print:bg-white print:py-0">
      <div className="no-print fixed left-0 right-0 top-0 z-10 border-b border-rule bg-paper">
        <div className="wrap flex items-center justify-between gap-4 py-3">
          <Link
            to="/leads/$leadId"
            params={{ leadId: lead.id }}
            className="text-sm text-ink-soft hover:text-ink"
          >
            ← Back to {lead.companyName}
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/doc/$leadId"
              params={{ leadId: lead.id }}
              className="text-sm text-ink-soft underline hover:text-ink"
              activeProps={{ className: 'text-sm font-medium text-ink no-underline' }}
            >
              Opportunity doc
            </Link>
            <Link
              to="/pitch/$leadId"
              params={{ leadId: lead.id }}
              className="text-sm text-ink-soft underline hover:text-ink"
              activeProps={{ className: 'text-sm font-medium text-ink no-underline' }}
            >
              Pitch doc
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
      </div>

      <article className="mx-auto mt-14 max-w-3xl bg-paper px-10 py-12 shadow-sm print:mt-0 print:max-w-none print:bg-white print:px-0 print:py-0 print:shadow-none">
        <header className="border-b-2 border-ink pb-8">
          <p className="kicker">{kicker}</p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight tracking-tight">
            {title}
          </h1>
          <p className="mt-4 text-sm text-ink-soft">{subtitle}</p>
          {intro ? (
            <p className="mt-6 max-w-2xl border-l-2 border-sage pl-4 text-[1.02rem] leading-relaxed text-ink-soft">
              {intro}
            </p>
          ) : null}
        </header>

        {children}

        <footer className="mt-12 border-t-2 border-ink pt-6 text-sm text-ink-soft">
          <p className="font-display text-lg font-semibold text-ink">
            Westringia <span className="text-sage-deep">Labs</span>
          </p>
          <p className="mt-1">
            Sydney, NSW · hello@westringia.com · 02 8531 8610 · westringia.com
          </p>
        </footer>
      </article>
    </div>
  )
}

export function DocSection({
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

export function DocItem({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-sage-deep">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  )
}

/** Shared loading, missing and not-generated-yet states for both docs. */
export function DocPlaceholder({
  lead,
  error,
  what,
}: {
  lead: Lead | null | undefined
  error: string | null
  what: string
}) {
  if (error) return <p className="wrap py-16 text-sm text-clay">{error}</p>
  if (lead === undefined) {
    return <p className="wrap py-16 text-sm text-rule-control">Loading…</p>
  }
  return (
    <div className="wrap py-16">
      <p className="text-lg text-ink-soft">
        {lead === null ? 'This lead no longer exists.' : `This lead has no ${what} yet.`}
      </p>
      {lead ? (
        <p className="mt-2 text-sm text-rule-control">
          Regenerate the proposition on the lead page to write one.
        </p>
      ) : null}
      <Link to="/" className="mt-4 inline-block text-sage-deep underline">
        Back to the pipeline
      </Link>
    </div>
  )
}
