import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { useLocalAuditStorage } from '@/hooks/useLocalAuditStorage'
import { auditResultCache } from '@/lib/services/audit-result-cache'
import type {
  CachedRepositoryAuditEntry,
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord,
} from '@/types/audit'
import { computeAuditImpactMetrics } from '@/utils/audit-impact.util'

export interface AuditOverviewPanelProps {
  onOpenAuditSession: (auditId: string) => void
  onOpenSavedRecord?: (record: LocalSavedAuditRecord) => void
}

function computeOverviewSummary(records: readonly SavedAuditHistoryRecord[]) {
  if (records.length === 0) {
    return {
      totalRuns: 0,
      uniqueRepos: 0,
      avgPerfLift: 0,
      avgA11yLift: 0,
      totalCommitsSelected: 0,
    }
  }
  const repos = new Set(
    records.map((r) => (r.repoFullName || '').trim().toLowerCase()).filter(Boolean),
  )
  const perfSum = records.reduce(
    (s, r) => s + Math.max(0, (r.performanceAfter || 0) - (r.performanceBefore || 0)),
    0,
  )
  const a11ySum = records.reduce(
    (s, r) => s + Math.max(0, (r.accessibilityAfter || 0) - (r.accessibilityBefore || 0)),
    0,
  )
  const commitsSum = records.reduce(
    (s, r) => s + Math.max(0, r.selectedCommitsCount || 0),
    0,
  )
  return {
    totalRuns: records.length,
    uniqueRepos: repos.size,
    avgPerfLift: Math.round(perfSum / records.length),
    avgA11yLift: Math.round(a11ySum / records.length),
    totalCommitsSelected: commitsSum,
  }
}

export function AuditOverviewPanel({
  onOpenAuditSession,
  onOpenSavedRecord,
}: AuditOverviewPanelProps) {
  const { localAudits, service, deleteLocalAudit, saveSessionLocally } = useLocalAuditStorage()
  const cachedAudits: CachedRepositoryAuditEntry[] = auditResultCache.cachedAudits()

  const summary = useMemo(() => computeOverviewSummary(localAudits), [localAudits])

  const categoryBreakdown = useMemo(() => {
    if (localAudits.length === 0) return []
    const totals = {
      Performance: 0,
      Accessibility: 0,
      'Best Practices': 0,
      SEO: 0,
      Security: 0,
    }
    for (const rec of localAudits) {
      totals.Performance += Math.max(1, rec.performanceAfter - rec.performanceBefore)
      totals.Accessibility += Math.max(1, rec.accessibilityAfter - rec.accessibilityBefore)
      totals['Best Practices'] += Math.max(1, rec.bestPracticesAfter - rec.bestPracticesBefore)
      totals.SEO += Math.max(1, rec.seoAfter - rec.seoBefore)
      totals.Security += Math.max(1, rec.securityAfter - rec.securityBefore)
    }
    const colors = [
      'var(--cat-perf)',
      'var(--cat-a11y)',
      'var(--cat-bp)',
      'var(--cat-seo)',
      'var(--cat-sec)',
    ]
    return Object.entries(totals).map(([name, value], index) => ({
      name,
      value,
      color: colors[index],
    }))
  }, [localAudits])

  function handleResumeCached(entry: CachedRepositoryAuditEntry) {
    if (entry.session) {
      const allIds = entry.session.commits.map((c) => c.id)
      saveSessionLocally(
        entry.session,
        computeAuditImpactMetrics(entry.session, allIds),
        entry.session.commits,
        'json',
      )
    }
    onOpenAuditSession(entry.auditId)
  }

  return (
    <section className="fr-card fr-overview-panel" aria-labelledby="fr-overview-heading">
      <div className="fr-section-head">
        <div>
          <div className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> WORKSPACE AUDIT TELEMETRY
          </div>
          <h2 id="fr-overview-heading" className="fr-section-title">
            Saved &amp; Cached Audits
          </h2>
          <p className="fr-muted">
            Offline-capable IndexedDB + localStorage history with JSON and CSV export.
          </p>
        </div>

        <div className="fr-actions">
          <button
            type="button"
            className="fr-btn-secondary"
            onClick={() => service.loadSampleAudits()}
          >
            Load Sample Audits
          </button>
          <button
            type="button"
            className="fr-btn-secondary"
            disabled={localAudits.length === 0}
            onClick={() => void service.exportFullHistoryToDeviceJson()}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="fr-btn-secondary"
            disabled={localAudits.length === 0}
            onClick={() => void service.exportFullHistoryToDeviceCsv()}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="fr-kpi-strip" role="region" aria-label="Past audit summary metrics">
        <div className="fr-kpi-cell">
          <span className="fr-muted">Saved Runs</span>
          <strong className="fr-kpi-cell__value">{summary.totalRuns}</strong>
        </div>
        <div className="fr-kpi-cell">
          <span className="fr-muted">Repositories</span>
          <strong className="fr-kpi-cell__value">{summary.uniqueRepos}</strong>
        </div>
        <div className="fr-kpi-cell">
          <span className="fr-muted">Avg Perf Lift</span>
          <strong className="fr-kpi-cell__value">+{summary.avgPerfLift} pts</strong>
        </div>
        <div className="fr-kpi-cell">
          <span className="fr-muted">Avg A11y Lift</span>
          <strong className="fr-kpi-cell__value">+{summary.avgA11yLift} pts</strong>
        </div>
      </div>

      {categoryBreakdown.length > 0 && (
        <div className="fr-overview-chart">
          <h3 className="fr-subsection-title">Score Lift Distribution by Category</h3>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height={220} minWidth={240} minHeight={200}>
              <PieChart>
                <Pie
                  data={categoryBreakdown}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={3}
                >
                  {categoryBreakdown.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid var(--border-card)',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {cachedAudits.length > 0 && (
        <div className="fr-saved-list">
          <h3 className="fr-subsection-title">Recent Session Cache ({cachedAudits.length})</h3>
          {cachedAudits.map((entry) => (
            <div key={entry.cacheKey} className="fr-saved-row">
              <div>
                <strong>{entry.repoFullName}</strong>
                <div className="fr-muted">
                  Branch: <code>{entry.branch}</code> · {entry.runPhase.toUpperCase()} ·{' '}
                  {entry.totalCommitsCount} commits
                </div>
              </div>
              <div className="fr-actions">
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() => handleResumeCached(entry)}
                >
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {localAudits.length === 0 ? (
        <p className="fr-muted">
          No locally saved audits yet. Run a Sandbox Demo, live repo audit, or in-browser AST
          scan to populate your workspace history.
        </p>
      ) : (
        <div className="fr-saved-list">
          <h3 className="fr-subsection-title">Local Saved Audits ({localAudits.length})</h3>
          {localAudits.map((rec) => (
            <div key={rec.auditId} className="fr-saved-row">
              <div>
                <strong>{rec.repoFullName}</strong>{' '}
                <span className="fr-badge">{rec.savedFormat}</span>
                <div className="fr-muted">
                  Perf {rec.performanceBefore} {'->'} {rec.performanceAfter} · A11y{' '}
                  {rec.accessibilityBefore} {'->'} {rec.accessibilityAfter} ·{' '}
                  {rec.selectedCommitsCount}/{rec.totalCommitsCount} commits
                </div>
              </div>
              <div className="fr-actions">
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() =>
                    onOpenSavedRecord ? onOpenSavedRecord(rec) : onOpenAuditSession(rec.auditId)
                  }
                >
                  Open
                </button>
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() => deleteLocalAudit(rec.auditId)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
