import { createServerFn } from '@tanstack/react-start'
import type { HarvestResult } from '@leader/core/harvest-core'
import { harvestDirectory } from '@leader/core/harvest-core'

export interface HarvestInput {
  url: string
}

/**
 * Reads one professional-body directory page and returns the member websites
 * found on it. Runs on the server because the directories' CORS headers would
 * block the browser from fetching them directly.
 */
export const harvestDirectoryFn = createServerFn({ method: 'POST' })
  .validator((input: HarvestInput) => {
    if (!input || typeof input.url !== 'string' || !input.url.trim()) {
      throw new Error('A directory page URL is required')
    }
    return { url: input.url }
  })
  .handler(async ({ data }): Promise<HarvestResult> => harvestDirectory(data.url))
