import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { updateLead } from '../lib/leads'
import { INBOUND_LABELS, type Lead, type OutreachEmail } from '../lib/types'
import { draftEmail, emailConfigured, sendLeadEmail } from '../server/email'

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
    if (!draft || subject || body || lead.doNotContact) return
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
              className={`border-l-2 bg-paper-card p-4 ${
                r.kind === 'reply'
                  ? 'border-sage'
                  : r.kind === 'auto_reply'
                    ? 'border-rule-strong'
                    : 'border-clay'
              }`}
            >
              <p className="text-xs text-rule-control">
                <span
                  className={`font-semibold ${
                    r.kind === 'reply'
                      ? 'text-sage-deep'
                      : r.kind === 'auto_reply'
                        ? 'text-rule-control'
                        : 'text-clay'
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
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
                {r.snippet}
              </p>
              {r.kind === 'opt_out' ? (
                <p className="mt-2 text-xs text-clay">
                  Stop emailing this lead. The Spam Act gives you five working
                  days to action the request.
                </p>
              ) : null}
              {r.kind === 'bounce' ? (
                <p className="mt-2 text-xs text-clay">
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
            <li key={m.messageId} className="border border-rule bg-paper-card p-4">
              <p className="text-xs text-rule-control">
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
              <details className="mt-1 text-sm text-ink-soft">
                <summary className="cursor-pointer text-xs text-sage-deep">
                  Show body
                </summary>
                <p className="mt-2 whitespace-pre-wrap">{m.body}</p>
              </details>
            </li>
          ))}
        </ul>
      ) : null}

      {justSent ? (
        <p className="mb-4 border-l-2 border-sage pl-4 text-sm text-sage-deep">
          Sent. A copy went to the {fromAddress ?? 'sending'} inbox, and the lead
          is marked contacted.
        </p>
      ) : null}

      {configured === false ? (
        <p className="border-l-2 border-clay pl-4 text-sm text-ink-soft">
          Sending is not set up. Put the Spacemail address and password in{' '}
          <code>.env</code> as <code>SMTP_USER</code> / <code>SMTP_PASS</code> and
          restart. Drafting still works below.
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="who@theirbusiness.com.au"
            className="min-w-64 flex-1 rounded-sm border border-rule-strong bg-paper-card px-3 py-2 text-sm outline-none placeholder:text-rule-control focus:border-sage-deep"
          />
          <button
            type="button"
            onClick={() => void draft()}
            disabled={busy !== null || !lead.proposition}
            className="rounded-sm border border-rule-strong px-4 py-2 text-sm hover:border-ink disabled:opacity-50"
            title={lead.proposition ? undefined : 'Generate a proposition first'}
          >
            {busy === 'draft' ? 'Drafting…' : 'Draft with AI'}
          </button>
        </div>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="w-full rounded-sm border border-rule-strong bg-paper-card px-3 py-2 text-sm outline-none placeholder:text-rule-control focus:border-sage-deep"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder="The email. Draft it with AI, then make it yours before sending."
          className="w-full rounded-sm border border-rule-strong bg-paper-card p-3 text-sm leading-relaxed outline-none placeholder:text-rule-control focus:border-sage-deep"
        />
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy !== null || blockedReason !== null}
            className="rounded-sm bg-sage-deep px-5 py-2 text-sm font-medium text-paper hover:bg-sage disabled:opacity-50"
          >
            {busy === 'send'
              ? 'Sending…'
              : `Send from ${fromAddress || 'hello@westringia.com'}`}
          </button>
          <p className="text-xs text-rule-control">
            {blockedReason ?? 'Nothing sends without this click. Read it first.'}
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-4 border-l-2 border-clay pl-4 text-sm text-ink">{error}</p>
      ) : null}
    </div>
  )
}
