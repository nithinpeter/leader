import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { firestore } from './firebase'
import type { MarketingPost, MarketingPostStatus } from '@leader/core/marketing-core'

/**
 * The marketing queue's store: Firestore, owned by the client the same way
 * leads are. `marketing_posts` holds the posts; each card PNG sits alone in
 * `marketing_cards/{postId}` as a data URL, so the queue list stays light and
 * an image is fetched only when a card is shown.
 *
 * Status moves draft → approved → posted, and only ever forward. Posted is
 * terminal: the guards here refuse every edit, status change and delete on a
 * posted post, so the record of what went out can never quietly change.
 */

const POSTS = 'marketing_posts'
const CARDS = 'marketing_cards'

// Firestore caps a document at 1 MiB; the data-URL string plus field
// overhead has to fit under it. Real cards run 150–600 KB as data URLs.
const MAX_CARD_DATA_URL = 950_000

function postsCollection() {
  return collection(firestore(), POSTS)
}

export function subscribeToMarketingPosts(
  onPosts: (posts: MarketingPost[]) => void,
  onError: (err: Error) => void,
) {
  const q = query(postsCollection(), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      onPosts(snap.docs.map((d) => ({ ...(d.data() as Omit<MarketingPost, 'id'>), id: d.id })))
    },
    onError,
  )
}

export async function createMarketingPost(input: {
  title: string
  body: string
  imageAlt: string | null
}): Promise<string> {
  const now = new Date().toISOString()
  const ref = await addDoc(postsCollection(), {
    title: input.title.trim(),
    body: input.body,
    imageAlt: input.imageAlt,
    hasImage: false,
    status: 'draft' satisfies MarketingPostStatus,
    createdAt: now,
    updatedAt: now,
    postedAt: null,
    postUrn: null,
  })
  return ref.id
}

function assertNotPosted(post: MarketingPost, doing: string) {
  if (post.status === 'posted') {
    throw new Error(`Already posted${post.postedAt ? ` ${post.postedAt.slice(0, 10)}` : ''}; ${doing} is off the table — posted is final.`)
  }
}

/** Content edits are for drafts; an approved post goes back to draft first. */
export async function updateMarketingDraft(
  post: MarketingPost,
  input: { title: string; body: string; imageAlt: string | null },
): Promise<void> {
  assertNotPosted(post, 'editing')
  if (post.status !== 'draft') {
    throw new Error('Only drafts can be edited — take it back to draft first.')
  }
  await updateDoc(doc(firestore(), POSTS, post.id), {
    title: input.title.trim(),
    body: input.body,
    imageAlt: input.imageAlt,
    updatedAt: new Date().toISOString(),
  })
}

/** Move between draft and approved. Posted is terminal — refuse to touch it. */
export async function setMarketingStatus(
  post: MarketingPost,
  to: 'draft' | 'approved',
): Promise<void> {
  assertNotPosted(post, 'a status change')
  await updateDoc(doc(firestore(), POSTS, post.id), {
    status: to,
    updatedAt: new Date().toISOString(),
  })
}

/** Stamp the outcome of a successful publish. One way, no way back. */
export async function markMarketingPosted(id: string, urn: string): Promise<void> {
  const now = new Date().toISOString()
  await updateDoc(doc(firestore(), POSTS, id), {
    status: 'posted' satisfies MarketingPostStatus,
    postedAt: now,
    postUrn: urn,
    updatedAt: now,
  })
}

export async function deleteMarketingPost(post: MarketingPost): Promise<void> {
  assertNotPosted(post, 'deletion')
  await deleteDoc(doc(firestore(), CARDS, post.id)).catch(() => {})
  await deleteDoc(doc(firestore(), POSTS, post.id))
}

// ---------- Card images ----------

export async function getMarketingCard(postId: string): Promise<string | null> {
  const snap = await getDoc(doc(firestore(), CARDS, postId))
  return snap.exists() ? ((snap.data() as { data: string }).data ?? null) : null
}

export async function setMarketingCard(post: MarketingPost, dataUrl: string): Promise<void> {
  assertNotPosted(post, 'changing the card')
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Cards are PNG only — export from tools/shoot-cards.mjs.')
  }
  if (dataUrl.length > MAX_CARD_DATA_URL) {
    throw new Error(
      `This PNG is ${Math.round(dataUrl.length / 1024)} KB as a data URL; the store caps a card at ${Math.round(MAX_CARD_DATA_URL / 1024)} KB. Cards from the templates come in well under it.`,
    )
  }
  await setDoc(doc(firestore(), CARDS, post.id), {
    data: dataUrl,
    updatedAt: new Date().toISOString(),
  })
  await updateDoc(doc(firestore(), POSTS, post.id), {
    hasImage: true,
    updatedAt: new Date().toISOString(),
  })
}

export async function clearMarketingCard(post: MarketingPost): Promise<void> {
  assertNotPosted(post, 'removing the card')
  await deleteDoc(doc(firestore(), CARDS, post.id))
  await updateDoc(doc(firestore(), POSTS, post.id), {
    hasImage: false,
    imageAlt: null,
    updatedAt: new Date().toISOString(),
  })
}
