import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { apiFetch } from '@/api/client'
import { useRunWidgetSiteAudit } from '@/api/site-audit/site-audit.hooks'
import type { WidgetSiteAuditResponse } from '@/api/$types/site-audit/response'
import { RadialScoreGauge } from '@/components/ui/RadialScoreGauge'
import { MESSAGE_SOURCE, isHostEvent, readEmbedContext, type WidgetEvent } from '@/embed/protocol'

export const Route = createFileRoute('/widget/$publicKey')({ component: FresnelWidgetPage })

type WidgetMetaResponse = {
  workspace: { id: string; name: string; slug: string }
  widget: { id: string; workspace_id: string; public_key: string; name: string; is_default: boolean }
}

function FresnelWidgetPage() {
  const { publicKey } = Route.useParams()
  const [{ embedded, parentOrigin, targetUrl: initialTarget }] = useState(() => readEmbedContext())
  const [targetUrl, setTargetUrl] = useState(initialTarget ?? '')
  const [auditResult, setAuditResult] = useState<WidgetSiteAuditResponse | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const metaQuery = useQuery({
    queryKey: ['widget', 'meta', publicKey],
    queryFn: () =>
      apiFetch<WidgetMetaResponse>(`/api/widget/${encodeURIComponent(publicKey)}/meta`, {
        fallbackError: 'Widget key not found.',
      }),
    retry: false,
  })

  const auditMutation = useRunWidgetSiteAudit()

  const notify = useCallback(
    (msg: WidgetEvent) => {
      if (!embedded || !parentOrigin) return
      window.parent.postMessage(msg, parentOrigin)
    },
    [embedded, parentOrigin],
  )

  const executeWidgetAudit = useCallback(
    async (urlOverride?: string) => {
      const effectiveUrl = (urlOverride ?? targetUrl).trim()
      if (!effectiveUrl) {
        setAuditError('Enter a valid public https:// URL to audit.')
        return
      }
      setAuditError(null)
      notify({ source: MESSAGE_SOURCE, type: 'audit_started', targetUrl: effectiveUrl })
      try {
        const res = await auditMutation.mutateAsync({ publicKey, targetUrl: effectiveUrl })
        setAuditResult(res)
        notify({ source: MESSAGE_SOURCE, type: 'audit_completed', score: res.scores.overall })
      } catch (err) {
        setAuditError(err instanceof Error ? err.message : 'Unable to audit the target URL.')
      }
    },
    [auditMutation, notify, publicKey, targetUrl],
  )

  useEffect(() => {
    if (!embedded || !parentOrigin) return
    const send = (msg: WidgetEvent) => window.parent.postMessage(msg, parentOrigin)
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return
      if (!isHostEvent(event.data)) return
      if (event.data.type === 'opened') {
        inputRef.current?.focus()
      } else if (event.data.type === 'run_audit') {
        const nextUrl = event.data.targetUrl || targetUrl
        if (event.data.targetUrl) setTargetUrl(event.data.targetUrl)
        if (nextUrl) void executeWidgetAudit(nextUrl)
      }
    }
    window.addEventListener('message', onMessage)
    send({ source: MESSAGE_SOURCE, type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [embedded, parentOrigin, executeWidgetAudit, targetUrl])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (embedded && event.key === 'Escape') {
      notify({ source: MESSAGE_SOURCE, type: 'close' })
    }
  }

  return (
    <section className="fr-widget-shell" onKeyDown={handleKeyDown}>
      <header className="fr-widget-header">
        <strong>{metaQuery.data?.widget.name ?? 'Fresnel Site Auditor'}</strong>
        <div className="fr-widget-header-actions">
          <span className="fr-badge">{publicKey.slice(0, 12)}…</span>
          {embedded && (
            <button
              type="button"
              className="fr-widget-close"
              onClick={() => notify({ source: MESSAGE_SOURCE, type: 'close' })}
              aria-label="Close widget"
            >
              ×
            </button>
          )}
        </div>
      </header>
      <div className="fr-widget-body">
        {metaQuery.isError && (
          <p className="fr-error" role="alert">
            {metaQuery.error.message}
          </p>
        )}

        <form
          className="fr-widget-form"
          onSubmit={(e) => {
            e.preventDefault()
            void executeWidgetAudit()
          }}
        >
          <label className="fr-label" htmlFor="widget-target">
            Target URL
          </label>
          <div className="fr-widget-input-row">
            <input
              ref={inputRef}
              id="widget-target"
              type="url"
              required
              className="fr-input"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com"
            />
            <button
              type="submit"
              className="fr-btn fr-btn--primary"
              disabled={auditMutation.isPending || metaQuery.isError}
            >
              {auditMutation.isPending ? 'Auditing…' : 'Audit'}
            </button>
          </div>
        </form>

        {auditError && (
          <p className="fr-error" role="alert">
            {auditError}
          </p>
        )}

        {auditResult ? (
          <div className="fr-widget-results">
            <div className="fr-widget-scores">
              <RadialScoreGauge
                score={auditResult.scores.overall}
                size={76}
                strokeWidth={7}
                label="Overall"
              />
              <RadialScoreGauge
                score={auditResult.scores.security}
                size={76}
                strokeWidth={7}
                label="Security"
                category="security"
              />
              <RadialScoreGauge
                score={auditResult.scores.seo}
                size={76}
                strokeWidth={7}
                label="SEO"
                category="seo"
              />
              <RadialScoreGauge
                score={auditResult.scores.geo}
                size={76}
                strokeWidth={7}
                label="GEO"
                category="accessibility"
              />
            </div>

            <div className="fr-chip-row">
              <span className="fr-badge">CMS: {auditResult.detectedCms}</span>
              {auditResult.techStack.slice(0, 4).map((tech) => (
                <span key={tech} className="fr-chip">
                  {tech}
                </span>
              ))}
              <span className="fr-chip">{auditResult.durationMs} ms</span>
            </div>

            <div className="fr-widget-findings">
              <h4>
                Top Findings ({auditResult.findings.length} of {auditResult.totalFindingsCount})
              </h4>
              <ul className="fr-violation-list">
                {auditResult.findings.map((finding) => (
                  <li key={finding.id} className="fr-violation-item">
                    <div className="fr-widget-finding-head">
                      <strong>{finding.title}</strong>
                      <span
                        className={
                          finding.severity === 'critical' || finding.severity === 'high'
                            ? 'fr-pill-bad'
                            : 'fr-pill-warn'
                        }
                      >
                        {finding.severity}
                      </span>
                    </div>
                    <p className="fr-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                      {finding.remediation}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="fr-widget-footer-link">
              <Link
                to="/audit/live"
                search={{ targetUrl: auditResult.finalUrl, source: 'widget' }}
                target={embedded ? '_blank' : undefined}
                rel={embedded ? 'noopener noreferrer' : undefined}
                className="fr-btn fr-btn--secondary"
              >
                Open Full Report in Fresnel
              </Link>
            </div>
          </div>
        ) : (
          <p className="fr-muted">
            Run a live audit to evaluate DNS, TLS, HTTP security headers, GEO readiness, and
            passive attack-surface findings.
          </p>
        )}
      </div>
    </section>
  )
}
