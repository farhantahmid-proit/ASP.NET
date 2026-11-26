import type { ExecutiveSummaryResult } from '@/types/audit'

export interface ExecutiveSummaryCardProps {
  summary: ExecutiveSummaryResult | null
  isLoading: boolean
  errorMessage: string | null
  onRegenerate: () => void
}

export function ExecutiveSummaryCard({
  summary,
  isLoading,
  errorMessage,
  onRegenerate,
}: ExecutiveSummaryCardProps) {
  return (
    <section
      id="ai-executive-summary-section"
      className="ai-exec-summary-card"
      aria-labelledby="ai-exec-summary-title"
    >
      <div className="ai-exec-summary-card__head">
        <div className="ai-exec-summary-card__heading-group">
          <span className="ai-exec-summary-card__badge">
            <svg
              viewBox="0 0 18 18"
              width={16}
              height={16}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path
                d="M9 2.2l1.6 4.2 4.2 1.6-4.2 1.6L9 13.8l-1.6-4.2L3.2 8l4.2-1.6L9 2.2z"
                strokeLinejoin="round"
              />
            </svg>
            <span>AI Executive Summary</span>
          </span>
          {summary?.model && (
            <span className="ai-exec-summary-card__model">{summary.model}</span>
          )}
        </div>

        <button
          type="button"
          id="ai-exec-summary-regenerate-btn"
          className="fr-btn-secondary"
          disabled={isLoading}
          onClick={onRegenerate}
          title="Regenerate AI Executive Summary from current selected audit improvements"
        >
          {isLoading ? 'Synthesizing...' : summary ? 'Regenerate' : 'Generate Summary'}
        </button>
      </div>

      {isLoading && !summary ? (
        <div className="ai-exec-summary-card__loading" role="status" aria-live="polite">
          <span className="sr-only">
            Generating AI Executive Summary for this audit report...
          </span>
          <div className="ai-exec-summary-skeleton ai-exec-summary-skeleton--title" />
          <div className="ai-exec-summary-skeleton ai-exec-summary-skeleton--line" />
          <div className="ai-exec-summary-skeleton ai-exec-summary-skeleton--line-short" />
        </div>
      ) : errorMessage ? (
        <div className="ai-exec-summary-card__error" role="alert">
          <div className="ai-exec-summary-card__error-copy">
            <strong>Executive Summary unavailable</strong>
            <p className="fr-muted">{errorMessage}</p>
          </div>
          <button
            type="button"
            id="ai-exec-summary-retry-btn"
            className="fr-btn-primary"
            onClick={onRegenerate}
          >
            Retry
          </button>
        </div>
      ) : summary ? (
        <>
          <h2 id="ai-exec-summary-title" className="ai-exec-summary-card__headline">
            {summary.headline}
          </h2>
          <p className="ai-exec-summary-card__body">{summary.summary}</p>

          {summary.topImprovements.length > 0 && (
            <div
              className="ai-exec-summary-card__highlights"
              aria-label="Most impactful audit improvements"
            >
              {summary.topImprovements.map((item) => (
                <article key={`${item.category}-${item.title}`} className="ai-exec-improvement-pill">
                  <span className="ai-exec-improvement-pill__cat">{item.category}</span>
                  <h3 className="ai-exec-improvement-pill__title">{item.title}</h3>
                  <p className="ai-exec-improvement-pill__impact">{item.impact}</p>
                </article>
              ))}
            </div>
          )}

          {summary.recommendedNextStep && (
            <div className="ai-exec-summary-card__next">
              <span className="ai-exec-summary-card__next-label">Next step</span>
              <span>{summary.recommendedNextStep}</span>
            </div>
          )}
        </>
      ) : (
        <p className="fr-muted">
          Synthesize an executive summary highlighting the highest-impact remediations from the
          selected commits.
        </p>
      )}
    </section>
  )
}
