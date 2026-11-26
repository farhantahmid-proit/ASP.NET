import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WIDGET_SYSTEM_PROMPT,
  applyMissingHardeningPatches,
  evaluateSystemPromptSecurity,
  runSocialFootprintAnalysis,
} from './security-engines'

describe('security-engines (OWASP LLM & Brand OSINT)', () => {
  it('flags missing OWASP LLM guardrails on default prompt and hardens score after patching', () => {
    const before = evaluateSystemPromptSecurity(
      DEFAULT_WIDGET_SYSTEM_PROMPT,
      'Demo Bot',
      'proj_1',
    )
    expect(before.overallResilienceScore).toBeLessThan(65)
    expect(before.probes.some((p) => p.status !== 'SAFE')).toBe(true)

    const hardenedPrompt = applyMissingHardeningPatches(DEFAULT_WIDGET_SYSTEM_PROMPT, before)
    const after = evaluateSystemPromptSecurity(hardenedPrompt, 'Demo Bot', 'proj_1')
    expect(after.overallResilienceScore).toBeGreaterThan(90)
    expect(after.probes.every((p) => p.status === 'SAFE')).toBe(true)
  })

  it('synthesizes multi-platform brand handle permutations deterministically', () => {
    const report = runSocialFootprintAnalysis('Acme Corp', 'acme.example', 'proj_1')
    expect(report.permutationsChecked.length).toBeGreaterThanOrEqual(3)
    expect(report.matches.length).toBe(10)
    expect(report.coverageScore).toBeGreaterThanOrEqual(0)
  })
})
