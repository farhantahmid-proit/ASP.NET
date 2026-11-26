import { useEffect, useMemo, useState } from 'react'
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import type { AuditImpactMetrics, AuditSession, SavedAuditHistoryRecord } from '@/types/audit'
import {
  buildComparableRunsFromSession,
  buildMetricComparisonRows,
} from '@/utils/audit-impact.util'
import { buildRadarComparisonDeltaPdf } from '@/utils/comparison-pdf.util'

export interface AuditRunComparisonProps {
  currentSession: AuditSession
  currentMetrics: AuditImpactMetrics
  selectedCommitsCount: number
  totalCommitsCount: number
  savedAudits?: readonly SavedAuditHistoryRecord[]
  defaultExpanded?: boolean
}

export function AuditRunComparison({
  currentSession,
  currentMetrics,
  selectedCommitsCount,
  totalCommitsCount,
  savedAudits = [],
  defaultExpanded = false,
}: AuditRunComparisonProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const availableRuns = useMemo(
    () =>
      buildComparableRunsFromSession(
        currentSession,
        currentMetrics,
        selectedCommitsCount,
        totalCommitsCount,
        savedAudits,
      ),
    [currentSession, currentMetrics, selectedCommitsCount, totalCommitsCount, savedAudits],
  )

  const [selectedRunAId, setSelectedRunAId] = useState<string>(
    () => availableRuns[0]?.id ?? 'initial-scan-baseline',
  )
  const [selectedRunBId, setSelectedRunBId] = useState<string>(
    () => availableRuns[1]?.id ?? availableRuns[0]?.id ?? '',
  )

  useEffect(() => {
    if (availableRuns.length === 0) return
    if (!availableRuns.some((r) => r.id === selectedRunAId)) {
      setSelectedRunAId(availableRuns[0].id)
    }
    if (!availableRuns.some((r) => r.id === selectedRunBId)) {
      setSelectedRunBId((availableRuns[1] ?? availableRuns[0]).id)
    }
  }, [availableRuns, selectedRunAId, selectedRunBId])

  const runA = useMemo(
    () => availableRuns.find((r) => r.id === selectedRunAId) ?? availableRuns[0] ?? null,
    [availableRuns, selectedRunAId],
  )

  const runB = useMemo(
    () =>
      availableRuns.find((r) => r.id === selectedRunBId) ??
      availableRuns[1] ??
      availableRuns[0] ??
      null,
    [availableRuns, selectedRunBId],
  )

  const comparisonRows = useMemo(() => buildMetricComparisonRows(runA, runB), [runA, runB])

  const radarData = useMemo(
    () =>
      comparisonRows.map((row) => ({
        subject: row.shortLabel,
        baseline: row.runABefore,
        runAAfter: row.runAAfter,
        runBAfter: row.runBAfter,
      })),
    [comparisonRows],
  )

  function handleExportPdf() {
    if (!runA || !runB || comparisonRows.length === 0) return
    const payload = buildRadarComparisonDeltaPdf(runA, runB, comparisonRows)
    const blob = new Blob([payload.bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = payload.filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="fr-card fr-comparison-card" aria-labelledby="fr-comparison-heading">
      <div className="fr-section-head">
        <div>
          <div className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> CROSS-RUN DELTA COMPARISON
          </div>
          <h2 id="fr-comparison-heading" className="fr-section-title">
            Audit Run Comparison ({availableRuns.length} runs available)
          </h2>
          <p className="fr-muted">
            Overlay any two runs across 8 Lighthouse &amp; WCAG metrics and export a vector PDF.
          </p>
        </div>

        <div className="fr-actions">
          <button
            type="button"
            id="comparison-export-pdf-btn"
            className="fr-btn-secondary"
            disabled={!runA || !runB || comparisonRows.length === 0}
            onClick={handleExportPdf}
          >
            Export Radar Delta PDF
          </button>
          <button
            type="button"
            className="fr-btn-secondary"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((v) => !v)}
          >
            {isExpanded ? 'Collapse Matrix' : 'Expand Comparison'}
          </button>
        </div>
      </div>

      {isExpanded && runA && runB && (
        <div className="fr-comparison-body">
          <div className="fr-comparison-selectors">
            <label className="fr-select-field">
              <span className="fr-label">Run A (Reference)</span>
              <select
                className="fr-input"
                value={runA.id}
                onChange={(e) => setSelectedRunAId(e.target.value)}
              >
                {availableRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="fr-select-field">
              <span className="fr-label">Run B (Target)</span>
              <select
                className="fr-input"
                value={runB.id}
                onChange={(e) => setSelectedRunBId(e.target.value)}
              >
                {availableRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="fr-radar-layout">
            <div className="fr-radar-chart-box">
              <ResponsiveContainer width="100%" height={300} minWidth={260} minHeight={260}>
                <RadarChart cx="50%" cy="50%" outerRadius="72%" data={radarData}>
                  <PolarGrid stroke="var(--border-card)" strokeDasharray="3 3" />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fill: 'var(--text-main)', fontSize: 11, fontWeight: 600 }}
                  />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 100]}
                    tickCount={5}
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  />
                  <Radar
                    name="Unpatched Baseline"
                    dataKey="baseline"
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    fill="#94a3b8"
                    fillOpacity={0.12}
                  />
                  <Radar
                    name={`Run A: ${runA.badge}`}
                    dataKey="runAAfter"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    fill="#0ea5e9"
                    fillOpacity={0.2}
                  />
                  <Radar
                    name={`Run B: ${runB.badge}`}
                    dataKey="runBAfter"
                    stroke="var(--accent-primary)"
                    strokeWidth={2.5}
                    fill="var(--accent-primary)"
                    fillOpacity={0.25}
                  />
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
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="fr-table-scroll">
              <table className="fr-comparison-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Baseline</th>
                    <th>Run A</th>
                    <th>Run B</th>
                    <th>Delta (B - A)</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.label}</td>
                      <td>{row.runABefore}</td>
                      <td>{row.runAAfter}</td>
                      <td>
                        <strong>{row.runBAfter}</strong>
                      </td>
                      <td>
                        <span className="fr-badge">
                          {row.afterDiff >= 0 ? '+' : ''}
                          {row.afterDiff}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
