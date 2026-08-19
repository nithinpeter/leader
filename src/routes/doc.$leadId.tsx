import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Protected } from '../components/AppShell'
import { DocFrame, DocItem, DocPlaceholder, DocSection } from '../components/DocChrome'
import { subscribeToLead } from '../lib/leads'
import type { Lead } from '../lib/types'

export const Route = createFileRoute('/doc/$leadId')({
  component: () => (
    <Protected>
      <OpportunityDoc />
    </Protected>
  ),
})

/**
 * The opportunity doc. Written for the client to read, not for us. It is about
 * their business: what we understood, where the time goes, and the two things
 * we would build. The pitch doc at /pitch/$leadId covers how we work.
 */
function OpportunityDoc() {
  const { leadId } = Route.useParams()
  const [lead, setLead] = useState<Lead | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () => subscribeToLead(leadId, setLead, (e) => setError(e.message)),
    [leadId],
  )

  if (error || !lead?.proposition) {
    return <DocPlaceholder lead={lead} error={error} what="opportunity doc" />
  }

  const p = lead.proposition
  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <DocFrame
      lead={lead}
      kicker={`Prepared for ${lead.companyName}`}
      title={
        <>
          Two things worth building at
          <br />
          {lead.companyName}
        </>
      }
      subtitle={`${lead.domain} · ${p.industry} · ${today}`}
      intro={`We wrote this before we spoke to you. It is based on your website and nothing else, so parts of it will be wrong. We sent it anyway, because it is easier to correct something specific than to answer the question of whether AI is worth your time in the abstract.`}
    >
      <DocSection n="01" title="What you do, as we read it">
        <p>{p.companySummary}</p>
      </DocSection>

      {p.whereTimeGoes ? (
        <DocSection n="02" title="Where we think the week goes">
          <p>{p.whereTimeGoes}</p>
        </DocSection>
      ) : null}

      <DocSection n={p.whereTimeGoes ? '03' : '02'} title="Two things worth building">
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
                <DocItem label="What happens today">{uc.problem}</DocItem>
                <DocItem label="What we would build">{uc.automation}</DocItem>
                <DocItem label="What it gives you back">{uc.impact}</DocItem>
                <DocItem label="What it plugs into">{uc.integrations}</DocItem>
              </dl>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          One of your people stays in the loop on both. Nothing reaches a
          customer without a person seeing it first.
        </p>
      </DocSection>

      <DocSection n={p.whereTimeGoes ? '04' : '03'} title="Where AI fits here, and where it does not">
        <p>{p.whereAiFits}</p>
        {p.notAutomating ? <p className="mt-4">{p.notAutomating}</p> : null}
      </DocSection>

      <DocSection n={p.whereTimeGoes ? '05' : '04'} title="Why we think we can help">
        <p>{p.uniqueProposition}</p>
      </DocSection>

      <DocSection n={p.whereTimeGoes ? '06' : '05'} title="What we may have got wrong">
        <p>
          {p.whereWeMightBeWrong ||
            'This was written from your public website before we spoke, so some of it will be wrong. Tell us which parts and we will drop them.'}
        </p>
        <p className="mt-4 text-sm text-ink-soft">
          If the two ideas above are already handled, that is a useful answer
          and there is no need to reply. If one of them is close but not quite
          right, that is usually where the real one is hiding.
        </p>
      </DocSection>

      <div className="print-page mt-10 border-t border-rule pt-8">
        <p className="kicker">The next step</p>
        <p className="mt-3 text-[1.02rem] leading-relaxed">
          {p.pitch?.nextStep ||
            'A twenty minute phone call. You tell us what a normal week looks like, and we tell you honestly whether there is anything here worth your time.'}
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          There is a second short document on how we work, what it costs and
          who owns it afterwards. Ask and we will send it.
        </p>
      </div>
    </DocFrame>
  )
}
