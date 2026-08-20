import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { firestore } from './firebase'
import type {
  ImportState,
  Lead,
  LeadStatus,
  Proposition,
  SiteExtraction,
} from './types'

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

export async function createLead(input: {
  url: string
  domain: string
  companyName: string
  createdBy: string
  extraction?: SiteExtraction
  proposition?: Proposition
}): Promise<string> {
  const now = new Date().toISOString()
  const lead: Omit<Lead, 'id'> = {
    url: input.url,
    domain: input.domain,
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

/**
 * Creates one bare lead per URL, marked `importState: 'queued'`, and returns
 * the new ids. The docs exist before any extraction runs so the pipeline shows
 * the whole batch immediately and each worker has somewhere to write progress.
 */
export async function createQueuedLeads(
  entries: Array<{ url: string; domain: string }>,
  createdBy: string,
): Promise<string[]> {
  const now = new Date().toISOString()
  const ids: string[] = []
  for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
    const batch = writeBatch(firestore())
    for (const entry of entries.slice(i, i + BATCH_LIMIT)) {
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
      ids.push(ref.id)
    }
    await batch.commit()
  }
  return ids
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

export async function setLeadStatus(id: string, status: LeadStatus): Promise<void> {
  await updateLead(id, { status })
}

export async function deleteLead(id: string): Promise<void> {
  await deleteDoc(doc(firestore(), COLLECTION, id))
}
