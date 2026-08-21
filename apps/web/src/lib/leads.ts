import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { firestore } from './firebase'
import {
  normalizeDomain,
  type ImportState,
  type Lead,
  type LeadStatus,
  type Proposition,
  type SiteExtraction,
} from '@leader/core/types'

const COLLECTION = 'leads'

function leadsCollection() {
  return collection(firestore(), COLLECTION)
}

export function subscribeToLeads(
  onLeads: (leads: Lead[]) => void,
  onError: (err: Error) => void,
) {
  const q = query(leadsCollection(), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      onLeads(snap.docs.map((d) => ({ ...(d.data() as Omit<Lead, 'id'>), id: d.id })))
    },
    onError,
  )
}

export function subscribeToLead(
  id: string,
  onLead: (lead: Lead | null) => void,
  onError: (err: Error) => void,
) {
  return onSnapshot(
    doc(firestore(), COLLECTION, id),
    (snap) => {
      onLead(snap.exists() ? ({ ...(snap.data() as Omit<Lead, 'id'>), id: snap.id }) : null)
    },
    onError,
  )
}

/**
 * Thrown instead of creating a second lead for a business already in the
 * pipeline. Carries the existing lead so the caller can send whoever asked
 * straight to it rather than making them go and find it.
 */
export class DuplicateLeadError extends Error {
  constructor(
    readonly domain: string,
    readonly existingId: string,
  ) {
    super(`${domain} is already a lead.`)
    this.name = 'DuplicateLeadError'
  }
}

/**
 * The lead already holding this domain, if there is one. Asks Firestore rather
 * than trusting a snapshot the caller is holding, because the whole point is
 * to catch the lead a second tab or an earlier session added.
 */
export async function findLeadIdByDomain(domain: string): Promise<string | null> {
  const key = normalizeDomain(domain)
  if (!key) return null
  const snap = await getDocs(
    query(leadsCollection(), where('domain', '==', key), limit(1)),
  )
  return snap.empty ? null : snap.docs[0].id
}

/** Firestore caps an `in` filter at 30 values. */
const IN_LIMIT = 30

/**
 * Which of these domains are already leads, as a domain -> lead id map. Asked
 * in chunks of 30 so a big paste costs a handful of queries rather than one
 * per row.
 */
async function existingLeadsByDomain(
  domains: string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(domains.map(normalizeDomain).filter(Boolean))]
  const found = new Map<string, string>()
  for (let i = 0; i < wanted.length; i += IN_LIMIT) {
    const snap = await getDocs(
      query(leadsCollection(), where('domain', 'in', wanted.slice(i, i + IN_LIMIT))),
    )
    for (const d of snap.docs) {
      const domain = (d.data() as Omit<Lead, 'id'>).domain
      if (!found.has(domain)) found.set(domain, d.id)
    }
  }
  return found
}

export async function createLead(input: {
  url: string
  domain: string
  companyName: string
  createdBy: string
  extraction?: SiteExtraction
  proposition?: Proposition
}): Promise<string> {
  // Last gate before a business enters the pipeline. The caller usually checks
  // too, before paying for a crawl - this one is what makes it true, because
  // it runs after the crawl, on the domain the site actually redirected to.
  const domain = normalizeDomain(input.domain)
  const existing = await findLeadIdByDomain(domain)
  if (existing) throw new DuplicateLeadError(domain, existing)

  const now = new Date().toISOString()
  const lead: Omit<Lead, 'id'> = {
    url: input.url,
    domain,
    companyName: input.companyName,
    status: input.proposition ? 'doc_ready' : input.extraction ? 'researched' : 'new',
    notes: '',
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    ...(input.extraction ? { extraction: input.extraction } : {}),
    ...(input.proposition ? { proposition: input.proposition } : {}),
  }
  const ref = await addDoc(leadsCollection(), lead)
  return ref.id
}

/** Firestore caps a batch at 500 writes; stay comfortably under it. */
const BATCH_LIMIT = 400

/** What a bulk create actually did, split by whether the business was new. */
export interface QueuedLeads {
  created: Array<{ id: string; url: string; domain: string }>
  /** Already in the pipeline, so no lead was made and nobody gets a second email. */
  skipped: Array<{ domain: string; existingId: string }>
}

/**
 * Creates one bare lead per URL, marked `importState: 'queued'`. The docs exist
 * before any extraction runs so the pipeline shows the whole batch immediately
 * and each worker has somewhere to write progress.
 *
 * Domains already held by a lead are skipped here rather than only in the
 * screen that calls this, so a stale snapshot in one tab cannot let the same
 * business in twice.
 */
export async function createQueuedLeads(
  entries: Array<{ url: string; domain: string }>,
  createdBy: string,
): Promise<QueuedLeads> {
  const known = await existingLeadsByDomain(entries.map((e) => e.domain))
  const skipped: QueuedLeads['skipped'] = []
  const wanted: Array<{ url: string; domain: string }> = []
  for (const entry of entries) {
    const domain = normalizeDomain(entry.domain)
    const existingId = known.get(domain)
    if (existingId) skipped.push({ domain, existingId })
    else wanted.push({ url: entry.url, domain })
  }

  const now = new Date().toISOString()
  const created: QueuedLeads['created'] = []
  for (let i = 0; i < wanted.length; i += BATCH_LIMIT) {
    const batch = writeBatch(firestore())
    for (const entry of wanted.slice(i, i + BATCH_LIMIT)) {
      const ref = doc(leadsCollection())
      // Placeholder name from the domain; the extraction overwrites it.
      const companyName = entry.domain
        .split('.')[0]
        .replace(/^\w/, (c) => c.toUpperCase())
      const lead: Omit<Lead, 'id'> = {
        url: entry.url,
        domain: entry.domain,
        companyName,
        status: 'new',
        notes: '',
        createdBy,
        createdAt: now,
        updatedAt: now,
        importState: 'queued',
      }
      batch.set(ref, lead)
      created.push({ id: ref.id, url: entry.url, domain: entry.domain })
    }
    await batch.commit()
  }
  return { created, skipped }
}

export async function updateLead(
  id: string,
  patch: Partial<
    Pick<
      Lead,
      | 'status'
      | 'notes'
      | 'companyName'
      | 'contactEmail'
      | 'extraction'
      | 'proposition'
      | 'emails'
      | 'replies'
    >
  >,
): Promise<void> {
  await updateDoc(doc(firestore(), COLLECTION, id), {
    ...patch,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Marks a batch of still-queued leads as failed, used when the dispatch to the
 * import functions itself broke - otherwise they would sit "Queued" forever
 * with no worker ever coming for them.
 */
export async function failQueuedLeads(ids: string[], reason: string): Promise<void> {
  const now = new Date().toISOString()
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(firestore())
    for (const id of ids.slice(i, i + BATCH_LIMIT)) {
      batch.update(doc(firestore(), COLLECTION, id), {
        importState: 'failed',
        importError: reason,
        updatedAt: now,
      })
    }
    await batch.commit()
  }
}

/**
 * One step of an import written back to the lead. `null` for importState or
 * importError removes the field, which is how a finished import ends up
 * indistinguishable from a hand-added lead. Used by the in-browser fallback;
 * the Cloud Function path writes the same shapes with the admin SDK.
 */
export async function applyImportResult(
  id: string,
  patch: {
    extraction?: SiteExtraction
    proposition?: Proposition
    companyName?: string
    domain?: string
    status?: LeadStatus
    importState?: ImportState | null
    importError?: string | null
  },
): Promise<void> {
  const { importState, importError, ...rest } = patch
  await updateDoc(doc(firestore(), COLLECTION, id), {
    ...rest,
    ...(importState !== undefined
      ? { importState: importState ?? deleteField() }
      : {}),
    ...(importError !== undefined
      ? { importError: importError ?? deleteField() }
      : {}),
    updatedAt: new Date().toISOString(),
  })
}

export async function deleteLead(id: string): Promise<void> {
  await deleteDoc(doc(firestore(), COLLECTION, id))
}
