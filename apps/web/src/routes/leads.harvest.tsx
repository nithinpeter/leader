import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { AppShell, Protected } from '../components/AppShell'
import {
  AlertCircleIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  SearchIcon,
  UploadIcon,
} from '../components/icons'
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
  cn,
} from '../components/ui'
import { subscribeToLeads } from '../lib/leads'
import { normalizeDomain, type Lead } from '@leader/core/types'
import type { HarvestedSite } from '@leader/core/harvest-core'
import { harvestDirectoryFn } from '../server/harvest'

export const Route = createFileRoute('/leads/harvest')({
  component: () => (
    <AppShell
      breadcrumbs={[
        { label: 'Dashboard', to: '/' },
        { label: 'Leads', to: '/' },
        { label: 'Harvest directories' },
      ]}
    >
      <Protected>
        <Harvest />
      </Protected>
    </AppShell>
  ),
})

/** The sessionStorage key bulk import reads its prefill from. */
export const HARVEST_HANDOFF_KEY = 'leader:harvest-handoff'

/**
 * Starting points per trade: the professional bodies whose public directories
 * list member businesses. The links land on each body's find-a-member page or
 * home page; the page to harvest is the one that lists members, so navigate
 * to the listing (pick a region or category if the directory asks) and paste
 * that address here.
 */
const CATEGORIES: {
  key: string
  label: string
  sources: { org: string; directory: string; url: string }[]
}[] = [
  {
    key: 'accountants',
    label: 'Accountants',
    sources: [
      {
        org: 'CPA Australia',
        directory: 'Find a CPA',
        url: 'https://www.cpaaustralia.com.au/',
      },
      {
        org: 'Chartered Accountants ANZ',
        directory: 'Find a CA',
        url: 'https://www.charteredaccountantsanz.com/',
      },
      {
        org: 'Institute of Public Accountants',
        directory: 'Find an accountant',
        url: 'https://www.publicaccountants.org.au/',
      },
    ],
  },
  {
    key: 'builders',
    label: 'Builders',
    sources: [
      {
        org: 'Master Builders (state associations)',
        directory: 'Find a builder',
        url: 'https://www.masterbuilders.com.au/',
      },
      {
        org: 'Housing Industry Association',
        directory: 'Find a professional',
        url: 'https://hia.com.au/',
      },
    ],
  },
  {
    key: 'law',
    label: 'Law firms',
    sources: [
      {
        org: 'Law Society of NSW',
        directory: 'Find a lawyer',
        url: 'https://www.lawsociety.com.au/',
      },
      {
        org: 'Queensland Law Society',
        directory: 'Find a solicitor',
        url: 'https://www.qls.com.au/',
      },
      {
        org: 'Law Institute of Victoria',
        directory: 'Find your lawyer',
        url: 'https://www.liv.asn.au/',
      },
    ],
  },
  {
    key: 'tuition',
    label: 'School tuition',
    sources: [
      {
        org: 'Australian Tutoring Association',
        directory: 'Member directory',
        url: 'https://ata.edu.au/',
      },
    ],
  },
  {
    key: 'music',
    label: 'Music',
    sources: [
      {
        org: 'Music Teachers’ Association of NSW',
        directory: 'Find a teacher',
        url: 'https://www.musicnsw.com.au/',
      },
      {
        org: 'Victorian Music Teachers’ Association',
        directory: 'Find a teacher',
        url: 'https://www.vmta.org.au/',
      },
    ],
  },
  {
    key: 'sports',
    label: 'Sports',
    sources: [
      {
        org: 'AUSactive',
        directory: 'Registered businesses',
        url: 'https://ausactive.org.au/',
      },
    ],
  },
  {
    key: 'touring',
    label: 'Touring and sightseeing',
    sources: [
      {
        org: 'Australian Tourism Export Council',
        directory: 'Member directory',
        url: 'https://www.atec.net.au/',
      },
      {
        org: 'Tourism Council WA',
        directory: 'Member directory',
        url: 'https://www.tourismcouncilwa.com.au/',
      },
    ],
  },
  {
    key: 'compliance',
    label: 'Compliance',
    sources: [
      {
        org: 'Governance Institute of Australia',
        directory: 'Member directory',
        url: 'https://www.governanceinstitute.com.au/',
      },
      {
        org: 'GRC Institute',
        directory: 'Member directory',
        url: 'https://thegrcinstitute.org/',
      },
    ],
  },
]

/** How many directories are read at once. */
const DIRECTORY_CONCURRENCY = 2

interface DirectoryRun {
  url: string
  state: 'pending' | 'running' | 'done' | 'failed'
  found: number
  notes: string[]
  error?: string
}

type FoundSite = HarvestedSite & { directory: string }

function parseDirectoryUrls(raw: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of raw.split(/\r?\n/)) {
    const token = line.trim()
    if (!token || !token.includes('.')) continue
    const withScheme = /^https?:\/\//i.test(token) ? token : `https://${token}`
    try {
      const url = new URL(withScheme)
      if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) continue
      if (seen.has(url.href)) continue
      seen.add(url.href)
      out.push(url.href)
    } catch {}
  }
  return out
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong'
}

function Harvest() {
  const navigate = useNavigate()
  const [raw, setRaw] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [runs, setRuns] = useState<DirectoryRun[]>([])
  const [sites, setSites] = useState<FoundSite[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [leads, setLeads] = useState<Lead[] | null>(null)

  useEffect(() => subscribeToLeads(setLeads, (e) => setError(e.message)), [])

  const urls = useMemo(() => parseDirectoryUrls(raw), [raw])
  const existingDomains = useMemo(
    () => new Set((leads ?? []).map((l) => normalizeDomain(l.domain))),
    [leads],
  )
  const fresh = sites.filter((s) => !existingDomains.has(s.domain))
  const alreadyKnown = sites.length - fresh.length
  const picked = CATEGORIES.find((c) => c.key === category) ?? null

  function addSource(url: string) {
    setRaw((prev) => {
      const lines = prev.split(/\r?\n/).map((l) => l.trim())
      if (lines.includes(url)) return prev
      return prev.trim() ? `${prev.trimEnd()}\n${url}` : url
    })
  }

  async function run() {
    if (urls.length === 0 || working) return
    setError(null)
    setCopied(false)
    setSites([])
    setWorking(true)
    const startedRuns: DirectoryRun[] = urls.map((url) => ({
      url,
      state: 'pending',
      found: 0,
      notes: [],
    }))
    setRuns(startedRuns)
    const update = (url: string, patch: Partial<DirectoryRun>) =>
      setRuns((prev) => prev.map((r) => (r.url === url ? { ...r, ...patch } : r)))

    const queue = [...urls]
    const collected = new Map<string, FoundSite>()
    await Promise.all(
      Array.from({ length: DIRECTORY_CONCURRENCY }, async () => {
        while (queue.length > 0) {
          const url = queue.shift()
          if (!url) break
          update(url, { state: 'running' })
          try {
            const result = await harvestDirectoryFn({ data: { url } })
            let found = 0
            for (const site of result.sites) {
              if (!collected.has(site.domain)) {
                collected.set(site.domain, { ...site, directory: url })
                found++
              }
            }
            setSites([...collected.values()])
            update(url, { state: 'done', found, notes: result.notes })
          } catch (e) {
            update(url, { state: 'failed', error: messageOf(e) })
          }
        }
      }),
    )
    setWorking(false)
  }

  async function copyList() {
    await navigator.clipboard.writeText(fresh.map((s) => s.url).join('\n'))
    setCopied(true)
  }

  function sendToImport() {
    sessionStorage.setItem(HARVEST_HANDOFF_KEY, fresh.map((s) => s.url).join('\n'))
    void navigate({ to: '/leads/import' })
  }

  const finished = !working && runs.length > 0

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Harvest directories</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Professional bodies publish directories of their members - find a CPA,
          find a builder, find a lawyer. Paste a directory listing here and the
          member websites on it are pulled out, ready for bulk import.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SearchIcon size={16} className="text-muted-foreground" />
            Directory pages to read
          </CardTitle>
          <CardDescription>
            One listing page per line. The page must show the members as plain
            links - a directory that draws its results with JavaScript looks
            empty from here, so paste the address of a results page where the
            members are visible in the page itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(category === c.key ? null : c.key)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  category === c.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-muted/40 text-foreground/80 hover:bg-muted',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          {picked ? (
            <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                Places to start for {picked.label.toLowerCase()}. Each link opens
                the organisation; find its member directory (named below), run a
                search if it asks for one, and paste the listing address above.
              </p>
              {picked.sources.map((s) => (
                <div key={s.url} className="flex flex-wrap items-center gap-2 text-xs">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                  >
                    {s.org}
                    <ExternalLinkIcon size={11} className="text-muted-foreground" />
                  </a>
                  <span className="text-muted-foreground">{s.directory}</span>
                  <button
                    type="button"
                    onClick={() => addSource(s.url)}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    add
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={
              'https://www.example-lawsociety.org.au/find-a-lawyer?region=melbourne\nhttps://www.example-builders.asn.au/members'
            }
            rows={5}
            disabled={working}
            className="font-mono text-xs"
          />

          <div className="flex items-center gap-3">
            <Button onClick={() => void run()} disabled={working || urls.length === 0}>
              {working ? <Spinner /> : <GlobeIcon size={16} />}
              {working
                ? 'Reading directories…'
                : `Read ${urls.length || ''} ${urls.length === 1 ? 'directory' : 'directories'}`}
            </Button>
            <p className="text-xs text-muted-foreground">
              Reads a few pages per directory, follows member profiles where the
              website sits one click in, and skips social links and platforms.
            </p>
          </div>
        </CardContent>
      </Card>

      {runs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {working ? (
                <Spinner className="size-4" />
              ) : (
                <CheckIcon size={16} className="text-emerald-500" />
              )}
              {working
                ? 'Reading…'
                : `${sites.length} ${sites.length === 1 ? 'website' : 'websites'} found`}
            </CardTitle>
            {finished && alreadyKnown > 0 ? (
              <CardDescription>
                {alreadyKnown} of them {alreadyKnown === 1 ? 'is' : 'are'} already in
                the pipeline and will be skipped on import.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {runs.map((r) => (
                <div key={r.url} className="space-y-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.state === 'running' ? (
                      <Spinner className="size-3" />
                    ) : r.state === 'failed' ? (
                      <AlertCircleIcon size={13} className="text-destructive" />
                    ) : r.state === 'done' ? (
                      <CheckIcon size={13} className="text-emerald-500" />
                    ) : (
                      <span className="inline-block size-3 rounded-full border border-border" />
                    )}
                    <span className="max-w-full truncate font-mono">{r.url}</span>
                    {r.state === 'done' ? (
                      <Badge className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                        {r.found} new
                      </Badge>
                    ) : null}
                  </div>
                  {r.error ? <p className="pl-5 text-destructive">{r.error}</p> : null}
                  {r.notes.map((n) => (
                    <p key={n} className="pl-5 text-muted-foreground">
                      {n}
                    </p>
                  ))}
                </div>
              ))}
            </div>

            {sites.length > 0 ? (
              <>
                <div className="max-h-96 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <tbody>
                      {sites.map((s) => (
                        <tr key={s.domain} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5">
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono underline-offset-2 hover:underline"
                            >
                              {s.domain}
                            </a>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {s.name}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {existingDomains.has(s.domain) ? (
                              <Badge className="border-border bg-muted/60 text-foreground/80">
                                in pipeline
                              </Badge>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {finished ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={sendToImport} disabled={fresh.length === 0}>
                      <UploadIcon size={16} />
                      Send {fresh.length} to bulk import
                    </Button>
                    <Button variant="outline" onClick={() => void copyList()}>
                      <CopyIcon size={16} />
                      {copied ? 'Copied' : 'Copy list'}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {error ? <Alert tone="destructive">{error}</Alert> : null}
    </div>
  )
}
