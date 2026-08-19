import { createServerFn } from '@tanstack/react-start'
import type { SiteExtraction } from '../lib/types'
import { performGeneration } from './generate-core'

export const generateProposition = createServerFn({ method: 'POST' })
  .validator((input: { extraction: SiteExtraction }) => {
    if (!input?.extraction?.url) throw new Error('An extraction is required')
    return input
  })
  .handler(async ({ data }) => performGeneration(data.extraction))
