import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore'
import { firestore } from './firebase'
import type { Lead, LeadStatus, Proposition, SiteExtraction } from './types'

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

export async function updateLead(
  id: string,
  patch: Partial<Pick<Lead, 'status' | 'notes' | 'companyName' | 'extraction' | 'proposition'>>,
): Promise<void> {
  await updateDoc(doc(firestore(), COLLECTION, id), {
    ...patch,
    updatedAt: new Date().toISOString(),
  })
}

export async function setLeadStatus(id: string, status: LeadStatus): Promise<void> {
  await updateLead(id, { status })
}

export async function deleteLead(id: string): Promise<void> {
  await deleteDoc(doc(firestore(), COLLECTION, id))
}
