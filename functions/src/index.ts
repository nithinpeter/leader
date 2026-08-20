import { http } from '@google-cloud/functions-framework'
import { CloudTasksClient } from '@google-cloud/tasks'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { runCycle, type LeadStore } from '../../packages/core/src/automation/cycle'
import { notifyOfRun, notifyOfSend } from '../../packages/core/src/automation/notify'
import { performSend, type SendInput } from '../../packages/core/src/email-core'
import { performExtraction } from '../../packages/core/src/extract-core'
import { performGeneration } from '../../packages/core/src/generate-core'
import type { Lead } from '../../packages/core/src/types'

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

/** Shared-secret check used by every HTTP entry point here. */
function authorized(req: { get(name: string): string | undefined }): boolean {
  const secret = process.env.CRON_SECRET
  return !secret || req.get('x-cron-secret') === secret
}

const IMPORT_BATCH_CAP = 1000

/**
 * Fans a bulk import out to one Cloud Task per lead. The lead docs already
 * exist (the app creates them marked `importState: 'queued'` before calling
 * this); all this does is schedule an `importLead` invocation for each, so
 * every company gets its own function run - its own timeout, its own retries,
 * and the queue's dispatch rate as the only thing pacing the crawlers.
 */
http('bulkImport', async (req, res) => {
  if (!authorized(req)) {
    res.status(403).send('Forbidden')
    return
  }

  const leadIds: unknown = (req.body as { leadIds?: unknown })?.leadIds
  if (
    !Array.isArray(leadIds) ||
    leadIds.length === 0 ||
    !leadIds.every((id): id is string => typeof id === 'string' && /^[\w-]+$/.test(id))
  ) {
    res.status(400).json({ error: 'Body must be { leadIds: string[] }' })
    return
  }
  if (leadIds.length > IMPORT_BATCH_CAP) {
    res.status(400).json({ error: `At most ${IMPORT_BATCH_CAP} leads per call` })
    return
  }

  const workerUrl = process.env.IMPORT_LEAD_URL
  if (!workerUrl) {
    res.status(500).json({ error: 'IMPORT_LEAD_URL is not configured' })
    return
  }

  const tasks = new CloudTasksClient()
  const queue = tasks.queuePath(
    await tasks.getProjectId(),
    process.env.TASKS_LOCATION || 'australia-southeast1',
    process.env.IMPORT_QUEUE || 'leader-import',
  )
  const serviceAccountEmail = process.env.TASKS_SA_EMAIL

  let enqueued = 0
  const failures: string[] = []
  for (const leadId of leadIds) {
    try {
      await tasks.createTask({
        parent: queue,
        task: {
          // 30 minutes is Cloud Tasks' ceiling for an HTTP dispatch, and one
          // crawl + one generation fits many times over.
          dispatchDeadline: { seconds: 1800 },
          httpRequest: {
            url: workerUrl,
            httpMethod: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(process.env.CRON_SECRET
                ? { 'x-cron-secret': process.env.CRON_SECRET }
                : {}),
            },
            body: Buffer.from(JSON.stringify({ leadId })).toString('base64'),
            ...(serviceAccountEmail
              ? { oidcToken: { serviceAccountEmail, audience: workerUrl } }
              : {}),
          },
        },
      })
      enqueued++
    } catch (e) {
      console.error(`Could not enqueue lead ${leadId}:`, e)
      failures.push(leadId)
      // Leave the doc marked failed so the batch never shows "queued" forever
      // for a lead no worker will ever pick up.
      await db.collection('leads').doc(leadId).set(
        {
          importState: 'failed',
          importError: 'Could not be queued for import. Retry it from the lead page.',
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
    }
  }

  console.log(JSON.stringify({ bulkImport: { enqueued, failed: failures.length } }))
  res.status(200).json({ enqueued, failed: failures })
})

/**
 * Imports one lead: crawls the site, writes the proposition, updates the doc.
 * One invocation per company, dispatched by Cloud Tasks from `bulkImport`.
 *
 * Failure answers 500 on purpose - that is what makes the queue retry with
 * backoff, which is exactly right for a site that timed out or a model that
 * was rate-limited. The doc is marked `failed` before answering, so if the
 * retries run out the lead still says what happened; a retry that succeeds
 * clears the mark. The extraction is saved as soon as it exists, so a retry
 * after a generation failure skips the crawl.
 */
http('importLead', async (req, res) => {
  if (!authorized(req)) {
    res.status(403).send('Forbidden')
    return
  }

  const leadId: unknown = (req.body as { leadId?: unknown })?.leadId
  if (typeof leadId !== 'string' || !/^[\w-]+$/.test(leadId)) {
    res.status(400).json({ error: 'Body must be { leadId: string }' })
    return
  }

  const ref = db.collection('leads').doc(leadId)
  const snap = await ref.get()
  if (!snap.exists) {
    // Deleted between queueing and now. Nothing to do, and no point retrying.
    res.status(200).json({ skipped: 'gone' })
    return
  }
  const lead = snap.data() as Omit<Lead, 'id'>
  if (!lead.importState) {
    // Already finished - a duplicate delivery or a stale retry.
    res.status(200).json({ skipped: 'done' })
    return
  }

  const now = () => new Date().toISOString()
  const fail = async (stage: string, e: unknown) => {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`Import of lead ${leadId} failed while ${stage}:`, message)
    await ref.set(
      { importState: 'failed', importError: message, updatedAt: now() },
      { merge: true },
    )
    res.status(500).json({ error: message })
  }

  await ref.set({ importState: 'running', updatedAt: now() }, { merge: true })

  let extraction = lead.extraction
  if (!extraction) {
    try {
      extraction = await performExtraction(lead.url)
    } catch (e) {
      await fail('reading the site', e)
      return
    }
    await ref.set(
      {
        extraction,
        domain: extraction.domain,
        companyName: extraction.companyName,
        status: 'researched',
        updatedAt: now(),
      },
      { merge: true },
    )
  }

  let proposition
  try {
    proposition = await performGeneration(extraction)
  } catch (e) {
    await fail('writing the proposition', e)
    return
  }

  await ref.set(
    {
      proposition,
      status: 'doc_ready',
      importState: FieldValue.delete(),
      importError: FieldValue.delete(),
      updatedAt: now(),
    },
    { merge: true },
  )
  console.log(`Imported ${extraction.domain} (lead ${leadId})`)
  res.status(200).json({ ok: true, domain: extraction.domain })
})

/**
 * How many first-contact emails one run may send. Unset falls back to the
 * cycle's own default; 0 turns first contact off and leaves the cron on
 * replies and follow-ups only.
 */
function coldPerRun(): number | undefined {
  const n = Number(process.env.COLD_EMAILS_PER_RUN)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * Runs one pass of the outreach cycle. Triggered by Cloud Scheduler every 30
 * minutes over HTTP with an OIDC token; the shared secret is a second lock in
 * case the URL ever leaks.
 */
http('runOutreach', async (req, res) => {
  if (!authorized(req)) {
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
      send,
      // Every automated email tells a person what just went out in their name.
      notify: dryRun ? async () => {} : notifyOfSend,
      maxColdPerRun: coldPerRun(),
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
