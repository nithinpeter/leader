import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  return (
    <div className="min-h-screen bg-paper">
      <div className="no-print bg-ink text-paper">
        <div className="wrap flex items-center gap-3 py-2 text-[0.78rem] tracking-wide">
          <span className="font-semibold">Leader</span>
          <span className="text-paper/60">
            Lead research and opportunity docs, internal to Westringia Labs.
          </span>
        </div>
      </div>
      <header className="no-print border-b border-rule bg-paper">
        <div className="wrap flex flex-wrap items-center justify-between gap-4 py-4">
          <Link to="/" className="group">
            <span className="font-display text-2xl font-semibold tracking-tight">
              Westringia <span className="text-sage-deep">Labs</span>
            </span>
            <span className="ml-3 align-middle text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-rule-control">
              Leader
            </span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              to="/"
              className="text-ink-soft hover:text-ink"
              activeProps={{ className: 'font-semibold text-ink' }}
              activeOptions={{ exact: true }}
            >
              Leads
            </Link>
            <Link
              to="/leads/new"
              className="rounded-sm bg-sage-deep px-3.5 py-1.5 font-medium text-paper hover:bg-sage"
            >
              New lead
            </Link>
            {user ? (
              <button
                type="button"
                onClick={() => void signOut()}
                className="text-ink-soft hover:text-ink"
                title={user.email ?? undefined}
              >
                Sign out
              </button>
            ) : null}
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
    </div>
  )
}

/**
 * Client-side auth gate: waits for Firebase to resolve, then bounces
 * unauthenticated visitors to /login.
 */
export function Protected({ children }: { children: ReactNode }) {
  const { user, loading, configured } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (configured && !loading && !user) {
      void navigate({ to: '/login' })
    }
  }, [configured, loading, user, navigate])

  if (!configured) return <FirebaseNotConfigured />
  if (loading || !user) {
    return (
      <div className="wrap py-24 text-center text-sm text-rule-control">
        Checking who you are…
      </div>
    )
  }
  return <>{children}</>
}

function FirebaseNotConfigured() {
  return (
    <div className="wrap max-w-2xl py-20">
      <p className="kicker">Setup needed</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">
        Firebase is not configured.
      </h1>
      <p className="mt-4 text-ink-soft">
        Copy <code className="rounded bg-paper-deep px-1.5 py-0.5">.env.example</code>{' '}
        to <code className="rounded bg-paper-deep px-1.5 py-0.5">.env</code> and fill
        in the <code className="rounded bg-paper-deep px-1.5 py-0.5">VITE_FIREBASE_*</code>{' '}
        values from your Firebase project, then restart the dev server. The README
        covers the whole setup.
      </p>
    </div>
  )
}
