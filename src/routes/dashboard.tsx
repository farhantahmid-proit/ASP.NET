import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AstWorkerScanner } from '@/components/audit/AstWorkerScanner'
import { AuditOverviewPanel } from '@/components/audit/AuditOverviewPanel'
import { useAuth } from '@/providers/auth-provider'
import type { LocalSavedAuditRecord } from '@/types/audit'

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

  const embedSnippet = session
    ? `<script src="${window.location.origin}/widget.js" data-key="${session.widget.public_key}" data-color="#713fb9" async></script>`
    : ''

  async function copySnippet() {
    if (!embedSnippet) return
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

  function openAuditById(auditId: string) {
    void navigate({ to: '/audit/$auditId', params: { auditId } })
  }

  function handleOpenSavedRecord(record: LocalSavedAuditRecord) {
    openAuditById(record.auditId)
  }

  return (
    <section className="fr-dashboard">
      {session ? (
        <>
          <div className="fr-dashboard-header">
            <div>
              <div className="fr-eyebrow">
                <span className="fr-eyebrow-line" /> FRESNEL WORKSPACE
              </div>
              <h1>{session.workspace.name}</h1>
              <p className="fr-muted">
                Signed in as {session.administrator.email} · Slug:{' '}
                <code>{session.workspace.slug}</code>
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
            {copyError && (
              <p className="fr-error" role="alert">
                {copyError}
              </p>
            )}
            <div className="fr-actions">
              <button type="button" className="fr-btn-primary" onClick={() => void copySnippet()}>
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
        </>
      ) : (
        <article className="fr-card">
          <div className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> LOCAL &amp; WORKSPACE DASHBOARD
          </div>
          <h1>Saved Audits &amp; In-Browser AST Scanner</h1>
          <p className="fr-muted">
            Run browser Web Worker AST scans and inspect locally persisted reports immediately, or
            sign in to manage your workspace embed key.
          </p>
          <div className="fr-actions">
            <Link className="fr-btn-primary" to="/sign-in">
              Sign in →
            </Link>
            <Link className="fr-btn-secondary" to="/register">
              Create Workspace
            </Link>
          </div>
        </article>
      )}

      <AuditOverviewPanel
        onOpenAuditSession={openAuditById}
        onOpenSavedRecord={handleOpenSavedRecord}
      />

      <AstWorkerScanner onOpenSavedAudit={handleOpenSavedRecord} />
    </section>
  )
}
