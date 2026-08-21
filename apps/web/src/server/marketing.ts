import { createServerFn } from '@tanstack/react-start'
import type { QueuePost } from '@leader/core/marketing-core'
import {
  linkedinConfig,
  listQueuePosts,
  publishQueueFile,
  readImage,
  setStatusText,
  storeMode,
  readQueueFile,
  writeQueueFile,
} from '@leader/core/marketing-core'

export interface MarketingQueue {
  store: 'github' | 'local'
  configured: { token: boolean; orgId: boolean }
  posts: QueuePost[]
}

export const marketingQueue = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MarketingQueue> => {
    const cfg = linkedinConfig()
    return {
      store: storeMode(),
      configured: { token: Boolean(cfg.token), orgId: Boolean(cfg.orgId) },
      posts: await listQueuePosts(),
    }
  },
)

/**
 * The card PNGs come back as data URLs. They are deliberately not served as
 * public files anywhere — unposted drafts should not be quietly downloadable —
 * and a data URL keeps them inside the app the same way the old authenticated
 * image endpoint did.
 */
export const marketingImage = createServerFn({ method: 'GET' })
  .validator((input: { name: string }) => {
    if (!input?.name) throw new Error('Image name is required')
    return input
  })
  .handler(async ({ data }): Promise<{ dataUrl: string }> => {
    const png = await readImage(data.name)
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}` }
  })

export const setMarketingStatus = createServerFn({ method: 'POST' })
  .validator((input: { file: string; to: 'draft' | 'approved' }) => {
    if (!input?.file || !input?.to) throw new Error('File and target status are required')
    return input
  })
  .handler(async ({ data }) => {
    const { name, text, sha } = await readQueueFile(data.file)
    await writeQueueFile(name, setStatusText(text, data.to, name), sha, `Mark ${name} as ${data.to} via Leader`)
    return { ok: true as const }
  })

export const publishMarketingPost = createServerFn({ method: 'POST' })
  .validator((input: { file: string }) => {
    if (!input?.file) throw new Error('File is required')
    return input
  })
  .handler(async ({ data }) => {
    const result = await publishQueueFile(data.file)
    return { ok: true as const, ...result }
  })
