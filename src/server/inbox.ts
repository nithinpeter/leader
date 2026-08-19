import { createServerFn } from '@tanstack/react-start'
import { imapConfigured, performReplyCheck, type SentRef } from './inbox-core'

export const inboxConfigured = createServerFn({ method: 'GET' }).handler(async () => ({
  configured: imapConfigured(),
  mailbox: process.env.SMTP_USER ?? null,
}))

export const checkReplies = createServerFn({ method: 'POST' })
  .validator((input: { sent: SentRef[] }) => {
    if (!Array.isArray(input?.sent)) throw new Error('A list of sent emails is required')
    return input
  })
  .handler(async ({ data }) => performReplyCheck(data.sent))
