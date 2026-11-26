import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { BusinessUrlAudit } from '@/components/live-audit/BusinessUrlAudit'
import { LiveAuditSuite } from '@/components/live-audit/LiveAuditSuite'
import type { LocalSavedAuditRecord } from '@/types/audit'

export interface LiveAuditSearch {
  targetUrl?: string
  source?: string
}

export const Route = createFileRoute('/audit/live')({
  validateSearch: (search: Record<string, unknown>): LiveAuditSearch => ({
    ...(typeof search.targetUrl === 'string' && search.targetUrl
      ? { targetUrl: search.targetUrl }
      : {}),
    ...(typeof search.source === 'string' && search.source ? { source: search.source } : {}),
  }),
  component: LiveAuditPage,
})

function LiveAuditPage() {
  const { targetUrl = '', source } = Route.useSearch()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'suite' | 'business'>('suite')

  function handleOpenSavedAudit(record: LocalSavedAuditRecord) {
    void navigate({
      to: '/audit/$auditId',
      params: { auditId: record.auditId },
    })
  }

  return (
    <div className="fr-audit-session">
      <header className="fr-section-head">
        <div>
          <p className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> LIVE WEBSITE &amp; BROWSER AUDITING
          </p>
          <h1 className="fr-audit-title">Live URL &amp; Accessibility Audit Suite</h1>
          <p className="fr-muted">
            Evaluate public websites with PageSpeed Insights, run live DOM <code>axe-core</code>{' '}
            WCAG scans, track real-time <code>web-vitals</code>, or launch a 10-tool business audit.
            {source ? ` (Launched via ${source})` : ''}
          </p>
        </div>

        <div className="fr-segmented" role="tablist" aria-label="Live audit mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'suite'}
            className={`fr-segmented__btn${mode === 'suite' ? ' is-active' : ''}`}
            onClick={() => setMode('suite')}
          >
            Live Audit Suite (PSI / axe / Vitals)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'business'}
            className={`fr-segmented__btn${mode === 'business' ? ' is-active' : ''}`}
            onClick={() => setMode('business')}
          >
            Business URL Audit (10 OSS Tools)
          </button>
        </div>
      </header>

      {mode === 'suite' ? (
        <LiveAuditSuite initialUrl={targetUrl} onOpenSavedAudit={handleOpenSavedAudit} />
      ) : (
        <BusinessUrlAudit initialUrl={targetUrl} onOpenSavedAudit={handleOpenSavedAudit} />
      )}
    </div>
  )
}
