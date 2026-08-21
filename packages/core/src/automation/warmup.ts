/**
 * How much marketing mail the sending domain is allowed to put out today.
 *
 * The per-run cap in cycle.ts limits a burst; it does nothing about the day.
 * Three first emails every thirty minutes is 144 a day, and the number itself
 * is not the problem - a small consultancy sending 144 emails is unremarkable.
 * The problem is a domain with no sending history going from zero to 144
 * overnight, which is the shape of a compromised mailbox rather than a
 * business. So the allowance starts small and climbs weekly, and the ledger
 * that tracks it lives in one Firestore document rather than being recomputed
 * from the leads, so a person can read it, and override it, without reasoning
 * about the whole pipeline.
 *
 * Replies are deliberately outside all of this. Someone who wrote to us and is
 * waiting on an answer is not marketing, capping it would lose the deal the
 * cold email was for, and high-engagement mail helps a domain's reputation
 * rather than costing it.
 */

/**
 * The allowance by week of sending, and week six onward is the ceiling. Each
 * step is roughly half again on the one before, which is about as fast as a
 * domain's ramp can look ordinary. Edit the numbers here; nothing else needs
 * to know them.
 */
export const WARMUP_DAILY_CAPS = [30, 45, 65, 90, 120, 144]

/** What the ledger document holds. One document, not one per day. */
export interface WarmupState {
  /** The day the first marketing email went out, `YYYY-MM-DD` in Sydney. */
  startedAt: string
  /** The day `sentToday` counts, so a stale count resets rather than carries. */
  day: string
  /** Marketing emails sent on `day`. Replies are not counted. */
  sentToday: number
  /**
   * Set by hand to ignore the schedule: a fixed daily allowance, or 0 to stop
   * marketing mail without touching the deploy. Absent means follow the ramp.
   */
  overrideDailyCap?: number
  /** Last time the cycle wrote this, for whoever opens the document. */
  updatedAt?: string
}

/** Reads and writes the single warm-up document. */
export interface WarmupLedger {
  read(): Promise<WarmupState | null>
  write(state: WarmupState): Promise<void>
}

/**
 * The calendar day in Sydney, which is the timezone the schedule runs on. UTC
 * would roll the allowance over mid-morning here and make the daily number
 * mean nothing.
 */
const SYDNEY_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Sydney',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function dayKey(now: Date): string {
  return SYDNEY_DAY.format(now)
}

/** Week of the ramp, 1-based. Both arguments are `YYYY-MM-DD`. */
export function warmupWeek(startedAt: string, today: string): number {
  const days = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startedAt}T00:00:00Z`)) / 86_400_000,
  )
  // An unparseable date gives NaN, and NaN would walk straight past both the
  // clamp and the index below into an undefined cap. Week one is the safe read.
  if (!Number.isFinite(days)) return 1
  return Math.floor(Math.max(0, days) / 7) + 1
}

/** Today's allowance: the override if one is set, otherwise the ramp. */
export function dailyCap(state: WarmupState | null, today: string): number {
  if (state && typeof state.overrideDailyCap === 'number') {
    return Math.max(0, state.overrideDailyCap)
  }
  const week = state ? warmupWeek(state.startedAt, today) : 1
  return WARMUP_DAILY_CAPS[Math.min(week, WARMUP_DAILY_CAPS.length) - 1]
}

/**
 * The ledger as the cycle should read it: a count that belongs to another day
 * is zero today, and a missing document means nothing has ever been sent, so
 * the ramp starts now.
 */
export function stateForToday(
  state: WarmupState | null,
  today: string,
): WarmupState {
  if (!state) return { startedAt: today, day: today, sentToday: 0 }
  if (state.day !== today) return { ...state, day: today, sentToday: 0 }
  return state
}

/**
 * A ledger that forgets. Used for dry runs, where the cycle should behave
 * exactly as it would with sending on but must not spend the real allowance.
 */
export function inMemoryLedger(initial: WarmupState | null = null): WarmupLedger {
  let held = initial
  return {
    async read() {
      return held
    },
    async write(state) {
      held = state
    },
  }
}
