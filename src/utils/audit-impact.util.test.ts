import { describe, expect, it } from 'vitest'
import type { AuditCommit, AuditSession } from '@/types/audit'
import {
  buildComparableRunsFromSession,
  buildMetricComparisonRows,
  computeAuditImpactMetrics,
} from './audit-impact.util'

function makeCommit(id: string, category: AuditCommit['category'], ruleId: string): AuditCommit {
  return {
    id,
    sha: 'abc1234',
    fullSha: 'abc12340000',
    category,
    categoryLabel: category,
    ruleId,
    title: `${category} fix ${ruleId}`,
    commitMessage: `fix: ${ruleId}`,
    summary: `Improves ${ruleId}`,
    files: ['index.html'],
    additions: 2,
    deletions: 1,
    author: 'Fresnel',
    date: '2026-11-26',
    body: '',
    diff: '',
  }
}

function makeSession(runPhase: 'static' | 'lhr' = 'static'): AuditSession {
  return {
    id: 'audit-1',
    interactionId: 'int-1',
    mode: 'demo',
    runPhase,
    status: 'completed',
    progressPercent: 100,
    deterministicMetrics: {
      performanceBefore: 60,
      performanceAfter: 96,
      accessibilityBefore: 70,
      accessibilityAfter: 98,
      bestPracticesBefore: 75,
      bestPracticesAfter: 95,
      seoBefore: 80,
      seoAfter: 96,
      securityBefore: 72,
      securityAfter: 94,
    },
    repo: {
      owner: 'fresnel-sandbox',
      repo: 'lumina-web-app',
      fullName: 'fresnel-sandbox/lumina-web-app',
      url: 'https://github.com/fresnel-sandbox/lumina-web-app',
      isDemo: true,
    },
    branch: 'main',
    categories: ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
    currentStep: {
      index: 0,
      phase: 'Completed',
      category: 'Complete',
      headline: 'Done',
      narrative: 'Done',
    },
    steps: [],
    totalSteps: 1,
    commits: [
      makeCommit('c1', 'performance', 'largest-contentful-paint'),
      makeCommit('c2', 'accessibility', 'color-contrast'),
      makeCommit('c3', 'security', 'no-unsanitized-innerhtml-sink'),
    ],
    totalCommits: 3,
    pr: null,
  }
}

describe('utils/audit-impact.util', () => {
  it('computes scaled before/after impact metrics based on selected commit IDs', () => {
    const session = makeSession('static')
    const allSelected = computeAuditImpactMetrics(session, ['c1', 'c2', 'c3'])
    expect(allSelected.performanceBefore).toBe(60)
    expect(allSelected.performanceAfter).toBe(96)
    expect(allSelected.accessibilityAfter).toBe(98)
    expect(allSelected.securityAfter).toBe(94)
    expect(allSelected.categoryAxes.length).toBe(5)
    expect(allSelected.detailedAxes.length).toBe(6)

    const partial = computeAuditImpactMetrics(session, ['c2'])
    expect(partial.performanceAfter).toBe(60)
    expect(partial.accessibilityAfter).toBe(98)
    expect(partial.securityAfter).toBe(72)
  })

  it('omits security category axis during LHR phase and builds 8 comparison rows', () => {
    const session = makeSession('lhr')
    const metrics = computeAuditImpactMetrics(session, ['c1', 'c2'])
    expect(metrics.categoryAxes.some((axis) => axis.group === 'security')).toBe(false)

    const runs = buildComparableRunsFromSession(session, metrics, 2, 3, [])
    expect(runs.length).toBeGreaterThanOrEqual(4)
    const rows = buildMetricComparisonRows(runs[0], runs[1])
    expect(rows.length).toBe(8)
    expect(rows[0].runBAfter).toBeGreaterThan(rows[0].runAAfter)
  })
})
