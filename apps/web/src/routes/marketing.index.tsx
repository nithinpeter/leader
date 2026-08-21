import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AppShell, Protected } from '../components/AppShell'
import { ExternalLinkIcon, ImageIcon, PaletteIcon, PlusIcon, TrashIcon } from '../components/icons'
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Skeleton,
  Spinner,
  Textarea,
  buttonClass,
} from '../components/ui'
import {
  escapeLittleText,
  LINKEDIN_COMMENTARY_LIMIT,
  type MarketingPost,
} from '@leader/core/marketing-core'
import {
  clearMarketingCard,
  createMarketingPost,
  deleteMarketingPost,
  getMarketingCard,
  markMarketingPosted,
  setMarketingCard,
  setMarketingStatus,
  subscribeToMarketingPosts,
  updateMarketingDraft,
} from '../lib/marketing'
import { marketingConfigured, publishToLinkedIn } from '../server/marketing'

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
 * The marketing pipeline: draft LinkedIn posts, review them against the
 * checklist, approve, publish to the company page. Posts and their cards
 * live in Firestore alongside the rest of Leader's data; only the publish
 * call touches a server function, because it holds the LinkedIn token.
 */

function statusBadgeClass(status: string) {
  if (status === 'posted') return 'bg-sage-deep text-white'
  if (status === 'approved') return 'border-sage-deep text-sage-deep'
  return 'border-border text-muted-foreground'
}

function Marketing() {
  const [posts, setPosts] = useState<MarketingPost[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [cards, setCards] = useState<Record<string, string>>({})
  const cardsRef = useRef(cards)
  cardsRef.current = cards

  useEffect(() => {
    const unsub = subscribeToMarketingPosts(
      (next) => {
        setPosts(next)
        setError(null)
      },
      (e) => setError(e.message),
    )
    void marketingConfigured()
      .then((r) => setConfigured(r.configured))
      .catch(() => {})
    return unsub
  }, [])

  // Cards are fetched one doc each, once, and refreshed when a post's
  // updatedAt moves (an upload or removal bumps it).
  const stamps = (posts ?? [])
    .filter((p) => p.hasImage)
    .map((p) => `${p.id}:${p.updatedAt}`)
    .join(',')
  useEffect(() => {
    for (const p of posts ?? []) {
      if (!p.hasImage) continue
      const key = `${p.id}:${p.updatedAt}`
      if (cardsRef.current[key]) continue
      void getMarketingCard(p.id)
        .then((data) => {
          if (data) setCards((m) => ({ ...m, [key]: data }))
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamps])

  const cardFor = (p: MarketingPost) => cards[`${p.id}:${p.updatedAt}`]
  const post = posts?.find((p) => p.id === selected) ?? null

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Marketing · LinkedIn queue
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Draft posts, review them against the checklist, approve, publish to the
            company page. Posted is final.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!configured ? (
            <span className="text-xs font-medium text-clay">LinkedIn credentials missing</span>
          ) : null}
          <Link to="/marketing/cards" className={buttonClass('outline', 'sm')}>
            <ImageIcon size={14} />
            Card templates
          </Link>
          <Link to="/marketing/brand" className={buttonClass('outline', 'sm')}>
            <PaletteIcon size={14} />
            Brand guidelines
          </Link>
          <Button
            size="sm"
            onClick={() => {
              setSelected(null)
              setCreating(true)
            }}
          >
            <PlusIcon size={14} />
            New post
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-6">
          <Alert tone="destructive">{error}</Alert>
        </div>
      ) : creating ? (
        <NewPost
          onDone={(id) => {
            setCreating(false)
            if (id) setSelected(id)
          }}
        />
      ) : post ? (
        <Review
          post={post}
          card={cardFor(post)}
          configured={configured}
          onBack={() => setSelected(null)}
        />
      ) : posts === null ? (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5] w-full" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="font-display text-lg font-semibold">Nothing in the queue.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Write the first post with <b>New post</b>. If it carries a card, compose one
            from the templates and attach the PNG — the brand rules are one click away.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
          {posts.map((p) => (
            <Card
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelected(p.id)
              }}
              className="cursor-pointer gap-0 overflow-hidden py-0 transition-colors hover:border-ring"
            >
              {p.hasImage ? (
                cardFor(p) ? (
                  <img
                    src={cardFor(p)}
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
                <span className="text-sm font-medium leading-snug">{p.title || 'Untitled'}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function CharCount({ body }: { body: string }) {
  const chars = escapeLittleText(body).length
  const over = chars > LINKEDIN_COMMENTARY_LIMIT
  return (
    <span className={over ? 'font-medium text-destructive' : 'text-muted-foreground'}>
      {chars.toLocaleString()} of {LINKEDIN_COMMENTARY_LIMIT.toLocaleString()} characters
      {over ? ' — too long to post' : ''}
    </span>
  )
}

function NewPost({ onDone }: { onDone: (id: string | null) => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setErr(null)
    try {
      const id = await createMarketingPost({ title, body, imageAlt: null })
      onDone(id)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl">
      <button
        type="button"
        onClick={() => onDone(null)}
        className="text-sm text-sage-deep underline underline-offset-2 hover:no-underline"
      >
        ← Back to the queue
      </button>
      <h2 className="mt-4 font-display text-xl font-semibold tracking-tight">New post</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Write to the rules at{' '}
        <Link to="/marketing/brand" className="text-sage-deep underline underline-offset-2">
          brand guidelines
        </Link>
        . The body goes out exactly as written here. Attach a card after saving.
      </p>
      <div className="mt-5 grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Title (internal — never posted)</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The gap we work in" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Post text</span>
          <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
          <span className="text-xs">
            <CharCount body={body} />
          </span>
        </label>
      </div>
      {err ? (
        <div className="mt-4">
          <Alert tone="destructive">{err}</Alert>
        </div>
      ) : null}
      <div className="mt-5 flex gap-3">
        <Button disabled={busy || !title.trim() || !body.trim()} onClick={() => void create()}>
          {busy ? <Spinner className="size-4" /> : null}
          Save draft
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Review({
  post,
  card,
  configured,
  onBack,
}: {
  post: MarketingPost
  card: string | undefined
  configured: boolean
  onBack: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{
    kind: 'ok' | 'err'
    text: string
    url?: string
  } | null>(null)

  // Draft edits are buffered locally and written on Save.
  const [title, setTitle] = useState(post.title)
  const [body, setBody] = useState(post.body)
  const [imageAlt, setImageAlt] = useState(post.imageAlt ?? '')
  const [editingId, setEditingId] = useState(post.id)
  if (editingId !== post.id) {
    setEditingId(post.id)
    setTitle(post.title)
    setBody(post.body)
    setImageAlt(post.imageAlt ?? '')
    setNote(null)
  }
  const draft = post.status === 'draft'
  const dirty =
    draft &&
    (title !== post.title || body !== post.body || imageAlt !== (post.imageAlt ?? ''))

  async function run(doing: () => Promise<void>) {
    setBusy(true)
    setNote(null)
    try {
      await doing()
    } catch (e) {
      setNote({ kind: 'err', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(() => updateMarketingDraft(post, { title, body, imageAlt: imageAlt.trim() || null }))

  const approve = () =>
    run(async () => {
      if (dirty) await updateMarketingDraft(post, { title, body, imageAlt: imageAlt.trim() || null })
      await setMarketingStatus(post, 'approved')
    })

  const remove = () =>
    run(async () => {
      if (!window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return
      await deleteMarketingPost(post)
      onBack()
    })

  async function attachCard(file: File) {
    await run(async () => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(new Error('Could not read the file.'))
        r.readAsDataURL(file)
      })
      await setMarketingCard(post, dataUrl)
    })
  }

  const publish = () =>
    run(async () => {
      if (!window.confirm(`Post "${post.title}" to the company LinkedIn page now?`)) return
      const imageData = post.hasImage ? (card ?? (await getMarketingCard(post.id))) : null
      if (post.hasImage && !imageData) throw new Error('The card image could not be loaded.')
      const r = await publishToLinkedIn({
        data: {
          body: post.body,
          imageBase64: imageData ? imageData.split(',')[1] : null,
          imageAlt: post.imageAlt,
        },
      })
      // The post is live from here; if the stamp below fails, surface the URN
      // so the record can be fixed by hand rather than posted twice.
      try {
        await markMarketingPosted(post.id, r.urn)
        setNote({ kind: 'ok', text: 'Posted — ', url: r.url })
      } catch (e) {
        setNote({
          kind: 'err',
          text: `The post IS live (${r.urn}) but recording it failed: ${(e as Error).message}. Do not publish again — fix the record first. `,
          url: r.url,
        })
      }
    })

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
          {post.hasImage ? (
            card ? (
              <img src={card} alt={post.imageAlt ?? ''} className="w-full border border-border" />
            ) : (
              <Skeleton className="aspect-[1080/1350] w-full" />
            )
          ) : (
            <div className="flex aspect-[1080/1350] w-full flex-col items-center justify-center gap-2 border border-dashed border-border text-muted-foreground">
              <ImageIcon size={28} />
              <span className="text-sm">Text-only post</span>
            </div>
          )}
          {draft ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <label className={buttonClass('outline', 'sm', busy ? 'pointer-events-none opacity-50' : 'cursor-pointer')}>
                {post.hasImage ? 'Replace card' : 'Attach card (PNG)'}
                <input
                  type="file"
                  accept="image/png"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void attachCard(f)
                  }}
                />
              </label>
              {post.hasImage ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => clearMarketingCard(post))}>
                  Remove card
                </Button>
              ) : null}
              <span className="w-full text-xs text-muted-foreground">
                Compose it from the{' '}
                <Link to="/marketing/cards" className="underline underline-offset-2">
                  templates
                </Link>{' '}
                and shoot it with <code>pnpm shoot:cards</code>.
              </span>
            </div>
          ) : null}
        </div>

        <div>
          <Badge className={statusBadgeClass(post.status)}>{post.status}</Badge>

          {draft ? (
            <div className="mt-3 grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Title (internal — never posted)</span>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Post text</span>
                <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
                <span className="text-xs">
                  <CharCount body={body} />
                </span>
              </label>
              {post.hasImage ? (
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">Card alt text</span>
                  <Textarea rows={2} value={imageAlt} onChange={(e) => setImageAlt(e.target.value)} />
                </label>
              ) : null}
            </div>
          ) : (
            <>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">
                {post.title}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                <CharCount body={post.body} />
              </p>
              <div className="mt-4 whitespace-pre-wrap rounded-md border border-border bg-card p-5 text-sm leading-relaxed">
                {post.body}
              </div>
              {post.imageAlt ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  <b className="text-foreground/80">Alt text:</b> {post.imageAlt}
                </p>
              ) : null}
            </>
          )}

          <ul className="mt-5 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>No word from the banned list has crept in.</li>
            <li>Every number still matches the page it came from.</li>
            <li>Field-note dates are current — a posted image cannot be corrected.</li>
            <li>Nothing claims certified, accredited or endorsed by OpenAI.</li>
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {post.status === 'posted' ? (
              <p className="text-sm text-sage-deep">
                Posted {(post.postedAt ?? '').slice(0, 10)} —{' '}
                <a
                  href={`https://www.linkedin.com/feed/update/${post.postUrn}/`}
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
                {draft ? (
                  <>
                    <Button variant="outline" disabled={busy || !dirty} onClick={() => void save()}>
                      Save changes
                    </Button>
                    <Button variant="outline" disabled={busy || !title.trim() || !body.trim()} onClick={() => void approve()}>
                      Approve
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={() => void run(() => setMarketingStatus(post, 'draft'))}>
                    Back to draft
                  </Button>
                )}
                <Button disabled={busy || post.status !== 'approved' || !configured} onClick={() => void publish()}>
                  {busy ? <Spinner className="size-4" /> : null}
                  Publish to LinkedIn
                </Button>
                {draft ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      Approve first — the publish button only works on approved posts.
                    </span>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
                      <TrashIcon size={14} />
                      Delete
                    </Button>
                  </>
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
