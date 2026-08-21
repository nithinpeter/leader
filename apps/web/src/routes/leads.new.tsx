import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AppShell, Protected } from '../components/AppShell'
import { CheckIcon, GlobeIcon, SparklesIcon } from '../components/icons'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
  buttonClass,
  cn,
} from '../components/ui'
import { useAuth } from '../lib/auth'
import { createLead, DuplicateLeadError, findLeadIdByDomain } from '../lib/leads'
import { normalizeDomain } from '@leader/core/types'
import { extractSite } from '../server/extract'
import { generateProposition } from '../server/generate'

export const Route = createFileRoute('/leads/new')({
  component: () => (
    <AppShell
      breadcrumbs={[
        { label: 'Dashboard', to: '/' },
        { label: 'Leads', to: '/' },
        { label: 'New lead' },
      ]}
    >
      <Protected>
        <NewLead />
      </Protected>
    </AppShell>
  ),
})

type Step = 'idle' | 'extracting' | 'generating' | 'saving'

/** Which stage broke, so the hint can point at the real cause. */
type Failure = { phase: 'extract' | 'save'; message: string }

const FAILURE_HINT: Record<Failure['phase'], string> = {
  extract:
    'Check the address and try again. Some sites block automated readers; for those, add the lead details by hand after a manual look.',
  save: 'The research came back fine - writing it to Firestore is what failed. A permission-denied code usually means the rules in firestore.rules were never published to the project; check the Rules tab in the Firebase console.',
}

/** The hostname of whatever was typed, or nothing if it is not an address yet. */
function hostOf(raw: string): string | null {
  const trimmed = raw.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(withScheme)
    return parsed.hostname.includes('.') ? normalizeDomain(parsed.hostname) : null
  } catch {
    return null
  }
}

function messageOf(e: unknown): string {
  if (!(e instanceof Error)) return 'Something went wrong'
  // FirebaseError carries the decisive bit in `code` (permission-denied,
  // unavailable, invalid-argument); the message alone often does not say which.
  const code = (e as { code?: unknown }).code
  return typeof code === 'string' ? `${e.message} [${code}]` : e.message
}

const STEPS: Array<{ key: Exclude<Step, 'idle'>; label: string }> = [
  { key: 'extracting', label: 'Reading the website: title, copy, services, contact details' },
  { key: 'generating', label: 'Writing the proposition and picking two automations worth building' },
  { key: 'saving', label: 'Saving the lead' },
]

function NewLead() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<Failure | null>(null)
  const [duplicate, setDuplicate] = useState<{ domain: string; id: string } | null>(null)

  const running = step !== 'idle'

  async function run() {
    if (!url.trim() || !user) return
    setError(null)
    setDuplicate(null)

    // Check what was typed before paying for a crawl and a generation. The
    // address may still redirect somewhere already in the pipeline, which is
    // why createLead checks again on the far side.
    const typed = hostOf(url)
    if (typed) {
      try {
        const existing = await findLeadIdByDomain(typed)
        if (existing) {
          setDuplicate({ domain: typed, id: existing })
          return
        }
      } catch (e) {
        // A failed lookup is not a reason to refuse the lead; createLead runs
        // the same check again before anything is written.
        console.error(e)
      }
    }

    let extraction
    try {
      setStep('extracting')
      extraction = await extractSite({ data: { url } })
    } catch (e) {
      console.error(e)
      setError({ phase: 'extract', message: messageOf(e) })
      setStep('idle')
      return
    }

    setStep('generating')
    let proposition
    try {
      proposition = await generateProposition({ data: { extraction } })
    } catch (e) {
      // Keep the research even if generation fails; the doc can be retried.
      console.error(e)
      proposition = undefined
    }

    try {
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
      console.error(e)
      if (e instanceof DuplicateLeadError) {
        // The site redirected onto a business already in the pipeline. The
        // research is discarded rather than saved twice; the existing lead is
        // the one that gets contacted.
        setDuplicate({ domain: e.domain, id: e.existingId })
        setStep('idle')
        return
      }
      setError({ phase: 'save', message: messageOf(e) })
      setStep('idle')
    }
  }

  const activeIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New lead</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start with their website. Leader reads the site the way we would, then
          drafts Westringia&rsquo;s angle and two automations worth building.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SparklesIcon size={16} className="text-muted-foreground" />
            Research a business
          </CardTitle>
          <CardDescription>
            Paste a website address. You get an opportunity doc at the end.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void run()
            }}
          >
            <label className="relative min-w-64 flex-1">
              <GlobeIcon
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="acmeplumbing.com.au"
                disabled={running}
                autoFocus
                className="pl-9"
              />
            </label>
            <Button type="submit" disabled={running || !url.trim()}>
              {running ? <Spinner /> : null}
              {running ? 'Working…' : 'Research this business'}
            </Button>
          </form>

          {running ? (
            <div className="mt-6 space-y-3">
              {STEPS.map((s, i) => {
                const done = i < activeIndex
                const active = i === activeIndex
                return (
                  <div
                    key={s.key}
                    className={cn(
                      'flex items-center gap-3 text-sm',
                      done && 'text-muted-foreground',
                      active && 'font-medium',
                      !done && !active && 'text-muted-foreground/60',
                    )}
                  >
                    <span className="flex size-5 items-center justify-center">
                      {done ? (
                        <CheckIcon size={14} className="text-emerald-500" />
                      ) : active ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <span className="size-1.5 rounded-full bg-border" />
                      )}
                    </span>
                    {s.label}
                  </div>
                )
              })}
              <p className="pl-8 text-xs text-muted-foreground">
                This usually takes under a minute. Don&rsquo;t close the tab.
              </p>
            </div>
          ) : null}

          {duplicate ? (
            <div className="mt-6">
              <Alert title={`${duplicate.domain} is already a lead`}>
                <p className="text-xs">
                  Nothing was created, so this business will not be contacted
                  twice. Open the lead to see where it got to.
                </p>
                <Link
                  to="/leads/$leadId"
                  params={{ leadId: duplicate.id }}
                  className={cn(buttonClass('outline', 'sm'), 'mt-3')}
                >
                  Open the existing lead
                </Link>
              </Alert>
            </div>
          ) : null}

          {error ? (
            <div className="mt-6">
              <Alert tone="destructive" title={error.message}>
                <p className="text-xs">{FAILURE_HINT[error.phase]}</p>
              </Alert>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
