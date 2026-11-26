import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { LocalSavedAuditRecord, SavedAuditHistoryRecord } from '@/types/audit'

export type GlobalChartViewMode = 'cumulative' | 'average'

export interface GlobalCumulativePoint {
  index: number
  auditId: string
  repoFullName: string
  owner: string
  branch: string
  runPhase: 'static' | 'lhr'
  timestampMs: number
  shortDate: string
  perfBefore: number
  perfAfter: number
  perfLift: number
  a11yBefore: number
  a11yAfter: number
  a11yLift: number
  cumulativePerfLift: number
  cumulativeA11yLift: number
  rollingAvgPerfAfter: number
  rollingAvgA11yAfter: number
}

export interface GlobalRepoContribution {
  repoFullName: string
  runCount: number
  cumulativePerfLift: number
  cumulativeA11yLift: number
  totalLift: number
  latestPerfAfter: number
  latestA11yAfter: number
  latestRecord: SavedAuditHistoryRecord | LocalSavedAuditRecord
}

function toTimestampMs(rec: SavedAuditHistoryRecord | LocalSavedAuditRecord): number {
  const t = new Date(rec.updatedAtIso || rec.createdAtIso || 0).getTime()
  return Number.isFinite(t) ? t : 0
}

function clampScore(value: number | undefined | null): number {
  const num = Number(value ?? 0)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.min(100, Math.round(num)))
}

function extractOwner(rec: SavedAuditHistoryRecord | LocalSavedAuditRecord): string {
  const seg = (rec.repoFullName || '').split('/')[0]?.trim()
  return seg || 'local'
}

export function buildGlobalCumulativeTimeline(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  phaseFilter: 'all' | 'static' | 'lhr' = 'all',
): GlobalCumulativePoint[] {
  const filtered =
    phaseFilter === 'all' ? records : records.filter((rec) => rec.runPhase === phaseFilter)

  const chronological = [...filtered].sort((a, b) => {
    const diff = toTimestampMs(a) - toTimestampMs(b)
    return diff !== 0 ? diff : (a.auditId || '').localeCompare(b.auditId || '')
  })

  let cumulativePerfLift = 0
  let cumulativeA11yLift = 0
  let sumPerfAfter = 0
  let sumA11yAfter = 0

  return chronological.map((rec, idx) => {
    const index = idx + 1
    const ts = toTimestampMs(rec)
    const perfBefore = clampScore(rec.performanceBefore)
    const perfAfter = clampScore(rec.performanceAfter)
    const a11yBefore = clampScore(rec.accessibilityBefore)
    const a11yAfter = clampScore(rec.accessibilityAfter)
    const perfLift = Math.max(0, perfAfter - perfBefore)
    const a11yLift = Math.max(0, a11yAfter - a11yBefore)

    cumulativePerfLift += perfLift
    cumulativeA11yLift += a11yLift
    sumPerfAfter += perfAfter
    sumA11yAfter += a11yAfter

    const dateLabel = ts
      ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : `Run ${index}`

    return {
      index,
      auditId: rec.auditId,
      repoFullName: rec.repoFullName,
      owner: extractOwner(rec),
      branch: rec.branch || 'main',
      runPhase: rec.runPhase === 'lhr' ? 'lhr' : 'static',
      timestampMs: ts,
      shortDate: dateLabel,
      perfBefore,
      perfAfter,
      perfLift,
      a11yBefore,
      a11yAfter,
      a11yLift,
      cumulativePerfLift,
      cumulativeA11yLift,
      rollingAvgPerfAfter: Math.round(sumPerfAfter / index),
      rollingAvgA11yAfter: Math.round(sumA11yAfter / index),
    }
  })
}

export interface GlobalAuditDashboardProps {
  savedAudits: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
  onOpenSavedAudit?: (record: SavedAuditHistoryRecord | LocalSavedAuditRecord) => void
  onLoadSampleAudits?: () => void
  onExportAllJson?: () => void
  onExportAllCsv?: () => void
}

export function GlobalAuditDashboard({
  savedAudits,
  onOpenSavedAudit,
  onLoadSampleAudits,
  onExportAllJson,
  onExportAllCsv,
}: GlobalAuditDashboardProps) {
  const [viewMode, setViewMode] = useState<GlobalChartViewMode>('average')
  const [phaseFilter, setPhaseFilter] = useState<'all' | 'static' | 'lhr'>('all')

  const timeline = useMemo(
    () => buildGlobalCumulativeTimeline(savedAudits, phaseFilter),
    [savedAudits, phaseFilter],
  )

  const repoLeaderboard = useMemo<GlobalRepoContribution[]>(() => {
    const byRepo = new Map<string, GlobalRepoContribution>()
    for (const rec of savedAudits) {
      const key = (rec.repoFullName || 'owner/repo').trim().toLowerCase()
      const perfLift = Math.max(0, clampScore(rec.performanceAfter) - clampScore(rec.performanceBefore))
      const a11yLift = Math.max(
        0,
        clampScore(rec.accessibilityAfter) - clampScore(rec.accessibilityBefore),
      )
      const existing = byRepo.get(key)
      if (!existing) {
        byRepo.set(key, {
          repoFullName: rec.repoFullName,
          runCount: 1,
          cumulativePerfLift: perfLift,
          cumulativeA11yLift: a11yLift,
          totalLift: perfLift + a11yLift,
          latestPerfAfter: clampScore(rec.performanceAfter),
          latestA11yAfter: clampScore(rec.accessibilityAfter),
          latestRecord: rec,
        })
      } else {
        existing.runCount += 1
        existing.cumulativePerfLift += perfLift
        existing.cumulativeA11yLift += a11yLift
        existing.totalLift += perfLift + a11yLift
        if (toTimestampMs(rec) >= toTimestampMs(existing.latestRecord)) {
          existing.latestPerfAfter = clampScore(rec.performanceAfter)
          existing.latestA11yAfter = clampScore(rec.accessibilityAfter)
          existing.latestRecord = rec
        }
      }
    }
    return Array.from(byRepo.values()).sort((a, b) => b.totalLift - a.totalLift)
  }, [savedAudits])

  const kpis = useMemo(() => {
    const totalRuns = timeline.length
    const latest = timeline[totalRuns - 1]
    return {
      totalRuns,
      uniqueRepos: new Set(timeline.map((p) => p.repoFullName.toLowerCase())).size,
      cumulativePerfLift: latest?.cumulativePerfLift ?? 0,
      cumulativeA11yLift: latest?.cumulativeA11yLift ?? 0,
      fleetAvgPerf: latest?.rollingAvgPerfAfter ?? 0,
      fleetAvgA11y: latest?.rollingAvgA11yAfter ?? 0,
    }
  }, [timeline])

  const chartData = useMemo(
    () =>
      timeline.map((pt) => ({
        label: `#${pt.index} ${pt.shortDate}`,
        perf: viewMode === 'cumulative' ? pt.cumulativePerfLift : pt.rollingAvgPerfAfter,
        a11y: viewMode === 'cumulative' ? pt.cumulativeA11yLift : pt.rollingAvgA11yAfter,
      })),
    [timeline, viewMode],
  )

  return (
    <section className="fr-card" aria-labelledby="global-analytics-heading">
      <div className="fr-section-head">
        <div>
          <p className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> RECHARTS GLOBAL AUDIT ANALYTICS
          </p>
          <h2 id="global-analytics-heading" className="fr-section-title">
            Cross-Repository Improvement Trajectory
          </h2>
          <p className="fr-muted">
            Aggregate Lighthouse &amp; WCAG improvement metrics across all saved audits.
          </p>
        </div>

        <div className="fr-actions">
          {onLoadSampleAudits && (
            <button
              type="button"
              id="global-load-samples-btn"
              className="fr-btn-secondary"
              onClick={onLoadSampleAudits}
            >
              Load Sample Audits
            </button>
          )}
          {onExportAllJson && (
            <button
              type="button"
              className="fr-btn-secondary"
              disabled={savedAudits.length === 0}
              onClick={onExportAllJson}
            >
              Export JSON
            </button>
          )}
          {onExportAllCsv && (
            <button
              type="button"
              className="fr-btn-secondary"
              disabled={savedAudits.length === 0}
              onClick={onExportAllCsv}
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="fr-section-head">
        <div className="fr-segmented" role="group" aria-label="Global chart mode">
          <button
            type="button"
            className={`fr-segmented__btn${viewMode === 'average' ? ' is-active' : ''}`}
            onClick={() => setViewMode('average')}
          >
            Fleet Averages
          </button>
          <button
            type="button"
            className={`fr-segmented__btn${viewMode === 'cumulative' ? ' is-active' : ''}`}
            onClick={() => setViewMode('cumulative')}
          >
            Cumulative Score Lift
          </button>
        </div>

        <div className="fr-segmented" role="group" aria-label="Filter by phase">
          {(['all', 'static', 'lhr'] as const).map((phase) => (
            <button
              key={phase}
              type="button"
              className={`fr-segmented__btn${phaseFilter === phase ? ' is-active' : ''}`}
              onClick={() => setPhaseFilter(phase)}
            >
              {phase === 'all' ? 'All Phases' : phase.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="fr-kpi-strip">
        <div className="fr-kpi-cell">
          <span className="fr-muted">Evaluated Runs</span>
          <strong className="fr-kpi-cell__value">{kpis.totalRuns}</strong>
        </div>
        <div className="fr-kpi-cell">
          <span className="fr-muted">Repositories</span>
          <strong className="fr-kpi-cell__value">{kpis.uniqueRepos}</strong>
        </div>
        <div className="fr-kpi-cell">
          <span className="fr-muted">Fleet Avg Perf</span>
          <strong className="fr-kpi-cell__value">{kpis.fleetAvgPerf}</strong>
        </div>
        <div className="fr-kpi-cell">
          <span className="fr-muted">Cumulative Perf Lift</span>
          <strong className="fr-kpi-cell__value">+{kpis.cumulativePerfLift} pts</strong>
        </div>
      </div>

      {chartData.length === 0 ? (
        <p className="fr-muted">
          No audit runs match the active filters. Click Load Sample Audits or run an audit to plot
          global trajectories.
        </p>
      ) : (
        <div className="fr-radar-layout">
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height={280} minWidth={260} minHeight={240}>
              <AreaChart data={chartData}>
                <CartesianGrid stroke="var(--border-hairline)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid var(--border-card)',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area
                  type="monotone"
                  dataKey="perf"
                  name="Performance"
                  stroke="var(--cat-perf)"
                  fill="var(--cat-perf)"
                  fillOpacity={0.2}
                />
                <Area
                  type="monotone"
                  dataKey="a11y"
                  name="Accessibility"
                  stroke="var(--cat-a11y)"
                  fill="var(--cat-a11y)"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height={280} minWidth={240} minHeight={240}>
              <BarChart data={repoLeaderboard.slice(0, 6)}>
                <CartesianGrid stroke="var(--border-hairline)" strokeDasharray="3 3" />
                <XAxis dataKey="repoFullName" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid var(--border-card)',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="cumulativePerfLift" name="Perf Lift" fill="var(--cat-perf)" />
                <Bar dataKey="cumulativeA11yLift" name="A11y Lift" fill="var(--cat-a11y)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {repoLeaderboard.length > 0 && (
        <div className="fr-saved-list">
          <h3 className="fr-subsection-title">Repository Leaderboard ({repoLeaderboard.length})</h3>
          {repoLeaderboard.map((entry) => (
            <div key={entry.repoFullName} className="fr-saved-row">
              <div>
                <strong>{entry.repoFullName}</strong>{' '}
                <span className="fr-badge">{entry.runCount} runs</span>
                <div className="fr-muted">
                  Latest Perf: {entry.latestPerfAfter} · Latest A11y: {entry.latestA11yAfter} ·
                  Total Lift: +{entry.totalLift} pts
                </div>
              </div>
              {onOpenSavedAudit && (
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() => onOpenSavedAudit(entry.latestRecord)}
                >
                  Open Latest
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
