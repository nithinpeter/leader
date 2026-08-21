import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell, Protected } from '../components/AppShell'
import { ExternalLinkIcon, ImageIcon, PaletteIcon } from '../components/icons'
import { Alert, Badge, Button, Card, Skeleton, Spinner, buttonClass } from '../components/ui'
import type { MarketingQueue } from '../server/marketing'
import {
  marketingImage,
  marketingQueue,
  publishMarketingPost,
  setMarketingStatus,
} from '../server/marketing'

export const Route = createFileRoute('/marketing/')({
  component: () => (
    <AppShell breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Marketing' }]}>
      <Protected>
        <Marketing />
      </Protected>
    </AppShell>
  ),
})

/**
 * The marketing pipeline, moved here from the westringia.com Netlify admin.
 * The collateral itself still lives in the westringia repo (docs/social):
 * this page lists the LinkedIn queue, and approve / publish write back there
 * as commits, so git stays the log of what went out and when.
 */

function statusBadgeClass(status: string) {
  if (status === 'posted') return 'bg-sage-deep text-white'
  if (status === 'approved') return 'border-sage-deep text-sage-deep'
  return 'border-border text-muted-foreground'
}

function Marketing() {
  const [queue, setQueue] = useState<MarketingQueue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [images, setImages] = useState<Record<string, string>>({})
  const imagesRef = useRef(images)
  imagesRef.current = images

  const load = useCallback(async () => {
    try {
      const data = await marketingQueue()
      setQueue(data)
      setError(null)
      // Card PNGs arrive as data URLs, one call each, fetched once and kept.
      for (const post of data.posts) {
        const name = post.image
        if (!name || imagesRef.current[name]) continue
        void marketingImage({ data: { name } })
          .then(({ dataUrl }) => setImages((m) => ({ ...m, [name]: dataUrl })))
          .catch(() => {})
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Header queue={queue} />
        <div className="mt-6">
          <Alert tone="destructive">{error}</Alert>
        </div>
      </div>
    )
  }

  const post = queue?.posts.find((p) => p.file === selected) ?? null

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Header queue={queue} />

      {!queue ? (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5] w-full" />
          ))}
        </div>
      ) : post ? (
        <Review
          post={post}
          image={post.image ? images[post.image] : undefined}
          configured={queue.configured}
          onBack={() => setSelected(null)}
          onChanged={load}
        />
      ) : (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
          {queue.posts.map((p) => (
            <Card
              key={p.file}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(p.file)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelected(p.file)
              }}
              className="cursor-pointer gap-0 overflow-hidden py-0 transition-colors hover:border-ring"
            >
              {p.image ? (
                images[p.image] ? (
                  <img
                    src={images[p.image]}
                    alt=""
                    className="block aspect-[1080/1350] w-full border-b border-border object-cover"
                  />
                ) : (
                  <Skeleton className="aspect-[1080/1350] w-full rounded-none border-b border-border" />
                )
              ) : (
                <div className="flex aspect-[1080/1350] w-full items-center justify-center border-b border-border bg-muted/40 text-muted-foreground">
                  <ImageIcon size={28} />
                </div>
              )}
              <div className="grid gap-1.5 p-3">
                <Badge className={statusBadgeClass(p.status)}>{p.status}</Badge>
                <span className="text-sm font-medium leading-snug">{p.title}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Header({ queue }: { queue: MarketingQueue | null }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Marketing · LinkedIn queue
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review the queued posts, approve them, and publish to the company page.
          Approvals and publishes are written back to the westringia repo as commits.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {queue ? (
          <span className="text-xs text-muted-foreground">
            store: {queue.store === 'github' ? 'GitHub' : 'local files'} ·{' '}
            {queue.configured.token && queue.configured.orgId ? (
              'credentials configured'
            ) : (
              <span className="font-medium text-clay">credentials missing</span>
            )}
          </span>
        ) : null}
        <Link to="/marketing/cards" className={buttonClass('outline', 'sm')}>
          <ImageIcon size={14} />
          Card templates
        </Link>
        <Link to="/marketing/brand" className={buttonClass('outline', 'sm')}>
          <PaletteIcon size={14} />
          Brand guidelines
        </Link>
      </div>
    </div>
  )
}

function Review({
  post,
  image,
  configured,
  onBack,
  onChanged,
}: {
  post: MarketingQueue['posts'][number]
  image: string | undefined
  configured: { token: boolean; orgId: boolean }
  onBack: () => void
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string; url?: string } | null>(null)

  async function mark(to: 'draft' | 'approved') {
    setBusy(true)
    setNote(null)
    try {
      await setMarketingStatus({ data: { file: post.file, to } })
      await onChanged()
    } catch (e) {
      setNote({ kind: 'err', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function doPublish() {
    if (!window.confirm(`Post "${post.title}" to the company LinkedIn page now?`)) return
    setBusy(true)
    setNote(null)
    try {
      const r = await publishMarketingPost({ data: { file: post.file } })
      await onChanged()
      setNote({ kind: 'ok', text: 'Posted — ', url: r.url })
    } catch (e) {
      setNote({ kind: 'err', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-sage-deep underline underline-offset-2 hover:no-underline"
      >
        ← All posts
      </button>

      <div className="mt-4 grid gap-10 md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div>
          {post.image ? (
            image ? (
              <img
                src={image}
                alt={post.image_alt ?? ''}
                className="w-full border border-border"
              />
            ) : (
              <Skeleton className="aspect-[1080/1350] w-full" />
            )
          ) : (
            <p className="text-sm text-muted-foreground">Text-only post.</p>
          )}
        </div>

        <div>
          <Badge className={statusBadgeClass(post.status)}>{post.status}</Badge>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            {post.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {post.file} · {post.chars.toLocaleString()} of 3,000 characters
          </p>

          <div className="mt-4 whitespace-pre-wrap rounded-md border border-border bg-card p-5 text-sm leading-relaxed">
            {post.body}
          </div>

          {post.image_alt ? (
            <p className="mt-3 text-xs text-muted-foreground">
              <b className="text-foreground/80">Alt text:</b> {post.image_alt}
            </p>
          ) : null}

          <ul className="mt-5 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>No word from the banned list has crept in.</li>
            <li>Every number still matches the page it came from.</li>
            <li>Field-note dates are current — a posted image cannot be corrected.</li>
            <li>Nothing claims certified, accredited or endorsed by OpenAI.</li>
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {post.status === 'posted' ? (
              <p className="text-sm text-sage-deep">
                Posted {(post.posted_at ?? '').slice(0, 10)} —{' '}
                <a
                  href={`https://www.linkedin.com/feed/update/${post.post_urn}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  view on LinkedIn
                </a>
                .
              </p>
            ) : (
              <>
                {post.status === 'draft' ? (
                  <Button variant="outline" disabled={busy} onClick={() => void mark('approved')}>
                    Approve
                  </Button>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={() => void mark('draft')}>
                    Back to draft
                  </Button>
                )}
                <Button
                  disabled={
                    busy || post.status !== 'approved' || !configured.token || !configured.orgId
                  }
                  onClick={() => void doPublish()}
                >
                  {busy ? <Spinner className="size-4" /> : null}
                  Publish to LinkedIn
                </Button>
                {post.status === 'draft' ? (
                  <span className="text-xs text-muted-foreground">
                    Approve first — the publish button only works on approved posts.
                  </span>
                ) : null}
              </>
            )}
          </div>

          {note ? (
            <div className="mt-4">
              <Alert tone={note.kind === 'ok' ? 'success' : 'destructive'}>
                {note.text}
                {note.url ? (
                  <a
                    href={note.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-2"
                  >
                    view on LinkedIn <ExternalLinkIcon size={12} />
                  </a>
                ) : null}
              </Alert>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
