import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from '../components/ui'
import { useAuth } from '../lib/auth'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.86c2.26-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.86-3c-1.08.72-2.45 1.15-4.08 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12.01 12.01 0 0 0 0 10.74l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.53 11.53 0 0 0 12 0 12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.87 8.87 4.77 12 4.77Z"
      />
    </svg>
  )
}

function LoginPage() {
  const { user, loading, configured, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && user) void navigate({ to: '/' })
  }, [loading, user, navigate])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-6">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-display text-base font-bold text-primary-foreground">
          W
        </span>
        <span className="grid leading-tight">
          <span className="font-semibold">Westringia Labs</span>
          <span className="text-xs text-muted-foreground">Leader</span>
        </span>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-lg">Welcome back</CardTitle>
          <CardDescription>
            Enter a website. Get the research, the pitch angle, and the
            opportunity doc. Then go have the conversation.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {configured ? (
            <Button
              variant="outline"
              disabled={busy}
              className="w-full"
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
            >
              {busy ? <Spinner /> : <GoogleMark />}
              {busy ? 'Signing in…' : 'Sign in with Google'}
            </Button>
          ) : (
            <Alert>
              Firebase is not configured yet. Copy <code>.env.example</code> to{' '}
              <code>.env</code>, fill in the <code>VITE_FIREBASE_*</code> values,
              and restart the dev server.
            </Alert>
          )}
          {error ? <Alert tone="destructive">{error}</Alert> : null}
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Internal to Westringia Labs.
      </p>
    </div>
  )
}
