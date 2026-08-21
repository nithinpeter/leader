import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import {
  BellIcon,
  ChevronRightIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MoonIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
} from './icons'
import { Avatar, Button, Separator, cn } from './ui'

export interface Crumb {
  label: string
  to?: string
}

const THEME_KEY = 'leader-theme'

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
}

function ThemeToggle() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => {
        applyTheme(!dark)
        setDark(!dark)
      }}
    >
      {dark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </Button>
  )
}

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon, exact: true },
  { to: '/leads/new', label: '+ lead', icon: PlusIcon, exact: false },
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
          W
        </span>
        <span className="grid leading-tight">
          <span className="text-sm font-semibold">Westringia Labs</span>
          <span className="text-xs text-muted-foreground">Leader</span>
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4">
        <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          Platform
        </p>
        <ul className="grid gap-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                onClick={onNavigate}
                activeOptions={{ exact: item.exact }}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className:
                    'flex items-center gap-2.5 rounded-md bg-sidebar-accent px-2 py-2 text-sm font-medium text-sidebar-accent-foreground',
                }}
              >
                <item.icon size={16} className="text-muted-foreground" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {user ? (
        <div className="border-t border-sidebar-border p-2">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
            <Avatar name={user.displayName || user.email || 'You'} />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium">
                {user.displayName || 'Signed in'}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              title="Sign out"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOutIcon size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function AppShell({
  children,
  breadcrumbs = [],
}: {
  children: ReactNode
  breadcrumbs?: Crumb[]
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'no-print sticky top-0 hidden h-screen shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:block',
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden border-r-0',
        )}
      >
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="no-print fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-lg">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle sidebar"
            className="-ml-1.5 hidden md:inline-flex"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <PanelLeftIcon size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            className="-ml-1.5 md:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <PanelLeftIcon size={18} />
          </Button>

          {breadcrumbs.length ? (
            <>
              <Separator orientation="vertical" className="mx-1" />
              <nav aria-label="Breadcrumb" className="min-w-0">
                <ol className="flex items-center gap-1.5 text-sm">
                  {breadcrumbs.map((crumb, i) => {
                    const last = i === breadcrumbs.length - 1
                    return (
                      <li
                        key={`${crumb.label}-${i}`}
                        className="flex min-w-0 items-center gap-1.5"
                      >
                        {i > 0 ? (
                          <ChevronRightIcon
                            size={14}
                            className="shrink-0 text-muted-foreground"
                          />
                        ) : null}
                        {crumb.to && !last ? (
                          <Link
                            to={crumb.to}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {crumb.label}
                          </Link>
                        ) : (
                          <span
                            className={cn(
                              'truncate',
                              last
                                ? 'font-medium text-foreground'
                                : 'text-muted-foreground',
                            )}
                          >
                            {crumb.label}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </nav>
            </>
          ) : null}

          <div className="ml-auto flex items-center gap-1.5">
            <label className="relative hidden sm:block">
              <SearchIcon
                size={15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                placeholder="Search…"
                className="h-8 w-44 rounded-md border border-input bg-muted/40 pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 lg:w-56"
              />
            </label>
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <BellIcon size={18} />
            </Button>
            <ThemeToggle />
            <HeaderUser />
          </div>
        </header>

        <main id="main" className="flex-1">
          {children}
        </main>
      </div>
    </div>
  )
}

function HeaderUser() {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  if (!user) return null
  const name = user.displayName || user.email || 'You'
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label="Account menu"
      >
        <Avatar name={name} />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Separator className="my-1" />
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <LogOutIcon size={15} />
              Sign out
            </button>
          </div>
        </>
      ) : null}
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
      <div className="py-24 text-center text-sm text-muted-foreground">
        Checking who you are…
      </div>
    )
  }
  return <>{children}</>
}

function FirebaseNotConfigured() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Setup needed
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Firebase is not configured.
      </h1>
      <p className="mt-4 text-muted-foreground">
        Copy <code className="rounded bg-muted px-1.5 py-0.5">.env.example</code>{' '}
        to <code className="rounded bg-muted px-1.5 py-0.5">.env</code> and fill
        in the <code className="rounded bg-muted px-1.5 py-0.5">VITE_FIREBASE_*</code>{' '}
        values from your Firebase project, then restart the dev server. The README
        covers the whole setup.
      </p>
    </div>
  )
}
