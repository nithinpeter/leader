import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppShell, Protected } from '../components/AppShell'
import { AlertCircleIcon, CheckIcon, GlobeIcon, UsersIcon } from '../components/icons'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  Textarea,
  buttonClass,
  cn,
} from '../components/ui'
import { useAuth } from '../lib/auth'
import {
  applyImportResult,
  createQueuedLeads,
  failQueuedLeads,
  findLeadIdByDomain,
  subscribeToLeads,
  type QueuedLeads,
} from '../lib/leads'
import { normalizeDomain, type Lead } from '@leader/core/types'
import { extractSite } from '../server/extract'
import { generateProposition } from '../server/generate'
import { IMPORT_NOT_CONFIGURED, startBulkImport } from '../server/import'

export const Route = createFileRoute('/leads/import')({
  component: () => (
    <AppShell
      breadcrumbs={[
        { label: 'Dashboard', to: '/' },
        { label: 'Leads', to: '/' },
        { label: 'Bulk import' },
      ]}
    >
      <Protected>
        <BulkImport />
      </Protected>
    </AppShell>
  ),
})

interface ParsedEntry {
  url: string
  domain: string
}

/**
 * Reads whatever got pasted - one URL per line, a comma-separated list, or a
 * CSV export - and keeps the first thing on each line that parses as a web
 * address. Emails are skipped so a contacts export does not turn into leads.
 */
function parseInput(raw: string): { entries: ParsedEntry[]; rejected: string[] } {
  const entries: ParsedEntry[] = []
  const rejected: string[] = []
  const seen = new Set<string>()
  for (const line of raw.split(/\r?\n/)) {
    const tokens = line
      .split(/[,;\s]+/)
      .map((t) => t.trim().replace(/^["']+|["'.]+$/g, ''))
      .filter(Boolean)
    if (tokens.length === 0) continue
    const candidate = tokens.find((t) => !t.includes('@') && t.includes('.'))
    if (!candidate) {
      rejected.push(line.trim())
      continue
    }
    const withScheme = /^https?:\/\//i.test(candidate)
      ? candidate
      : `https://${candidate}`
    let parsed: URL
    try {
      parsed = new URL(withScheme)
    } catch {
      rejected.push(line.trim())
      continue
    }
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes('.')) {
      rejected.push(line.trim())
      continue
    }
    const domain = normalizeDomain(parsed.hostname)
    if (seen.has(domain)) continue
    seen.add(domain)
    entries.push({ url: parsed.href, domain })
  }
  return { entries, rejected }
}

type Phase =
  | { key: 'idle' }
  | { key: 'creating' }
  | { key: 'dispatching' }
  /** The Cloud Functions have the batch; we just watch Firestore. */
  | { key: 'remote' }
  /** No function deployed, so this tab is doing the work itself. */
  | { key: 'local' }
  | { key: 'done' }

/** How many leads the in-browser fallback works on at once. */
const LOCAL_CONCURRENCY = 3

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong'
}

function BulkImport() {
  const { user } = useAuth()
  const [raw, setRaw] = useState('')
  const [phase, setPhase] = useState<Phase>({ key: 'idle' })
  const [batchIds, setBatchIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [leads, setLeads] = useState<Lead[] | null>(null)
  // The subscription outlives the closure that started the import.
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    const unsub = subscribeToLeads(setLeads, (e) => setError(e.message))
    return () => {
      cancelled.current = true
      unsub()
    }
  }, [])

  const { entries, rejected } = useMemo(() => parseInput(raw), [raw])
  const existingDomains = useMemo(
    () => new Set((leads ?? []).map((l) => normalizeDomain(l.domain))),
    [leads],
  )
  const fresh = entries.filter((e) => !existingDomains.has(e.domain))
  const alreadyKnown = entries.length - fresh.length

  const batch = useMemo(() => {
    const ids = new Set(batchIds)
    return (leads ?? []).filter((l) => ids.has(l.id))
  }, [leads, batchIds])
  const counts = useMemo(() => {
    let queued = 0
    let running = 0
    let failed = 0
    let done = 0
    for (const l of batch) {
      if (l.importState === 'queued') queued++
      else if (l.importState === 'running') running++
      else if (l.importState === 'failed') failed++
      else done++
    }
    return { queued, running, failed, done }
  }, [batch])

  const working = phase.key === 'remote' || phase.key === 'local'
  useEffect(() => {
    if (
      working &&
      batch.length === batchIds.length &&
      batchIds.length > 0 &&
      counts.queued === 0 &&
      counts.running === 0
    ) {
      setPhase({ key: 'done' })
    }
  }, [working, batch.length, batchIds.length, counts.queued, counts.running])

  async function processLocally(ids: string[], byId: Map<string, ParsedEntry>) {
    const queue = [...ids]
    await Promise.all(
      Array.from({ length: LOCAL_CONCURRENCY }, async () => {
        while (queue.length > 0 && !cancelled.current) {
          const id = queue.shift()
          if (!id) break
          const entry = byId.get(id)
          if (!entry) continue
          try {
            await applyImportResult(id, { importState: 'running' })
            const extraction = await extractSite({ data: { url: entry.url } })
            // Same guard the Cloud Function runs: the crawl follows redirects,
            // and the site it landed on may already be someone's lead.
            const landed = normalizeDomain(extraction.domain)
            if (landed !== normalizeDomain(entry.domain)) {
              const clash = await findLeadIdByDomain(landed)
              if (clash && clash !== id) {
                await applyImportResult(id, {
                  importState: 'failed',
                  importError: `${entry.domain} redirects to ${landed}, which is already a lead. Nothing was imported, so the business is not contacted twice.`,
                })
                continue
              }
            }
            await applyImportResult(id, {
              extraction,
              companyName: extraction.companyName,
              domain: landed,
              status: 'researched',
            })
            const proposition = await generateProposition({ data: { extraction } })
            await applyImportResult(id, {
              proposition,
              status: 'doc_ready',
              importState: null,
              importError: null,
            })
          } catch (e) {
            await applyImportResult(id, {
              importState: 'failed',
              importError: messageOf(e),
            }).catch(() => {})
          }
        }
      }),
    )
  }

  async function run() {
    if (!user || fresh.length === 0) return
    setError(null)
    setNotice(null)

    let created: QueuedLeads['created']
    try {
      setPhase({ key: 'creating' })
      const result = await createQueuedLeads(fresh, user.uid)
      created = result.created
      setBatchIds(created.map((c) => c.id))
      if (result.skipped.length > 0) {
        // The list on screen is built from a snapshot; Firestore knew about
        // leads it had not caught up on, and those are the ones dropped here.
        setNotice(
          `${result.skipped.length} more ${result.skipped.length === 1 ? 'business was' : 'businesses were'} already in the pipeline and ${result.skipped.length === 1 ? 'was' : 'were'} skipped: ${result.skipped.map((d) => d.domain).join(', ')}`,
        )
      }
      if (created.length === 0) {
        setPhase({ key: 'done' })
        return
      }
    } catch (e) {
      setError(messageOf(e))
      setPhase({ key: 'idle' })
      return
    }
    const ids = created.map((c) => c.id)

    setPhase({ key: 'dispatching' })
    try {
      const dispatch = await startBulkImport({ data: { leadIds: ids } })
      if (dispatch.failed.length > 0) {
        setNotice(
          `${dispatch.failed.length} of ${ids.length} could not be queued; they are marked failed below.`,
        )
      }
      setPhase({ key: 'remote' })
      return
    } catch (e) {
      const message = messageOf(e)
      if (!message.includes(IMPORT_NOT_CONFIGURED)) {
        // The functions exist but the hand-off broke; nobody is coming for
        // these leads, so mark them failed rather than leave them "Queued".
        await failQueuedLeads(
          ids,
          `The batch could not be handed to the import functions: ${message}`,
        ).catch(() => {})
        setError(message)
        setPhase({ key: 'remote' })
        return
      }
    }

    // No Cloud Function configured: do the work from this tab instead.
    setNotice(
      'The bulk import functions are not deployed, so this import is running in the browser. Keep this tab open until it finishes.',
    )
    setPhase({ key: 'local' })
    const byId = new Map(created.map((c) => [c.id, { url: c.url, domain: c.domain }]))
    await processLocally(ids, byId)
  }

  const total = batchIds.length
  const finished = counts.done + counts.failed

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a list of websites - one per line, or straight out of a
          spreadsheet. Each business is researched separately, so a batch of
          hundreds just takes as long as the slowest few.
        </p>
      </div>

      {phase.key === 'idle' || phase.key === 'creating' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersIcon size={16} className="text-muted-foreground" />
              Websites to research
            </CardTitle>
            <CardDescription>
              Anything that is not a web address is skipped, including email
              addresses. Businesses already in the pipeline are left alone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={'acmeplumbing.com.au\nsparkyselectrical.com.au\nhttps://firstclasspainting.com.au'}
              rows={12}
              disabled={phase.key === 'creating'}
              className="font-mono text-xs"
              autoFocus
            />

            {raw.trim() ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <GlobeIcon size={12} />
                  {fresh.length} to import
                </Badge>
                {alreadyKnown > 0 ? (
                  <Badge className="border-border bg-muted/60 text-foreground/80">
                    {alreadyKnown} already in the pipeline, skipped
                  </Badge>
                ) : null}
                {rejected.length > 0 ? (
                  <Badge className="border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                    {rejected.length} {rejected.length === 1 ? 'line' : 'lines'} not
                    understood
                  </Badge>
                ) : null}
              </div>
            ) : null}

            {rejected.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Skipping: {rejected.slice(0, 5).join(', ')}
                {rejected.length > 5 ? ` and ${rejected.length - 5} more` : ''}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void run()}
                disabled={phase.key === 'creating' || fresh.length === 0}
              >
                {phase.key === 'creating' ? <Spinner /> : null}
                {phase.key === 'creating'
                  ? 'Creating leads…'
                  : `Import ${fresh.length || ''} ${fresh.length === 1 ? 'lead' : 'leads'}`}
              </Button>
              <p className="text-xs text-muted-foreground">
                Research and doc-writing run in the background; you can leave
                once the batch is on its way.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {phase.key === 'done' ? (
                <CheckIcon size={16} className="text-emerald-500" />
              ) : (
                <Spinner className="size-4" />
              )}
              {phase.key === 'done'
                ? 'Import finished'
                : phase.key === 'dispatching'
                  ? 'Handing the batch to the import functions…'
                  : `Importing ${total} ${total === 1 ? 'business' : 'businesses'}`}
            </CardTitle>
            <CardDescription>
              {phase.key === 'local'
                ? 'Running in this tab. Keep it open until the batch finishes.'
                : phase.key === 'done'
                  ? `${counts.done} researched${counts.failed ? `, ${counts.failed} failed` : ''}.`
                  : 'Each business runs on its own; progress lands here live.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: total ? `${(finished / total) * 100}%` : '0%' }}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                {counts.done} done
              </Badge>
              <Badge className="border-border bg-muted/60 text-foreground/80">
                {counts.running} working
              </Badge>
              <Badge className="border-border bg-muted/60 text-foreground/80">
                {counts.queued} waiting
              </Badge>
              {counts.failed > 0 ? (
                <Badge className="border-destructive/25 bg-destructive/10 text-destructive">
                  {counts.failed} failed
                </Badge>
              ) : null}
            </div>

            {batch.some((l) => l.importState === 'failed') ? (
              <div className="space-y-2">
                {batch
                  .filter((l) => l.importState === 'failed')
                  .map((l) => (
                    <Alert key={l.id} tone="destructive" title={l.domain}>
                      <p className="flex items-start gap-1.5 text-xs">
                        <AlertCircleIcon size={13} className="mt-0.5 shrink-0" />
                        {l.importError ?? 'No reason recorded.'}
                      </p>
                    </Alert>
                  ))}
              </div>
            ) : null}

            <div className={cn('flex flex-wrap gap-3', phase.key !== 'done' && 'opacity-90')}>
              <Link to="/" className={buttonClass('outline', 'sm')}>
                Back to the pipeline
              </Link>
              {phase.key === 'done' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRaw('')
                    setBatchIds([])
                    setNotice(null)
                    setError(null)
                    setPhase({ key: 'idle' })
                  }}
                >
                  Import another batch
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}

      {notice ? <Alert>{notice}</Alert> : null}
      {error ? (
        <Alert tone="destructive" title={error}>
          <p className="text-xs">
            The leads that were created stay in the pipeline; failed ones can be
            retried from their lead page.
          </p>
        </Alert>
      ) : null}
    </div>
  )
}
