import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { readEmbedContext } from '@/embed/protocol'
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
          <Link to="/" className="fr-nav-link">Workbench</Link>
          <Link to="/dashboard" className="fr-nav-link">Workspace</Link>
          {!session && <Link to="/sign-in" className="fr-nav-link">Sign in</Link>}
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
        <Outlet />
      </main>
    </div>
  )
}
