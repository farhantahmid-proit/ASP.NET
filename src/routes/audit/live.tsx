import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { BusinessUrlAudit } from '@/components/live-audit/BusinessUrlAudit'
import { LiveAuditSuite } from '@/components/live-audit/LiveAuditSuite'
import { AllInOneSiteAuditPanel } from '@/components/site-audit/AllInOneSiteAuditPanel'
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
  const [mode, setMode] = useState<'all-in-one' | 'suite' | 'business'>('all-in-one')

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
          <h1 className="fr-audit-title">All-in-One Site Audit &amp; Live Suite</h1>
          <p className="fr-muted">
            Run SSRF-safe DNS, TLS, Security Headers, SiteOne Crawl, Threat Intel, Prompt
            Security, PageSpeed Insights, and DOM <code>axe-core</code> checks.
            {source ? ` (Launched via ${source})` : ''}
          </p>
        </div>

        <div className="fr-segmented" role="tablist" aria-label="Live audit mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'all-in-one'}
            className={`fr-segmented__btn${mode === 'all-in-one' ? ' is-active' : ''}`}
            onClick={() => setMode('all-in-one')}
          >
            All-in-One Site Audit
          </button>
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

      {mode === 'all-in-one' ? (
        <AllInOneSiteAuditPanel
          initialUrl={targetUrl}
          source={source || 'web'}
          onOpenSavedAudit={handleOpenSavedAudit}
        />
      ) : mode === 'suite' ? (
        <LiveAuditSuite initialUrl={targetUrl} onOpenSavedAudit={handleOpenSavedAudit} />
      ) : (
        <BusinessUrlAudit initialUrl={targetUrl} onOpenSavedAudit={handleOpenSavedAudit} />
      )}
    </div>
  )
}
