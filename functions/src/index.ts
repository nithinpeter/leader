import { http } from '@google-cloud/functions-framework'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { runCycle, type LeadStore } from '../../src/automation/cycle'
import { notifyOfRun, notifyOfSend } from '../../src/automation/notify'
import { performSend, type SendInput } from '../../src/server/email-core'
import type { Lead } from '../../src/lib/types'

initializeApp()
const db = getFirestore()

/**
 * Firestore as the service account. The app reaches the same collection as the
 * signed-in user, so both write the same shapes.
 */
const store: LeadStore = {
  async list() {
    const snap = await db.collection('leads').get()
    return snap.docs
      .map((d) => ({ ...(d.data() as Omit<Lead, 'id'>), id: d.id }))
      // Closed leads and anyone who asked us to stop are not the cron's business.
      .filter((l) => !l.doNotContact && l.status !== 'won' && l.status !== 'lost')
  },
  async update(id, patch) {
    await db
      .collection('leads')
      .doc(id)
      .set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true })
  },
}

/** Nothing goes to a prospect unless this is switched on deliberately. */
function sendingEnabled(): boolean {
  return process.env.AUTOMATION_ENABLED === 'true'
}

/**
 * Runs one pass of the outreach cycle. Triggered by Cloud Scheduler every 30
 * minutes over HTTP with an OIDC token; the shared secret is a second lock in
 * case the URL ever leaks.
 */
http('runOutreach', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (secret && req.get('x-cron-secret') !== secret) {
    res.status(403).send('Forbidden')
    return
  }

  const dryRun = !sendingEnabled()
  const send = async (input: SendInput) => {
    if (dryRun) {
      console.log(
        `DRY RUN, not sending to ${input.to}: ${input.subject}\n${input.body}`,
      )
      return { messageId: `<dry-run-${Date.now()}@westringia.com>`, from: 'dry-run' }
    }
    return performSend(input)
  }

  try {
    const report = await runCycle({
      store,
      senderName: process.env.SENDER_NAME || 'The team',
      send,
      // Every automated email tells a person what just went out in their name.
      notify: dryRun ? async () => {} : notifyOfSend,
    })
    if (!dryRun) await notifyOfRun(report)

    console.log(JSON.stringify({ dryRun, ...report }))
    res.status(200).json({ dryRun, ...report })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Outreach cycle failed:', message)
    res.status(500).json({ error: message })
  }
})
