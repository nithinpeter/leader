import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { updateLead } from '../lib/leads'
import type { Lead, OutreachEmail } from '../lib/types'
import { draftEmail, emailConfigured, sendLeadEmail } from '../server/email'
import { SendIcon, SparklesIcon } from './icons'
import { Alert, Button, Input, Spinner, Textarea } from './ui'

/**
 * The generated draft stops at "Thanks," so the sender can add their own name.
 * Anything actually sent from here also needs the sender identified and a way
 * to opt out, which the Spam Act asks of a commercial electronic message.
 */
function signOff(body: string, senderName?: string | null): string {
  return [
    body,
    senderName || 'The team',
    'Westringia Labs, Sydney',
    '02 8531 8610 · westringia.com',
    '',
    "If you'd rather not hear from us, just reply and say so. That's the last you'll get.",
  ].join('\n')
}

export function OutreachPanel({ lead }: { lead: Lead }) {
  const { user } = useAuth()
  const [fromAddress, setFromAddress] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [to, setTo] = useState(lead.extraction?.emails[0] ?? '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [justSent, setJustSent] = useState(false)

  useEffect(() => {
    emailConfigured()
      .then((r) => {
        setConfigured(r.configured)
        setFromAddress(r.from)
      })
      .catch(() => setConfigured(false))
  }, [])

  // Start from the draft written with the proposition rather than an empty box.
  // Draft with AI below re-rolls just the email if this one is not right.
  useEffect(() => {
    const draft = lead.proposition?.email
    if (!draft || subject || body) return
    setSubject(draft.subject)
    setBody(signOff(draft.body, user?.displayName))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.proposition?.email, user?.displayName])

  async function draft() {
    if (!lead.extraction || !lead.proposition) return
    setBusy('draft')
    setError(null)
    try {
      const d = await draftEmail({
        data: {
          extraction: lead.extraction,
          proposition: lead.proposition,
          senderName: user?.displayName ?? '',
        },
      })
      setSubject(d.subject)
      setBody(d.body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Drafting failed')
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    if (!user) return
    if (!window.confirm(`Send this email to ${to}?`)) return
    setBusy('send')
    setError(null)
    try {
      const result = await sendLeadEmail({ data: { to, subject, body } })
      const record: OutreachEmail = {
        to,
        subject,
        body,
        sentAt: new Date().toISOString(),
        sentBy: user.email ?? user.uid,
        messageId: result.messageId,
      }
      const advanceStatus = ['new', 'researched', 'doc_ready'].includes(lead.status)
      await updateLead(lead.id, {
        emails: [...(lead.emails ?? []), record],
        ...(advanceStatus ? { status: 'contacted' as const } : {}),
      })
      setSubject('')
      setBody('')
      setJustSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sending failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      {lead.emails?.length ? (
        <ul className="mb-6 space-y-3">
          {lead.emails.map((m) => (
            <li key={m.messageId} className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground">
                To {m.to} ·{' '}
                {new Date(m.sentAt).toLocaleString('en-AU', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}{' '}
                · by {m.sentBy}
              </p>
              <p className="mt-1 text-sm font-semibold">{m.subject}</p>
              <details className="mt-1 text-sm text-muted-foreground">
                <summary className="cursor-pointer text-xs text-foreground/70 hover:text-foreground">
                  Show body
                </summary>
                <p className="mt-2 whitespace-pre-wrap">{m.body}</p>
              </details>
            </li>
          ))}
        </ul>
      ) : null}

      {justSent ? (
        <div className="mb-4">
          <Alert tone="success">
            Sent. A copy went to the {fromAddress ?? 'sending'} inbox, and the
            lead is marked contacted.
          </Alert>
        </div>
      ) : null}

      {configured === false ? (
        <Alert>
          Sending is not set up. Put the Spacemail address and password in{' '}
          <code>.env</code> as <code>SMTP_USER</code> / <code>SMTP_PASS</code> and
          restart. Drafting still works below.
        </Alert>
      ) : null}

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <Input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="who@theirbusiness.com.au"
            className="min-w-64 flex-1"
          />
          <Button
            variant="outline"
            onClick={() => void draft()}
            disabled={busy !== null || !lead.proposition}
            title={lead.proposition ? undefined : 'Generate a proposition first'}
          >
            {busy === 'draft' ? <Spinner className="size-3.5" /> : <SparklesIcon size={14} />}
            {busy === 'draft' ? 'Drafting…' : 'Draft with AI'}
          </Button>
        </div>
        <Input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder="The email. Draft it with AI, then make it yours before sending."
          className="leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-4">
          <Button
            onClick={() => void send()}
            disabled={
              busy !== null || !configured || !to.trim() || !subject.trim() || !body.trim()
            }
          >
            {busy === 'send' ? <Spinner className="size-3.5" /> : <SendIcon size={14} />}
            {busy === 'send'
              ? 'Sending…'
              : `Send from ${fromAddress ?? 'hello@westringia.com'}`}
          </Button>
          <p className="text-xs text-muted-foreground">
            Nothing sends without this click. Read it first.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <Alert tone="destructive">{error}</Alert>
        </div>
      ) : null}
    </div>
  )
}
