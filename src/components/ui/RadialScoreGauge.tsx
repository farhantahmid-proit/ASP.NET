import type { LighthouseCategory } from '@/types/audit'

export interface RadialScoreGaugeProps {
  score: number
  beforeScore?: number
  size?: number
  strokeWidth?: number
  label: string
  sublabel?: string
  category?: Exclude<LighthouseCategory, 'all'>
}

const CATEGORY_COLOR_MAP: Record<Exclude<LighthouseCategory, 'all'>, string> = {
  performance: 'var(--cat-perf)',
  accessibility: 'var(--cat-a11y)',
  'best-practices': 'var(--cat-bp)',
  seo: 'var(--cat-seo)',
  security: 'var(--cat-sec)',
}

export function RadialScoreGauge({
  score,
  beforeScore,
  size = 112,
  strokeWidth = 9,
  label,
  sublabel,
  category,
}: RadialScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (clamped / 100) * circumference
  const stroke = category ? CATEGORY_COLOR_MAP[category] : 'var(--accent-primary)'
  const delta =
    typeof beforeScore === 'number' ? clamped - Math.round(beforeScore) : null

  return (
    <div
      className="fr-radial-gauge"
      role="img"
      aria-label={`${label}: ${clamped} out of 100${delta !== null ? ` (${delta >= 0 ? '+' : ''}${delta})` : ''}`}
    >
      <div className="fr-radial-gauge__ring" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="fr-radial-gauge__svg"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border-hairline)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="fr-radial-gauge__center">
          <span className="fr-radial-gauge__score">{clamped}</span>
          <span className="fr-radial-gauge__denom">/ 100</span>
        </div>
      </div>

      <div className="fr-radial-gauge__meta">
        <p className="fr-radial-gauge__label">{label}</p>
        {delta !== null && (
          <p className="fr-radial-gauge__delta">
            {beforeScore} {'->'} {clamped} ({delta >= 0 ? '+' : ''}
            {delta})
          </p>
        )}
        {sublabel && <p className="fr-radial-gauge__sublabel">{sublabel}</p>}
      </div>
    </div>
  )
}
