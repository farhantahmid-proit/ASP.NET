import { createRootRouteWithContext, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { FresnelCommandSearchModal } from '@/components/ui/FresnelCommandSearchModal'
import { PwaInstallBanner, PwaInstallButton } from '@/components/ui/PwaInstallBanner'
import { SavedAuditsDrawer } from '@/components/history/SavedAuditsDrawer'
import { readEmbedContext } from '@/embed/protocol'
import { useLocalAuditStorage } from '@/hooks/useLocalAuditStorage'
import type { FresnelSearchItem } from '@/lib/fuzzy-search'
import { useAuth } from '@/providers/auth-provider'
import { useTheme } from '@/providers/theme-provider'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
})

const EMBEDDED = readEmbedContext().embedded

const QUICK_SEARCH_ROUTES: FresnelSearchItem[] = [
  {
    id: 'route-workbench',
    kind: 'route',
    title: 'Workbench Repository Intake',
    subtitle: 'Run static AST code & Lighthouse remediation audit',
    keywords: ['home', 'demo', 'repo', 'ast'],
    to: '/',
  },
  {
    id: 'route-live',
    kind: 'route',
    title: 'Live URL & axe-core Audit Suite',
    subtitle: 'PageSpeed Insights, Core Web Vitals, Business URL 10-tool Audit',
    keywords: ['live', 'pagespeed', 'axe', 'web-vitals', 'business'],
    to: '/audit/live',
  },
  {
    id: 'route-compare',
    kind: 'route',
    title: 'Compare Audits & Global Trends',
    subtitle: 'Cross-repo trajectory, score trends, and run-to-run diff',
    keywords: ['compare', 'trends', 'diff', 'history', 'global'],
    to: '/audit/compare',
  },
  {
    id: 'route-dashboard',
    kind: 'route',
    title: 'Workspace, AST Scanner & SSH Guide',
    subtitle: 'Web Worker Acorn AST scanner, embed keys, saved history',
    keywords: ['dashboard', 'workspace', 'worker', 'ssh', 'git'],
    to: '/dashboard',
  },
]

function FresnelBrandMark() {
  return (
    <svg viewBox="0 0 100 100" width={28} height={28} fill="none" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M49.65 14.8C50.25 14.8 50.75 15.3 50.75 15.9V17.95C54.65 18.55 57.62 20.85 57.62 23.65C57.62 24.05 57.25 24.35 56.54 24.45V29.45C57.95 30.15 59.18 31.35 59.18 32.95C59.18 34.65 57.85 35.95 56.25 36.75L59.08 78.55H60.35V81.85H63.38V85.15H36.52V81.85H39.55V78.55H40.82L43.65 36.75C42.05 35.95 40.72 34.65 40.72 32.95C40.72 31.35 41.95 30.15 43.36 29.45V24.45C42.65 24.35 42.28 24.05 42.28 23.65C42.28 20.85 45.25 18.55 49.15 17.95V15.9C49.15 15.3 49.35 14.8 49.65 14.8ZM44.73 24.95V29.05H54.69V24.95H44.73Z"
        fill="currentColor"
      />
    </svg>
  )
}

function NotFoundPage() {
  return (
    <section className="fr-card fr-auth-layout">
      <div className="fr-eyebrow">
        <span className="fr-eyebrow-line" /> 404 NOT FOUND
      </div>
      <h2>Page not found</h2>
      <p className="fr-muted">
        The route you requested does not exist in this Fresnel workspace.
      </p>
      <div className="fr-actions">
        <Link to="/" className="fr-btn-primary">
          Back to Workbench →
        </Link>
        <Link to="/dashboard" className="fr-btn-secondary">
          Open Workspace
        </Link>
      </div>
    </section>
  )
}

function RootLayout() {
  const { theme, toggleTheme } = useTheme()
  const { session } = useAuth()
  const navigate = useNavigate()
  const { localAudits } = useLocalAuditStorage()

  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  useEffect(() => {
    if (EMBEDDED) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsSearchOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const quickRoutes = useMemo(() => QUICK_SEARCH_ROUTES, [])

  if (EMBEDDED) {
    return (
      <div className="fresnel-root fresnel-embed-shell" data-theme={theme}>
        <Outlet />
      </div>
    )
  }

  return (
    <div className="fresnel-root" data-theme={theme}>
      <header className="fr-topbar">
        <Link to="/" className="fr-brand" aria-label="Fresnel home">
          <FresnelBrandMark />
          <span>Fresnel</span>
          <span className="fr-badge">OSS v2</span>
        </Link>

        <nav className="fr-nav" aria-label="Primary navigation">
          <Link to="/" className="fr-nav-link">
            Workbench
          </Link>
          <Link to="/audit/live" className="fr-nav-link">
            Live Audit
          </Link>
          <Link to="/audit/compare" className="fr-nav-link">
            Compare
          </Link>
          <Link to="/dashboard" className="fr-nav-link">
            Workspace
          </Link>
          <button
            type="button"
            id="fresnel-topbar-search-btn"
            className="fr-icon-btn"
            onClick={() => setIsSearchOpen(true)}
            aria-label="Open command search (Ctrl+K)"
          >
            Search (Ctrl+K)
          </button>
          <button
            type="button"
            id="fresnel-topbar-drawer-btn"
            className="fr-icon-btn"
            onClick={() => setIsDrawerOpen(true)}
          >
            Saved ({localAudits.length})
          </button>
          <PwaInstallButton />
          {!session && (
            <Link to="/sign-in" className="fr-nav-link">
              Sign in
            </Link>
          )}
          <button
            type="button"
            className="fr-icon-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </nav>
      </header>

      <main className="fr-main">
        <PwaInstallBanner onOpenSavedAudits={() => setIsDrawerOpen(true)} />
        <Outlet />
      </main>

      <FresnelCommandSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        savedAudits={localAudits}
        quickRoutes={quickRoutes}
        onSelectItem={(item) => {
          if (item.auditId) {
            void navigate({ to: '/audit/$auditId', params: { auditId: item.auditId } })
          } else if (item.to) {
            void navigate({ to: item.to })
          }
        }}
      />

      <SavedAuditsDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onOpenSavedAudit={(rec) => {
          void navigate({ to: '/audit/$auditId', params: { auditId: rec.auditId } })
        }}
      />
    </div>
  )
}
