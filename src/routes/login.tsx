import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { user, loading, configured, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && user) void navigate({ to: '/' })
  }, [loading, user, navigate])

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="bg-ink py-2 text-center text-[0.78rem] tracking-wide text-paper">
        Internal to Westringia Labs
      </div>
      <div className="wrap flex max-w-xl flex-1 flex-col justify-center py-16">
        <p className="kicker">Leader</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
          Westringia <span className="text-sage-deep">Labs</span>
        </h1>
        <p className="mt-4 text-lg text-ink-soft">
          Enter a website. Get the research, the pitch angle, and the opportunity
          doc. Then go have the conversation.
        </p>
        {configured ? (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setError(null)
              setBusy(true)
              try {
                await signInWithGoogle()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Sign-in failed')
              } finally {
                setBusy(false)
              }
            }}
            className="mt-8 w-fit rounded-sm bg-sage-deep px-5 py-2.5 font-medium text-paper hover:bg-sage disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in with Google'}
          </button>
        ) : (
          <p className="mt-8 border-l-2 border-clay pl-4 text-sm text-ink-soft">
            Firebase is not configured yet. Copy <code>.env.example</code> to{' '}
            <code>.env</code>, fill in the <code>VITE_FIREBASE_*</code> values,
            and restart the dev server.
          </p>
        )}
        {error ? <p className="mt-4 text-sm text-clay">{error}</p> : null}
      </div>
    </div>
  )
}
