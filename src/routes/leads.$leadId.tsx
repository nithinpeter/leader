import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppShell, Protected } from '../components/AppShell'
import {
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  RefreshIcon,
  TrashIcon,
} from '../components/icons'
import { OutreachPanel } from '../components/OutreachPanel'
import { StatusBadge } from '../components/StatusBadge'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  Separator,
  Spinner,
  Textarea,
  buttonClass,
} from '../components/ui'
import { useAuth } from '../lib/auth'
import { deleteLead, subscribeToLead, updateLead } from '../lib/leads'
import {
  LEAD_STATUSES,
  STATUS_LABELS,
  type EmailDraft,
  type Lead,
  type LeadStatus,
} from '../lib/types'
import { generateProposition } from '../server/generate'

export const Route = createFileRoute('/leads/$leadId')({
  component: LeadDetailShell,
})

function LeadDetailShell() {
  const { leadId } = Route.useParams()
  const { user } = useAuth()
  const [lead, setLead] = useState<Lead | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  // Subscribe only once auth has resolved; Protected below handles the rest.
  useEffect(() => {
    if (!user) return
    return subscribeToLead(leadId, setLead, (e) => setError(e.message))
  }, [leadId, user])

  return (
    <AppShell
      breadcrumbs={[
        { label: 'Dashboard', to: '/' },
        { label: 'Leads', to: '/' },
        { label: lead?.companyName ?? 'Lead' },
      ]}
    >
      <Protected>
        <LeadDetail lead={lead} error={error} setError={setError} />
      </Protected>
    </AppShell>
  )
}

function LeadDetail({
  lead,
  error,
  setError,
}: {
  lead: Lead | null | undefined
  error: string | null
  setError: (e: string | null) => void
}) {
  const navigate = useNavigate()
  const [notes, setNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (lead && !notesDirty) setNotes(lead.notes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.notes])

  if (error) {
    return (
      <p className="p-6 text-sm text-destructive">Could not load lead: {error}</p>
    )
  }
  if (lead === undefined) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Loading…
      </div>
    )
  }
  if (lead === null) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">This lead no longer exists.</p>
        <Link to="/" className={buttonClass('outline', 'sm', 'mt-4')}>
          Back to the pipeline
        </Link>
      </div>
    )
  }

  const p = lead.proposition

  async function regenerate() {
    if (!lead?.extraction) return
    setBusy('regenerate')
    try {
      const proposition = await generateProposition({
        data: { extraction: lead.extraction },
      })
      await updateLead(lead.id, { proposition })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!lead) return
    if (!window.confirm(`Delete ${lead.companyName}? This cannot be undone.`)) return
    await deleteLead(lead.id)
    await navigate({ to: '/' })
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={lead.companyName} className="size-12 text-base" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {lead.companyName}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <a
                href={lead.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                {lead.domain}
                <ExternalLinkIcon size={12} />
              </a>
              <span>·</span>
              <span>
                added{' '}
                {new Date(lead.createdAt).toLocaleDateString('en-AU', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={lead.status} />
          <Select
            value={lead.status}
            onChange={(e) =>
              void updateLead(lead.id, { status: e.target.value as LeadStatus })
            }
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {p ? (
          <>
            <Link
              to="/doc/$leadId"
              params={{ leadId: lead.id }}
              className={buttonClass('default', 'sm')}
            >
              <FileTextIcon size={14} />
              Opportunity doc
            </Link>
            <Link
              to="/pitch/$leadId"
              params={{ leadId: lead.id }}
              className={buttonClass('outline', 'sm')}
            >
              <FileTextIcon size={14} />
              Pitch doc
            </Link>
          </>
        ) : null}
        {lead.extraction ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void regenerate()}
            disabled={busy === 'regenerate'}
          >
            {busy === 'regenerate' ? <Spinner className="size-3.5" /> : <RefreshIcon size={14} />}
            {busy === 'regenerate'
              ? 'Rewriting…'
              : p
                ? 'Regenerate proposition'
                : 'Generate proposition'}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => void remove()}
        >
          <TrashIcon size={14} />
          Delete lead
        </Button>
      </div>

      {p ? (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>The business</CardTitle>
                <CardDescription>{p.industry}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed">
                {p.companySummary}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Why we can help them</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed">
                {p.uniqueProposition}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Two automations worth building</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {p.useCases.map((uc, i) => (
                  <div key={i} className="rounded-lg border border-border p-5">
                    <Badge className="border-border bg-muted/60 text-foreground/80">
                      Use case {i + 1}
                    </Badge>
                    <h3 className="mt-2 font-semibold">{uc.title}</h3>
                    <dl className="mt-3 space-y-2.5 text-sm text-muted-foreground">
                      <Item label="The problem">{uc.problem}</Item>
                      <Item label="The automation">{uc.automation}</Item>
                      <Item label="What it saves">{uc.impact}</Item>
                      <Item label="Plugs into">{uc.integrations}</Item>
                    </dl>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cold email draft</CardTitle>
              <CardDescription>
                Written {new Date(p.generatedAt).toLocaleString('en-AU')} ·{' '}
                {p.model === 'template-fallback'
                  ? 'template draft, add a GOOGLE_GENERATIVE_AI_API_KEY for the real thing'
                  : p.model}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {p.email ? (
                <EmailDraftPanel email={p.email} to={lead.extraction?.emails[0]} />
              ) : (
                <>
                  {p.openingLine ? (
                    <p className="border-l-2 border-border pl-4 italic text-muted-foreground">
                      “{p.openingLine}”
                    </p>
                  ) : null}
                  <p className="mt-3 text-sm text-muted-foreground">
                    This lead was written before email drafting existed, so there
                    is no draft to send. Hit{' '}
                    <span className="font-medium text-foreground">
                      Regenerate proposition
                    </span>{' '}
                    above to write one.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No proposition yet.{' '}
            {lead.extraction
              ? 'Generate one from the research below.'
              : 'This lead has no site research attached.'}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Outreach</CardTitle>
          <CardDescription>
            Draft, edit, and send the first email from here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OutreachPanel lead={lead} />
        </CardContent>
      </Card>

      {lead.extraction ? (
        <Card>
          <CardHeader>
            <CardTitle>What the site says</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
              <Fact label="Title" value={lead.extraction.title} />
              <Fact label="Description" value={lead.extraction.description} />
              <Fact label="Emails" value={lead.extraction.emails.join(', ')} />
              <Fact label="Phones" value={lead.extraction.phones.join(', ')} />
              <Fact label="Runs on" value={lead.extraction.techSignals.join(', ')} />
              <Fact
                label="Pages read"
                value={lead.extraction.pagesCrawled.join('  ·  ')}
              />
            </div>
            {lead.extraction.headings.length ? (
              <>
                <Separator className="my-5" />
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Headings on the site
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {lead.extraction.headings.slice(0, 20).map((h) => (
                    <Badge
                      key={h}
                      className="border-border bg-transparent font-normal text-muted-foreground"
                    >
                      {h}
                    </Badge>
                  ))}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              setNotesDirty(true)
            }}
            rows={5}
            placeholder="Calls made, who answered, what they said…"
          />
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={!notesDirty}
            onClick={async () => {
              await updateLead(lead.id, { notes })
              setNotesDirty(false)
            }}
          >
            {notesDirty ? 'Save notes' : 'Saved'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * The cold email, ready to copy into a real mail client. Sent from a normal
 * inbox as plain text: no tracking pixel, no links, no attachment on the first
 * touch, which is most of what keeps a first email out of the spam folder.
 */
function EmailDraftPanel({ email, to }: { email: EmailDraft; to?: string }) {
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(what: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(what)
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1800)
  }

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
          <div className="text-sm">
            <span className="text-muted-foreground">To </span>
            <span>{to || 'no address found on the site'}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copy('first', `${email.subject}\n\n${email.body}`)}
          >
            <CopyIcon size={13} />
            {copied === 'first' ? 'Copied' : 'Copy email'}
          </Button>
        </div>
        <div className="border-b border-border px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Subject </span>
          <span className="font-medium">{email.subject}</span>
        </div>
        <p className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed">
          {email.body}
        </p>
      </div>

      {email.followUp ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
            <p className="text-sm">
              <span className="text-muted-foreground">
                Follow-up, about a week later{' '}
              </span>
              <span className="font-medium">{email.followUpSubject}</span>
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void copy('follow', `${email.followUpSubject}\n\n${email.followUp}`)
              }
            >
              <CopyIcon size={13} />
              {copied === 'follow' ? 'Copied' : 'Copy follow-up'}
            </Button>
          </div>
          <p className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed text-muted-foreground">
            {email.followUp}
          </p>
        </div>
      ) : null}

      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Before you send
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
          <li>
            This is the draft as written. Outreach below prefills from it and
            adds your name, who we are, and the opt-out line before you send.
          </li>
          <li>
            Copying it into your own inbox instead? Add those three yourself. A
            cold commercial email needs the sender identified and a way to say
            stop.
          </li>
          <li>Send it from a person's address, one at a time. Not a mailing tool, not a bcc list.</li>
          <li>Leave the docs out of the first email. Attachments and links to a cold address are what trips the filters. Send the doc when they reply.</li>
          <li>Read the first line out loud. If it could have been sent to any business, rewrite it.</li>
          <li>Plain text only. No tracking pixel, no images.</li>
        </ul>
      </div>
    </div>
  )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.68rem] font-medium uppercase tracking-wider text-muted-foreground/80">
        {label}
      </dt>
      <dd className="mt-0.5 text-foreground/90">{children}</dd>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 break-words text-muted-foreground">{value}</p>
    </div>
  )
}
