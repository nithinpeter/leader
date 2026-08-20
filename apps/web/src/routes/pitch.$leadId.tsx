import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Protected } from '../components/AppShell'
import { DocFrame, DocPlaceholder, DocSection } from '../components/DocChrome'
import { subscribeToLead } from '../lib/leads'
import type { Lead } from '@leader/core/types'

export const Route = createFileRoute('/pitch/$leadId')({
  component: () => (
    <Protected>
      <PitchDoc />
    </Protected>
  ),
})

/**
 * The pitch doc. The opportunity doc is about their business; this one is
 * about working with us. What we do, how it runs, what it costs, who owns it,
 * and who we are a poor fit for.
 */
function PitchDoc() {
  const { leadId } = Route.useParams()
  const [lead, setLead] = useState<Lead | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () => subscribeToLead(leadId, setLead, (e) => setError(e.message)),
    [leadId],
  )

  if (error || !lead?.proposition?.pitch) {
    return <DocPlaceholder lead={lead} error={error} what="pitch doc" />
  }

  const p = lead.proposition
  const pitch = p.pitch!
  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <DocFrame
      lead={lead}
      kicker={`Prepared for ${lead.companyName}`}
      title={<>How we work</>}
      subtitle={`Westringia Labs · for ${lead.companyName} · ${today}`}
      intro={pitch.headline}
    >
      <DocSection n="01" title="The short version">
        <p>{pitch.shortVersion}</p>
      </DocSection>

      <DocSection n="02" title="How it runs">
        <ol className="space-y-4">
          <Step n="Weeks one and two">
            We watch. A half-day workshop with whoever runs the work, then
            sessions sitting with the people who actually do it. We are looking
            for where the hours go, not for somewhere to put AI.
          </Step>
          <Step n="End of week two">
            A written list of five to eight opportunities, ranked on hours
            saved, cost to build, and how likely each one is to break. If
            nothing on that list is worth building, we say so and you owe us
            nothing further.
          </Step>
          <Step n="Then">
            A fixed price to build the top one. You see the number before any
            build work starts. It connects to what you already run rather than
            replacing it.
          </Step>
          <Step n="Before it goes live">
            We test it against real work. It gets handed over with written
            procedures, so your own people can run it without us.
          </Step>
          <Step n="After">
            Monthly review and monitoring if you want it, and a written record
            of what the AI does and what it is not allowed to do.
          </Step>
        </ol>
      </DocSection>

      <DocSection n="03" title="What it costs, and what you carry">
        <ul className="space-y-2.5">
          <Point>
            Fixed price, quoted before work starts. No hourly billing and no
            open-ended engagement.
          </Point>
          <Point>
            The two weeks of watching are priced separately and stand on their
            own. The written list is yours whether or not you build anything
            with us.
          </Point>
          <Point>
            It runs on your accounts and inside your systems. Software costs
            are yours directly, so you can see them and cancel them.
          </Point>
          <Point>
            No lock-in. The monthly review is a choice you make each month, not
            a contract you sign once.
          </Point>
        </ul>
      </DocSection>

      <DocSection n="04" title="Straight answers">
        <div className="space-y-5">
          {pitch.questions.map((q, i) => (
            <div key={i} className="print-page">
              <p className="font-display text-lg font-semibold">{q.question}</p>
              <p className="mt-1.5">{q.answer}</p>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection n="05" title={`Why us, for ${lead.companyName}`}>
        <p>{pitch.whyUsForYou}</p>
      </DocSection>

      <DocSection n="06" title="Who we are not for">
        <p>{pitch.whoWeAreNotFor}</p>
        <p className="mt-4 text-sm text-ink-soft">
          We would rather tell you that early than three weeks in.
        </p>
      </DocSection>

      <div className="print-page mt-10 border-t-2 border-ink pt-8">
        <p className="kicker">The next step</p>
        <p className="mt-3 text-[1.15rem] leading-relaxed">{pitch.nextStep}</p>
        <p className="mt-3 text-sm text-ink-soft">
          Reply to the email this came with, or call 02 8531 8610 and ask for
          whoever is around.
        </p>
      </div>
    </DocFrame>
  )
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <span className="w-40 shrink-0 pt-1 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-sage-deep">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="pt-1 text-sage-deep">
        ·
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}
