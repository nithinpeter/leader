import { createServerFn } from '@tanstack/react-start'
import { performReplyCheck, type SentRef } from '@leader/core/inbox-core'

export const checkReplies = createServerFn({ method: 'POST' })
  .validator((input: { sent: SentRef[] }) => {
    if (!Array.isArray(input?.sent)) throw new Error('A list of sent emails is required')
    return input
  })
  .handler(async ({ data }) => performReplyCheck(data.sent))
