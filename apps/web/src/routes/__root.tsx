import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AppShell } from '../components/AppShell'
import { buttonClass } from '../components/ui'
import { AuthProvider } from '../lib/auth'
import appCss from '../styles/app.css?url'

/** Applies the saved theme before first paint so dark mode never flashes. */
const THEME_INIT = `try{if(localStorage.getItem('leader-theme')==='dark'||(!localStorage.getItem('leader-theme')&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`

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
        href: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;0,8..60,500;0,8..60,600;0,8..60,700;1,8..60,400&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
    scripts: [{ children: THEME_INIT }],
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
    <AppShell breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: '404' }]}>
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <p className="text-sm font-semibold text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          There is nothing at this address.
        </h1>
        <p className="mt-3 text-muted-foreground">
          The page you asked for has been moved, deleted, or never existed. The
          pipeline is the best place to pick things back up.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/" className={buttonClass('default')}>
            Back to the pipeline
          </Link>
          <Link to="/leads/new" className={buttonClass('outline')}>
            Add a lead
          </Link>
        </div>
      </div>
    </AppShell>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
