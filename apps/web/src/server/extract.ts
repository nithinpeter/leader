import { createServerFn } from '@tanstack/react-start'
import type { SiteExtraction } from '@leader/core/types'
import { performExtraction } from '@leader/core/extract-core'

export interface ExtractInput {
  url: string
}

export const extractSite = createServerFn({ method: 'POST' })
  .validator((input: ExtractInput) => {
    if (!input || typeof input.url !== 'string' || !input.url.trim()) {
      throw new Error('A website URL is required')
    }
    return { url: input.url }
  })
  .handler(async ({ data }): Promise<SiteExtraction> => performExtraction(data.url))
