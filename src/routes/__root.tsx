import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AppShell } from '../components/AppShell'
import { AuthProvider } from '../lib/auth'
import appCss from '../styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Leader · Westringia Labs' },
      {
        name: 'description',
        content:
          'Lead research and opportunity docs for Westringia Labs. Enter a website, get the research, get the doc.',
      },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Public+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;0,8..60,500;0,8..60,600;0,8..60,700;1,8..60,400&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
})

function RootComponent() {
  return (
    <RootDocument>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </RootDocument>
  )
}

function NotFound() {
  return (
    <AppShell>
      <div className="wrap max-w-2xl py-20">
        <p className="kicker">404</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
          There is nothing at this address.
        </h1>
        <p className="mt-4 text-ink-soft">
          The page you asked for has been moved, deleted, or never existed. The
          pipeline is the best place to pick things back up.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/"
            className="rounded-sm bg-sage-deep px-4 py-2 text-sm font-medium text-paper hover:bg-sage"
          >
            Back to the pipeline
          </Link>
          <Link
            to="/leads/new"
            className="rounded-sm border border-rule-strong px-4 py-2 text-sm hover:border-ink"
          >
            Add a lead
          </Link>
        </div>
      </div>
    </AppShell>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <HeadContent />
      </head>
      <body className="bg-paper text-ink antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
