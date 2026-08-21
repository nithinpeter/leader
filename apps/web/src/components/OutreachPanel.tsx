import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { updateLead } from '../lib/leads'
import { INBOUND_LABELS, leadEmail, type Lead, type OutreachEmail } from '@leader/core/types'
import { draftEmail, emailConfigured, sendLeadEmail } from '../server/email'
import { SendIcon, SparklesIcon } from './icons'
import { Alert, Button, Input, Spinner, Textarea } from './ui'

export function OutreachPanel({ lead }: { lead: Lead }) {
  const { user } = useAuth()
  const [fromAddress, setFromAddress] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [to, setTo] = useState(leadEmail(lead) ?? '')
  const [toDirty, setToDirty] = useState(false)
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

  // Follow the lead's address when it is corrected up in the header, unless
  // the person has already typed their own into this box.
  useEffect(() => {
    if (!toDirty) setTo(leadEmail(lead) ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.contactEmail, lead.extraction?.emails[0]])

  // Start from the draft written with the proposition rather than an empty box.
  // Draft with AI below re-rolls just the email if this one is not right. The
  // draft ends at "Thanks," with no name: the branded footer, which identifies
  // us and carries the opt-out the Spam Act requires, goes on at send time.
  useEffect(() => {
    const draft = lead.proposition?.email
    if (!draft || subject || body || lead.doNotContact) return
    setSubject(draft.subject)
    setBody(draft.body)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.proposition?.email])

  async function draft() {
    if (!lead.extraction || !lead.proposition) return
    setBusy('draft')
    setError(null)
    try {
      const d = await draftEmail({
        data: {
          extraction: lead.extraction,
          proposition: lead.proposition,
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
        // The first touch. The cron counts follow-ups from here.
        kind: 'cold',
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

  // A disabled send button with no explanation is a puzzle. Say which of the
  // four preconditions is missing.
  const blockedReason = lead.doNotContact
    ? lead.doNotContactReason || 'This lead is marked do not contact.'
    : configured === null
      ? 'Checking whether sending is set up…'
      : !configured
        ? 'Sending is not set up. See the note above.'
        : !to.trim()
          ? 'No recipient address yet. The site did not list one, so type it in.'
          : !subject.trim() || !body.trim()
            ? 'No draft yet. Generate a proposition, or use Draft with AI.'
            : null

  return (
    <div>
      {lead.replies?.length ? (
        <ul className="mb-6 space-y-3">
          {lead.replies.map((r) => (
            <li
              key={r.messageId}
              className={`rounded-lg border border-l-2 border-border p-4 ${
                r.kind === 'reply'
                  ? 'border-l-emerald-500'
                  : r.kind === 'auto_reply'
                    ? 'border-l-border'
                    : 'border-l-destructive'
              }`}
            >
              <p className="text-xs text-muted-foreground">
                <span
                  className={`font-semibold ${
                    r.kind === 'reply'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : r.kind === 'auto_reply'
                        ? 'text-muted-foreground'
                        : 'text-destructive'
                  }`}
                >
                  {INBOUND_LABELS[r.kind]}
                </span>{' '}
                · from {r.fromName ? `${r.fromName}, ` : ''}
                {r.from} ·{' '}
                {new Date(r.receivedAt).toLocaleString('en-AU', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {r.matchedLoosely ? ' · matched on address, not on the thread' : ''}
              </p>
              <p className="mt-1 text-sm font-semibold">{r.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                {r.snippet}
              </p>
              {r.kind === 'opt_out' ? (
                <p className="mt-2 text-xs text-destructive">
                  Stop emailing this lead. The Spam Act gives you five working
                  days to action the request.
                </p>
              ) : null}
              {r.kind === 'bounce' ? (
                <p className="mt-2 text-xs text-destructive">
                  Nobody read it. Find a better address before trying again.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

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

      {/* The cron checks an address before it sends and will not use one that
          fails. Saying so here is the only way that decision is visible: the
          lead would otherwise just sit at doc_ready looking untouched. Sending
          by hand is still allowed, because a person can see what the check
          could not. */}
      {lead.emailCheck?.result === 'undeliverable' &&
      lead.emailCheck.address === to.trim().toLowerCase() ? (
        <div className="mb-4">
          <Alert tone="destructive">
            The automation will not email <code>{lead.emailCheck.address}</code>:{' '}
            {lead.emailCheck.reason}. Put a better address in the box below and
            it gets checked again on the next run.
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
            onChange={(e) => {
              setTo(e.target.value)
              setToDirty(true)
            }}
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
        <p className="text-xs text-muted-foreground">
          Ends at "Thanks," with no name. The branded footer, with the logo,
          contact details, the OpenAI Select Partner badge and the opt-out
          line, goes on automatically when it sends.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            onClick={() => void send()}
            disabled={busy !== null || blockedReason !== null}
          >
            {busy === 'send' ? <Spinner className="size-3.5" /> : <SendIcon size={14} />}
            {busy === 'send'
              ? 'Sending…'
              : `Send from ${fromAddress || 'hello@westringia.com'}`}
          </Button>
          <p className="text-xs text-muted-foreground">
            {blockedReason ?? 'Nothing sends without this click. Read it first.'}
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
