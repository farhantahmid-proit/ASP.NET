import { useState } from 'react'
import type { FresnelLore } from '@/types/audit'

export interface FresnelLogoProps {
  layout?: 'stacked' | 'horizontal'
  lore?: FresnelLore | null
  showLoreTrigger?: boolean
}

export function FresnelLogo({
  layout = 'stacked',
  lore = null,
  showLoreTrigger = false,
}: FresnelLogoProps) {
  const [loreOpen, setLoreOpen] = useState(false)
  const isHorizontal = layout === 'horizontal'

  return (
    <div className={`fresnel-identity${isHorizontal ? ' fresnel-identity--horizontal' : ''}`}>
      <div
        className={`brand-hover-target${isHorizontal ? ' brand-hover-target--horizontal' : ''}`}
      >
        <div className="logo-showcase" aria-hidden="true">
          <svg
            className="fresnel-hero-logo"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              className="fresnel-lighthouse-silhouette"
              fillRule="evenodd"
              clipRule="evenodd"
              d="M49.65 14.8C50.25 14.8 50.75 15.3 50.75 15.9V17.95C54.65 18.55 57.62 20.85 57.62 23.65C57.62 24.05 57.25 24.35 56.54 24.45V29.45C57.95 30.15 59.18 31.35 59.18 32.95C59.18 34.65 57.85 35.95 56.25 36.75L59.08 78.55H60.35V81.85H63.38V85.15H36.52V81.85H39.55V78.55H40.82L43.65 36.75C42.05 35.95 40.72 34.65 40.72 32.95C40.72 31.35 41.95 30.15 43.36 29.45V24.45C42.65 24.35 42.28 24.05 42.28 23.65C42.28 20.85 45.25 18.55 49.15 17.95V15.9C49.15 15.3 49.35 14.8 49.65 14.8ZM44.73 24.95V29.05H54.69V24.95H44.73Z"
              fill="currentColor"
            />
          </svg>
        </div>

        <span className="brand-display">Website Accessibility &amp; Performance Checker</span>

        {showLoreTrigger && lore && (
          <button
            type="button"
            className="fr-lore-trigger"
            aria-expanded={loreOpen}
            aria-controls="fresnel-lore-popover"
            onClick={() => setLoreOpen((open) => !open)}
          >
            Why Fresnel?
          </button>
        )}
      </div>

      {showLoreTrigger && lore && loreOpen && (
        <aside id="fresnel-lore-popover" className="fr-lore-popover" role="note">
          <div className="fr-lore-popover__head">
            <strong>
              {lore.name} ({lore.pronunciation})
            </strong>
            <span className="fr-badge">{lore.origin}</span>
          </div>
          <p className="fr-lore-popover__quote">&ldquo;{lore.quote}&rdquo;</p>
          <p className="fr-muted">{lore.explanation}</p>
        </aside>
      )}
    </div>
  )
}
