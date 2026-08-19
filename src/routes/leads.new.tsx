import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AppShell, Protected } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { createLead } from '../lib/leads'
import { extractSite } from '../server/extract'
import { generateProposition } from '../server/generate'

export const Route = createFileRoute('/leads/new')({
  component: () => (
    <AppShell>
      <Protected>
        <NewLead />
      </Protected>
    </AppShell>
  ),
})

type Step = 'idle' | 'extracting' | 'generating' | 'saving'

const STEP_COPY: Record<Exclude<Step, 'idle'>, string> = {
  extracting: 'Reading the website – title, copy, services, contact details…',
  generating: 'Writing the proposition and picking two automations worth building…',
  saving: 'Saving the lead…',
}

function NewLead() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)

  const running = step !== 'idle'

  async function run() {
    if (!url.trim() || !user) return
    setError(null)
    try {
      setStep('extracting')
      const extraction = await extractSite({ data: { url } })

      setStep('generating')
      let proposition
      try {
        proposition = await generateProposition({ data: { extraction } })
      } catch (e) {
        // Keep the research even if generation fails; the doc can be retried.
        console.error(e)
        proposition = undefined
      }

      setStep('saving')
      const id = await createLead({
        url: extraction.url,
        domain: extraction.domain,
        companyName: extraction.companyName,
        createdBy: user.uid,
        extraction,
        proposition,
      })
      await navigate({ to: '/leads/$leadId', params: { leadId: id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setStep('idle')
    }
  }

  return (
    <div className="wrap max-w-2xl py-12">
      <p className="kicker">02 · New lead</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
        Start with their website.
      </h1>
      <p className="mt-3 text-ink-soft">
        Leader reads the site the way we would – what they do, how the work
        reaches them – then drafts Westringia&rsquo;s angle and two automations
        worth building. You get an opportunity doc at the end.
      </p>

      <form
        className="mt-8 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="acmeplumbing.com.au"
          disabled={running}
          autoFocus
          className="min-w-64 flex-1 rounded-sm border border-rule-strong bg-paper-card px-4 py-2.5 outline-none placeholder:text-rule-control focus:border-sage-deep disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={running || !url.trim()}
          className="rounded-sm bg-sage-deep px-5 py-2.5 font-medium text-paper hover:bg-sage disabled:opacity-60"
        >
          {running ? 'Working…' : 'Research this business'}
        </button>
      </form>

      {running ? (
        <div className="mt-8 border-l-2 border-sage pl-4">
          <p className="text-sm font-medium text-sage-deep">
            {STEP_COPY[step as Exclude<Step, 'idle'>]}
          </p>
          <p className="mt-1 text-xs text-rule-control">
            This usually takes under a minute. Don&rsquo;t close the tab.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mt-8 border-l-2 border-clay pl-4">
          <p className="text-sm text-ink">{error}</p>
          <p className="mt-1 text-xs text-rule-control">
            Check the address and try again. Some sites block automated readers;
            for those, add the lead details by hand after a manual look.
          </p>
        </div>
      ) : null}
    </div>
  )
}
