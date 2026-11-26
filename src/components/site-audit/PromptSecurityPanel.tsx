import { useMemo, useState } from 'react'
import { RadialScoreGauge } from '@/components/ui/RadialScoreGauge'
import {
  DEFAULT_WIDGET_SYSTEM_PROMPT,
  applyMissingHardeningPatches,
  evaluateSystemPromptSecurity,
} from '@/lib/security-engines'

export interface PromptSecurityPanelProps {
  targetLabel?: string
}

export function PromptSecurityPanel({ targetLabel = 'Embedded Site Assistant' }: PromptSecurityPanelProps) {
  const [promptText, setPromptText] = useState(DEFAULT_WIDGET_SYSTEM_PROMPT)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const report = useMemo(
    () => evaluateSystemPromptSecurity(promptText, targetLabel, 'fresnel-site-audit'),
    [promptText, targetLabel],
  )

  async function handleCopy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800)
    } catch {
      // Ignore clipboard failures in restricted frames
    }
  }

  function handleApplyAllPatches() {
    setPromptText((prev) => applyMissingHardeningPatches(prev, report))
  }

  return (
    <section className="fr-card">
      <div className="fr-card-head">
        <div>
          <h3>Embedded AI Chatbot Prompt Security Scanner</h3>
          <p className="fr-muted">
            Deterministic OWASP LLM01 / LLM02 / LLM06 / LLM07 analyzer inspecting widget or agent
            system prompts (100% client-side MIT engine).
          </p>
        </div>
        <RadialScoreGauge
          score={report.overallResilienceScore}
          size={84}
          strokeWidth={7}
          label="Resilience"
          category="security"
        />
      </div>

      <div className="fr-subblock">
        <label className="fr-label" htmlFor="prompt-security-input">
          System Prompt under Audit
        </label>
        <textarea
          id="prompt-security-input"
          className="fr-input fr-textarea"
          rows={5}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
        />
        <div className="fr-chip-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="fr-btn fr-btn--primary"
            disabled={report.probes.every((p) => p.status === 'SAFE')}
            onClick={handleApplyAllPatches}
          >
            Append Missing Hardening Patches
          </button>
          <button
            type="button"
            className="fr-btn fr-btn--secondary"
            onClick={() => setPromptText(DEFAULT_WIDGET_SYSTEM_PROMPT)}
          >
            Reset to Vulnerable Sample
          </button>
        </div>
      </div>

      <ul className="fr-violation-list" style={{ marginTop: 16 }}>
        {report.probes.map((probe) => (
          <li key={probe.id} className="fr-violation-item">
            <div className="fr-card-head">
              <div>
                <strong>{probe.label}</strong>{' '}
                <span className="fr-badge">{probe.owaspLlmCode}</span>
              </div>
              <span
                className={
                  probe.status === 'SAFE'
                    ? 'fr-pill-ok'
                    : probe.status === 'PARTIAL_LEAK'
                      ? 'fr-pill-warn'
                      : 'fr-pill-bad'
                }
              >
                {probe.status} ({probe.resilienceScore}/100)
              </span>
            </div>
            <p className="fr-muted" style={{ margin: '6px 0' }}>
              {probe.observedBehavior}
            </p>
            <div className="fr-patch-box">
              <code className="fr-mono">{probe.hardeningPatch}</code>
              <button
                type="button"
                className="fr-btn fr-btn--secondary"
                onClick={() => void handleCopy(probe.hardeningPatch, probe.id)}
              >
                {copiedId === probe.id ? 'Copied' : 'Copy Patch'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
