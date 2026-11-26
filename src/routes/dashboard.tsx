import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/providers/auth-provider'

export const Route = createFileRoute('/dashboard')({ component: DashboardPage })

function DashboardPage() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  if (!session) {
    return (
      <section className="fr-card fr-auth-layout">
        <h2>Sign in to your workspace</h2>
        <p className="fr-muted">Your saved audits and embeddable widget keys appear here.</p>
        <Link className="fr-btn-primary" to="/sign-in">Go to sign in →</Link>
      </section>
    )
  }

  const embedSnippet = `<script src="${window.location.origin}/widget.js" data-key="${session.widget.public_key}" data-color="#713fb9" async></script>`

  async function copySnippet() {
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(embedSnippet)
      setCopied(true)
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopyError('Could not copy automatically. Please copy the snippet manually.')
    }
  }

  return (
    <section className="fr-dashboard">
      <div className="fr-dashboard-header">
        <div>
          <div className="fr-eyebrow"><span className="fr-eyebrow-line" /> FRESNEL WORKSPACE</div>
          <h1>{session.workspace.name}</h1>
          <p className="fr-muted">
            Signed in as {session.administrator.email} · Slug: <code>{session.workspace.slug}</code>
          </p>
        </div>
        <button
          type="button"
          className="fr-btn-secondary"
          onClick={() => {
            signOut()
            void navigate({ to: '/sign-in' })
          }}
        >
          Sign out
        </button>
      </div>

      <article className="fr-card">
        <h2>Embeddable Site Audit Widget</h2>
        <p className="fr-muted">
          Public Key: <code>{session.widget.public_key}</code>
        </p>
        <pre className="fr-code-block">{embedSnippet}</pre>
        {copyError && <p className="fr-error" role="alert">{copyError}</p>}
        <div className="fr-actions">
          <button type="button" className="fr-btn-primary" onClick={copySnippet}>
            {copied ? 'Copied snippet ✓' : 'Copy embed script'}
          </button>
          <Link
            to="/widget/$publicKey"
            params={{ publicKey: session.widget.public_key }}
            className="fr-btn-secondary"
          >
            Preview standalone widget
          </Link>
        </div>
      </article>
    </section>
  )
}
