import { describe, expect, it } from 'vitest'
import type { ComparableAuditRun, MetricComparisonRow } from '@/types/comparison'
import { buildRadarComparisonDeltaPdf } from './comparison-pdf.util'

describe('comparison-pdf.util', () => {
  const baseRunA: ComparableAuditRun = {
    id: 'run-initial',
    label: 'Initial Scan (Run 1)',
    badge: 'Run 1',
    significanceTag: 'Initial Scan',
    sourceType: 'initial-baseline',
    repoFullName: 'fresnel-sandbox/lumina-web-app',
    runPhase: 'static',
    timestampIso: '2026-10-01T10:00:00.000Z',
    timestampLabel: 'Oct 1, 2026',
    selectedCommitsCount: 8,
    totalCommitsCount: 16,
    performanceBefore: 60,
    performanceAfter: 82,
    accessibilityBefore: 68,
    accessibilityAfter: 88,
    bestPracticesBefore: 74,
    bestPracticesAfter: 90,
    seoBefore: 78,
    seoAfter: 92,
    lcpBefore: 56,
    lcpAfter: 84,
    clsBefore: 62,
    clsAfter: 88,
    fidBefore: 61,
    fidAfter: 85,
    wcagAriaBefore: 66,
    wcagAriaAfter: 89,
    summaryNotes: 'Initial static audit baseline.',
  }

  const baseRunB: ComparableAuditRun = {
    ...baseRunA,
    id: 'run-optimized',
    label: 'Latest Optimized (Run 2)',
    badge: 'Run 2',
    significanceTag: 'Latest Optimized',
    sourceType: 'current',
    runPhase: 'lhr',
    timestampIso: '2026-10-15T14:30:00.000Z',
    timestampLabel: 'Oct 15, 2026',
    selectedCommitsCount: 16,
    performanceAfter: 96,
    accessibilityAfter: 98,
    bestPracticesAfter: 96,
    seoAfter: 98,
    lcpAfter: 96,
    clsAfter: 98,
    fidAfter: 95,
    wcagAriaAfter: 98,
    summaryNotes: 'Post-optimization run with LHR verification.',
  }

  const rows: MetricComparisonRow[] = [
    {
      id: 'performance',
      label: 'Performance Score',
      shortLabel: 'Perf',
      category: 'performance',
      runABefore: 60,
      runAAfter: 82,
      runAGain: 22,
      runBBefore: 60,
      runBAfter: 96,
      runBGain: 36,
      afterDiff: 14,
      gainDiff: 14,
    },
    {
      id: 'accessibility',
      label: 'Accessibility Score',
      shortLabel: 'A11y',
      category: 'accessibility',
      runABefore: 68,
      runAAfter: 88,
      runAGain: 20,
      runBBefore: 68,
      runBAfter: 98,
      runBGain: 30,
      afterDiff: 10,
      gainDiff: 10,
    },
  ]

  it('generates a valid PDF 1.4 binary buffer with deterministic filename and trailer', () => {
    const payload = buildRadarComparisonDeltaPdf(baseRunA, baseRunB, rows)

    expect(payload.filename).toBe(
      'fresnel-comparison-fresnel-sandbox-lumina-web-app-radar-delta.pdf',
    )
    expect(payload.bytes instanceof Uint8Array).toBe(true)
    expect(payload.bytes.byteLength).toBeGreaterThan(500)

    const decoded = new TextDecoder('utf-8').decode(payload.bytes)
    expect(decoded.startsWith('%PDF-1.4\n')).toBe(true)
    expect(decoded).toContain('xref\n')
    expect(decoded).toContain('%%EOF')
    expect(decoded).toContain('Performance Score')
    expect(decoded).toContain('Accessibility Score')
  })

  it('sanitizes special Unicode symbols safely in repository names and notes', () => {
    const unicodeRunB: ComparableAuditRun = {
      ...baseRunB,
      repoFullName: 'org/my—app⚡v2',
      label: 'Run A → Run B · ≥95%',
    }
    const payload = buildRadarComparisonDeltaPdf(baseRunA, unicodeRunB, rows)
    const decoded = new TextDecoder('utf-8').decode(payload.bytes)

    expect(payload.filename).toBe('fresnel-comparison-org-my-app-v2-radar-delta.pdf')
    expect(decoded).toContain('Run A -> Run B')
  })
})
