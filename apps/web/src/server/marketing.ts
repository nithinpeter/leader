import { createServerFn } from '@tanstack/react-start'
import { linkedinConfig, postToLinkedIn } from '@leader/core/marketing-core'

/**
 * The one marketing step that has to run on the server: the LinkedIn call,
 * which holds the organisation token. Everything else — the queue, statuses,
 * card images — lives in Firestore and the client owns it directly
 * (src/lib/marketing.ts), the same way it owns leads.
 */

export const marketingConfigured = createServerFn({ method: 'GET' }).handler(
  async () => {
    const cfg = linkedinConfig()
    return { configured: Boolean(cfg.token && cfg.orgId) }
  },
)

export const publishToLinkedIn = createServerFn({ method: 'POST' })
  .validator(
    (input: { body: string; imageBase64?: string | null; imageAlt?: string | null }) => {
      if (!input?.body?.trim()) throw new Error('Post body is required')
      return input
    },
  )
  .handler(async ({ data }) => {
    const image = data.imageBase64 ? Buffer.from(data.imageBase64, 'base64') : null
    const result = await postToLinkedIn(
      { body: data.body, image, imageAlt: data.imageAlt ?? null },
      linkedinConfig(),
    )
    return { ok: true as const, ...result }
  })
