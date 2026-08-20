import { createServerFn } from '@tanstack/react-start'

export interface BulkImportDispatch {
  enqueued: number
  /** Lead ids the function could not queue; their docs are marked failed. */
  failed: string[]
}

/** The client looks for this marker to fall back to importing in the browser. */
export const IMPORT_NOT_CONFIGURED = 'BULK_IMPORT_URL is not set'

/**
 * Hands a batch of queued lead ids to the `bulkImport` Cloud Function, which
 * fans them out to one `importLead` invocation per company. Runs here rather
 * than in the browser because the shared secret must never reach the client.
 */
export const startBulkImport = createServerFn({ method: 'POST' })
  .validator((input: { leadIds: string[] }) => {
    if (
      !Array.isArray(input?.leadIds) ||
      input.leadIds.length === 0 ||
      !input.leadIds.every((id) => typeof id === 'string' && /^[\w-]+$/.test(id))
    ) {
      throw new Error('A list of lead ids is required')
    }
    return { leadIds: input.leadIds }
  })
  .handler(async ({ data }): Promise<BulkImportDispatch> => {
    const url = process.env.BULK_IMPORT_URL
    if (!url) {
      throw new Error(
        `${IMPORT_NOT_CONFIGURED} - the import will run in the browser instead. Deploy the bulk import functions to run it serverside (see README).`,
      )
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.CRON_SECRET
          ? { 'x-cron-secret': process.env.CRON_SECRET }
          : {}),
      },
      body: JSON.stringify({ leadIds: data.leadIds }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(
        `The bulk import function answered ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
      )
    }
    return (await res.json()) as BulkImportDispatch
  })
