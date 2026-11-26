import { useMemo, useState } from 'react'
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
import type { AuditImpactMetrics, LighthouseCategory } from '@/types/audit'

export interface ImpactRadarChartProps {
  metrics: AuditImpactMetrics
  selectedCount: number
  totalCount: number
  activeCategoryTab?: LighthouseCategory
}

type AxisMode = 'category' | 'detailed'

export function ImpactRadarChart({
  metrics,
  selectedCount,
  totalCount,
}: ImpactRadarChartProps) {
  const [axisMode, setAxisMode] = useState<AxisMode>('category')

  const axes = axisMode === 'detailed' ? metrics.detailedAxes : metrics.categoryAxes

  const chartData = useMemo(
    () =>
      axes.map((axis) => ({
        subject: axis.shortLabel,
        fullLabel: axis.label,
        before: axis.before,
        after: axis.after,
        delta: axis.delta,
        fullMark: 100,
      })),
    [axes],
  )

  const avgDelta = useMemo(() => {
    if (axes.length === 0) return 0
    return Math.round(axes.reduce((sum, a) => sum + a.delta, 0) / axes.length)
  }, [axes])

  return (
    <section className="fr-card fr-radar-card" aria-labelledby="fr-radar-heading">
      <div className="fr-section-head">
        <div>
          <div className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> RECHARTS IMPACT RADAR
          </div>
          <h2 id="fr-radar-heading" className="fr-section-title">
            Before vs. After Remediation Profile
          </h2>
          <p className="fr-muted">
            {selectedCount} of {totalCount} atomic fixes selected · Average gain{' '}
            <strong>+{avgDelta} pts</strong>
          </p>
        </div>

        <div className="fr-segmented" role="group" aria-label="Radar axis mode">
          <button
            type="button"
            className={`fr-segmented__btn${axisMode === 'category' ? ' is-active' : ''}`}
            aria-pressed={axisMode === 'category'}
            onClick={() => setAxisMode('category')}
          >
            Categories ({metrics.categoryAxes.length})
          </button>
          <button
            type="button"
            className={`fr-segmented__btn${axisMode === 'detailed' ? ' is-active' : ''}`}
            aria-pressed={axisMode === 'detailed'}
            onClick={() => setAxisMode('detailed')}
          >
            Web Vitals &amp; WCAG ({metrics.detailedAxes.length})
          </button>
        </div>
      </div>

      <div className="fr-radar-layout">
        <div className="fr-radar-chart-box">
          <ResponsiveContainer width="100%" height={320} minWidth={260} minHeight={260}>
            <RadarChart cx="50%" cy="50%" outerRadius="72%" data={chartData}>
              <PolarGrid stroke="var(--border-card)" strokeDasharray="3 3" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: 'var(--text-main)', fontSize: 12, fontWeight: 600 }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tickCount={5}
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              />
              <Radar
                name="Baseline (Before)"
                dataKey="before"
                stroke="#94a3b8"
                strokeWidth={1.8}
                strokeDasharray="4 4"
                fill="#94a3b8"
                fillOpacity={0.18}
              />
              <Radar
                name="After Selected Fixes"
                dataKey="after"
                stroke="var(--accent-primary)"
                strokeWidth={2.5}
                fill="var(--accent-primary)"
                fillOpacity={0.28}
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

        <div className="fr-radar-axes-list">
          {axes.map((axis) => (
            <div key={axis.id} className="fr-axis-row">
              <div className="fr-axis-row__top">
                <span className="fr-axis-row__label">{axis.label}</span>
                <span className="fr-badge">+{axis.delta} pts</span>
              </div>
              <div className="fr-axis-row__scores">
                <span>
                  {axis.before} {'->'} <strong>{axis.after}</strong> / 100
                </span>
                <span className="fr-muted">{axis.contributingCommits} commits</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
