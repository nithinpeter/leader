import { deleteField, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { firestore } from './firebase'
import type { WarmupState } from '@leader/core/automation/warmup'

/**
 * The sending allowance, which the cron writes and this screen reads. One
 * document rather than a collection: there is one mailbox, one day, and one
 * number. The cron is the only writer of the count; the app only ever touches
 * `overrideDailyCap`, so the two cannot fight over the same field.
 */
const PATH = ['settings', 'outreach'] as const

function warmupDoc() {
  return doc(firestore(), ...PATH)
}

export function subscribeToWarmup(
  onState: (state: WarmupState | null) => void,
  onError: (err: Error) => void,
) {
  return onSnapshot(
    warmupDoc(),
    (snap) => onState(snap.exists() ? (snap.data() as WarmupState) : null),
    onError,
  )
}

/**
 * Pins the daily allowance, or clears the pin so the warm-up ramp decides
 * again. `merge` matters: the count and the start date belong to the cron and
 * must survive a person changing the limit mid-day.
 */
export async function setDailyCapOverride(cap: number | null): Promise<void> {
  await setDoc(
    warmupDoc(),
    { overrideDailyCap: cap === null ? deleteField() : Math.max(0, Math.round(cap)) },
    { merge: true },
  )
}
