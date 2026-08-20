import { createServerFn } from '@tanstack/react-start'
import type { SiteExtraction } from '@leader/core/types'
import { performGeneration } from '@leader/core/generate-core'

export const generateProposition = createServerFn({ method: 'POST' })
  .validator((input: { extraction: SiteExtraction }) => {
    if (!input?.extraction?.url) throw new Error('An extraction is required')
    return input
  })
  .handler(async ({ data }) => performGeneration(data.extraction))
