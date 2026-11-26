import { createFileRoute, Link } from '@tanstack/react-router'
import { useAuth } from '@/providers/auth-provider'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  const { session } = useAuth()

  return (
    <section className="fr-hero">
      <div className="fr-eyebrow">
        <span className="fr-eyebrow-line" /> ZERO-AI ALL-IN-ONE SITE &amp; CODE AUDITOR
      </div>
      <h1 className="fr-title">
        Focus scattered web defects into <span>atomic fixes.</span>
      </h1>
      <p className="fr-intro">
        Fresnel pairs static AST code analysis with live Lighthouse, security, and full-site
        crawling — now running on React 19, Vite, and TanStack Router.
      </p>

      <div className="fr-actions">
        {session ? (
          <Link to="/dashboard" className="fr-btn-primary">
            Open {session.workspace.name} Workspace →
          </Link>
        ) : (
          <>
            <Link to="/register" className="fr-btn-primary">Create Workspace →</Link>
            <Link to="/sign-in" className="fr-btn-secondary">Sign in</Link>
          </>
        )}
      </div>
    </section>
  )
}
