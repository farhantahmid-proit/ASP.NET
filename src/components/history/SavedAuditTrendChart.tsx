import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { LocalSavedAuditRecord, SavedAuditHistoryRecord } from '@/types/audit'

export interface RepositoryTrendPoint {
  auditId: string
  runIndex: number
  timestampMs: number
  shortDate: string
  fullDate: string
  branch: string
  runPhase: 'static' | 'lhr'
  performanceBefore: number
  performanceAfter: number
  accessibilityBefore: number
  accessibilityAfter: number
  perfDeltaFromPrev: number | null
  a11yDeltaFromPrev: number | null
}

export interface TrendRepositoryOption {
  repoFullName: string
  runCount: number
  latestTimestampMs: number
}

function toTimestampMs(rec: SavedAuditHistoryRecord | LocalSavedAuditRecord): number {
  const t = new Date(rec.updatedAtIso || rec.createdAtIso || 0).getTime()
  return Number.isFinite(t) ? t : 0
}

function formatShortRunDate(ms: number, runIndex: number): string {
  if (!ms) return `Run ${runIndex}`
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return `Run ${runIndex}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatFullRunDate(ms: number): string {
  if (!ms) return 'Recent run'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return 'Recent run'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function listTrendRepositories(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
): TrendRepositoryOption[] {
  const byRepo = new Map<string, TrendRepositoryOption>()
  for (const rec of records) {
    const repoName = (rec.repoFullName || '').trim()
    if (!repoName) continue
    const key = repoName.toLowerCase()
    const ts = toTimestampMs(rec)
    const existing = byRepo.get(key)
    if (!existing) {
      byRepo.set(key, {
        repoFullName: repoName,
        runCount: 1,
        latestTimestampMs: ts,
      })
    } else {
      existing.runCount += 1
      if (ts > existing.latestTimestampMs) {
        existing.latestTimestampMs = ts
      }
    }
  }

  return Array.from(byRepo.values()).sort((a, b) => {
    if (b.runCount !== a.runCount) return b.runCount - a.runCount
    return b.latestTimestampMs - a.latestTimestampMs
  })
}

export function buildRepositoryTrendSeries(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  repoFullName: string,
  scoreMode: 'after' | 'before' = 'after',
): RepositoryTrendPoint[] {
  const target = (repoFullName || '').trim().toLowerCase()
  if (!target) return []

  const matched = records
    .filter((rec) => (rec.repoFullName || '').trim().toLowerCase() === target)
    .sort((a, b) => toTimestampMs(a) - toTimestampMs(b))

  return matched.map((rec, idx) => {
    const ts = toTimestampMs(rec)
    const runIndex = idx + 1
    const performanceBefore = Math.max(0, Math.min(100, Math.round(rec.performanceBefore || 0)))
    const performanceAfter = Math.max(0, Math.min(100, Math.round(rec.performanceAfter || 0)))
    const accessibilityBefore = Math.max(0, Math.min(100, Math.round(rec.accessibilityBefore || 0)))
    const accessibilityAfter = Math.max(0, Math.min(100, Math.round(rec.accessibilityAfter || 0)))

    let perfDeltaFromPrev: number | null = null
    let a11yDeltaFromPrev: number | null = null
    if (idx > 0) {
      const prev = matched[idx - 1]
      const prevPerf =
        scoreMode === 'after'
          ? Math.max(0, Math.min(100, Math.round(prev.performanceAfter || 0)))
          : Math.max(0, Math.min(100, Math.round(prev.performanceBefore || 0)))
      const prevA11y =
        scoreMode === 'after'
          ? Math.max(0, Math.min(100, Math.round(prev.accessibilityAfter || 0)))
          : Math.max(0, Math.min(100, Math.round(prev.accessibilityBefore || 0)))
      perfDeltaFromPrev = (scoreMode === 'after' ? performanceAfter : performanceBefore) - prevPerf
      a11yDeltaFromPrev =
        (scoreMode === 'after' ? accessibilityAfter : accessibilityBefore) - prevA11y
    }

    return {
      auditId: rec.auditId,
      runIndex,
      timestampMs: ts,
      shortDate: formatShortRunDate(ts, runIndex),
      fullDate: formatFullRunDate(ts),
      branch: rec.branch || 'main',
      runPhase: rec.runPhase === 'lhr' ? 'lhr' : 'static',
      performanceBefore,
      performanceAfter,
      accessibilityBefore,
      accessibilityAfter,
      perfDeltaFromPrev,
      a11yDeltaFromPrev,
    }
  })
}

export interface SavedAuditTrendChartProps {
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
  focusedRepo?: string | null
}

export function SavedAuditTrendChart({ records, focusedRepo }: SavedAuditTrendChartProps) {
  const repos = useMemo(() => listTrendRepositories(records), [records])
  const [selectedRepo, setSelectedRepo] = useState<string>(
    () => focusedRepo || repos[0]?.repoFullName || '',
  )
  const [scoreMode, setScoreMode] = useState<'after' | 'before'>('after')

  useEffect(() => {
    if (focusedRepo && repos.some((r) => r.repoFullName === focusedRepo)) {
      setSelectedRepo(focusedRepo)
    } else if (!repos.some((r) => r.repoFullName === selectedRepo)) {
      setSelectedRepo(repos[0]?.repoFullName ?? '')
    }
  }, [focusedRepo, repos, selectedRepo])

  const series = useMemo(
    () => buildRepositoryTrendSeries(records, selectedRepo, scoreMode),
    [records, selectedRepo, scoreMode],
  )

  const chartData = useMemo(
    () =>
      series.map((pt) => ({
        name: `R${pt.runIndex} · ${pt.shortDate}`,
        performance: scoreMode === 'after' ? pt.performanceAfter : pt.performanceBefore,
        accessibility: scoreMode === 'after' ? pt.accessibilityAfter : pt.accessibilityBefore,
      })),
    [series, scoreMode],
  )

  return (
    <section className="fr-card" aria-labelledby="fr-trend-heading">
      <div className="fr-section-head">
        <div>
          <p className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> RECHARTS SCORE TREND
          </p>
          <h2 id="fr-trend-heading" className="fr-section-title">
            Repository Score Trend ({series.length} runs)
          </h2>
        </div>

        <div className="fr-actions">
          <div className="fr-segmented" role="group" aria-label="Trend score mode">
            <button
              type="button"
              className={`fr-segmented__btn${scoreMode === 'after' ? ' is-active' : ''}`}
              onClick={() => setScoreMode('after')}
            >
              After Fixes
            </button>
            <button
              type="button"
              className={`fr-segmented__btn${scoreMode === 'before' ? ' is-active' : ''}`}
              onClick={() => setScoreMode('before')}
            >
              Baseline Before
            </button>
          </div>
        </div>
      </div>

      {repos.length > 0 && (
        <label className="fr-select-field">
          <span className="fr-label">Repository</span>
          <select
            className="fr-input"
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
          >
            {repos.map((opt) => (
              <option key={opt.repoFullName} value={opt.repoFullName}>
                {opt.repoFullName} ({opt.runCount} run{opt.runCount === 1 ? '' : 's'})
              </option>
            ))}
          </select>
        </label>
      )}

      {chartData.length === 0 ? (
        <p className="fr-muted">Save at least one audit run to plot historical score trends.</p>
      ) : (
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer width="100%" height={280} minWidth={260} minHeight={240}>
            <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border-hairline)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
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
                dataKey="performance"
                name="Performance"
                stroke="var(--cat-perf)"
                fill="var(--cat-perf)"
                fillOpacity={0.2}
                strokeWidth={2.2}
              />
              <Area
                type="monotone"
                dataKey="accessibility"
                name="Accessibility"
                stroke="var(--cat-a11y)"
                fill="var(--cat-a11y)"
                fillOpacity={0.18}
                strokeWidth={2.2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
