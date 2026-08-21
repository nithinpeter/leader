import { useEffect, useRef, useState } from 'react'
import {
  dailyCap,
  dayKey,
  stateForToday,
  warmupWeek,
  WARMUP_DAILY_CAPS,
  type WarmupState,
} from '@leader/core/automation/warmup'
import { setDailyCapOverride, subscribeToWarmup } from '../lib/warmup'
import { Alert, Button, Card, Input, Select, Spinner } from './ui'

/** How the limit is being decided right now. */
type Mode = 'ramp' | 'fixed' | 'paused'

function modeOf(state: WarmupState | null): Mode {
  if (!state || typeof state.overrideDailyCap !== 'number') return 'ramp'
  return state.overrideDailyCap === 0 ? 'paused' : 'fixed'
}

/**
 * The day's marketing allowance, and the control for it.
 *
 * The count is the cron's to write, so everything here is read-only except
 * `overrideDailyCap`. Worth having on screen at all because a spent allowance
 * and a broken cron look identical from the pipeline: leads sit at doc_ready
 * either way, and only this says which it is.
 */
export function SendingAllowance() {
  const [state, setState] = useState<WarmupState | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('ramp')
  const [fixed, setFixed] = useState('60')
  const [saving, setSaving] = useState(false)
  // Set while an edit is in flight, so an incoming snapshot does not snap the
  // controls back to the saved value mid-typing. Held in a ref as well as in
  // state because the snapshot handler is created once and would otherwise
  // close over whatever `dirty` was when the subscription opened.
  const [dirty, setDirty] = useState(false)
  const editing = useRef(false)

  useEffect(
    () =>
      subscribeToWarmup(
        (s) => {
          setState(s)
          if (editing.current) return
          setMode(modeOf(s))
          if (typeof s?.overrideDailyCap === 'number' && s.overrideDailyCap > 0) {
            setFixed(String(s.overrideDailyCap))
          }
        },
        (e) => setError(e.message),
      ),
    [],
  )

  function markEdited(next: boolean) {
    editing.current = next
    setDirty(next)
  }

  if (state === undefined) return null

  const today = dayKey(new Date())
  // Handles both a missing document and a count left over from yesterday.
  const effective = stateForToday(state, today)
  const cap = dailyCap(effective, today)
  const week = warmupWeek(effective.startedAt, today)
  const used = state ? effective.sentToday : 0
  const left = Math.max(0, cap - used)
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 100
  const started = state?.startedAt

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const value =
        mode === 'ramp' ? null : mode === 'paused' ? 0 : Math.max(0, Number(fixed) || 0)
      await setDailyCapOverride(value)
      markEdited(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the limit')
    } finally {
      setSaving(false)
    }
  }

  function change(next: Mode) {
    setMode(next)
    markEdited(true)
  }

  const rampCap = WARMUP_DAILY_CAPS[Math.min(week, WARMUP_DAILY_CAPS.length) - 1]
  const unsaved = dirty && modeOf(state) !== mode

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Sending allowance
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
            {used} of {cap}{' '}
            <span className="text-sm font-normal text-muted-foreground">
              sent today
            </span>
          </p>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          {cap === 0
            ? 'Marketing mail is paused. Replies to anyone who wrote to us still go out.'
            : left === 0
              ? 'Spent for today. Anything still due waits for tomorrow, and replies are unaffected.'
              : `${left} left. Cold emails and follow-ups spend this; replies do not.`}
        </p>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            pct >= 100 ? 'bg-destructive' : 'bg-primary'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Select
          value={mode}
          onChange={(e) => change(e.target.value as Mode)}
          className="h-8 w-auto"
        >
          <option value="ramp">Warm-up ramp</option>
          <option value="fixed">Fixed limit</option>
          <option value="paused">Paused</option>
        </Select>
        {mode === 'fixed' ? (
          <Input
            type="number"
            min={0}
            max={1000}
            value={fixed}
            onChange={(e) => {
              setFixed(e.target.value)
              markEdited(true)
            }}
            className="h-8 w-24"
            aria-label="Emails per day"
          />
        ) : null}
        {dirty ? (
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner className="size-3.5" /> : null}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {mode === 'ramp'
          ? started
            ? `Week ${week} of the ramp, so ${rampCap} a day. It climbs to ${
                WARMUP_DAILY_CAPS[WARMUP_DAILY_CAPS.length - 1]
              } by week ${WARMUP_DAILY_CAPS.length}. Started ${new Date(
                `${started}T00:00:00`,
              ).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}.`
            : `Nothing has been sent yet. Week 1 starts on the first email, at ${WARMUP_DAILY_CAPS[0]} a day, climbing to ${
                WARMUP_DAILY_CAPS[WARMUP_DAILY_CAPS.length - 1]
              } by week ${WARMUP_DAILY_CAPS.length}.`
          : mode === 'paused'
            ? 'No cold emails and no follow-ups until this changes. The cron keeps reading the mailbox and answering people who write back.'
            : 'Ignores the ramp and holds this number every day. Raising it well above the ramp on a domain with no sending history is what gets mail filtered.'}
        {unsaved ? ' Not saved yet.' : ''}
      </p>

      {error ? (
        <div className="mt-3">
          <Alert tone="destructive">{error}</Alert>
        </div>
      ) : null}
    </Card>
  )
}
