import { describe, expect, it } from 'vitest'
import type { SavedAuditHistoryRecord } from '@/types/audit'
import { buildGlobalCumulativeTimeline } from './GlobalAuditDashboard'
import {
  buildComparableRepositorySessions,
  computeRepositoryAuditDiff,
  pickDefaultDiffPair,
} from './SavedAuditDiffView'
import { buildRepositoryTrendSeries, listTrendRepositories } from './SavedAuditTrendChart'

const RECORDS: SavedAuditHistoryRecord[] = [
  {
    auditId: 'run-1',
    ownerId: 'local',
    repoFullName: 'fresnel-sandbox/lumina-web-app',
    repoUrl: 'https://github.com/fresnel-sandbox/lumina-web-app',
    branch: 'main',
    runPhase: 'static',
    mode: 'demo',
    totalCommitsCount: 10,
    selectedCommitsCount: 8,
    performanceBefore: 60,
    performanceAfter: 82,
    accessibilityBefore: 68,
    accessibilityAfter: 88,
    bestPracticesBefore: 75,
    bestPracticesAfter: 90,
    seoBefore: 78,
    seoAfter: 92,
    securityBefore: 72,
    securityAfter: 90,
    summaryNotes: 'Run 1 baseline',
    commitTitles: ['Preload hero image', 'Add alt text'],
    createdAtIso: '2026-11-20T10:00:00.000Z',
    updatedAtIso: '2026-11-20T10:00:00.000Z',
  },
  {
    auditId: 'run-2',
    ownerId: 'local',
    repoFullName: 'fresnel-sandbox/lumina-web-app',
    repoUrl: 'https://github.com/fresnel-sandbox/lumina-web-app',
    branch: 'main',
    runPhase: 'lhr',
    mode: 'demo',
    totalCommitsCount: 12,
    selectedCommitsCount: 12,
    performanceBefore: 60,
    performanceAfter: 96,
    accessibilityBefore: 68,
    accessibilityAfter: 98,
    bestPracticesBefore: 75,
    bestPracticesAfter: 96,
    seoBefore: 78,
    seoAfter: 98,
    securityBefore: 72,
    securityAfter: 94,
    summaryNotes: 'Run 2 optimized',
    commitTitles: ['Preload hero image', 'Add focus-visible outlines'],
    createdAtIso: '2026-11-22T10:00:00.000Z',
    updatedAtIso: '2026-11-22T10:00:00.000Z',
  },
]

describe('components/history analytics & diff helpers', () => {
  it('computes repository diff deltas and added/shared/removed commits', () => {
    const sessions = buildComparableRepositorySessions(
      RECORDS,
      null,
      'fresnel-sandbox/lumina-web-app',
    )
    expect(sessions.length).toBe(2)

    const pair = pickDefaultDiffPair(sessions)
    expect(pair.previousRun?.auditId).toBe('run-1')
    expect(pair.currentRun?.auditId).toBe('run-2')

    const diff = computeRepositoryAuditDiff(pair.previousRun!, pair.currentRun!)
    expect(diff.improvedCategoriesCount).toBe(5)
    expect(diff.addedCommits).toEqual(['Add focus-visible outlines'])
    expect(diff.sharedCommits).toEqual(['Preload hero image'])
    expect(diff.removedCommits).toEqual(['Add alt text'])
  })

  it('builds chronological trend series and cumulative global timeline', () => {
    const repos = listTrendRepositories(RECORDS)
    expect(repos[0]?.runCount).toBe(2)

    const trend = buildRepositoryTrendSeries(RECORDS, 'fresnel-sandbox/lumina-web-app', 'after')
    expect(trend.length).toBe(2)
    expect(trend[1]?.perfDeltaFromPrev).toBe(14)

    const global = buildGlobalCumulativeTimeline(RECORDS)
    expect(global.length).toBe(2)
    expect(global[1]?.cumulativePerfLift).toBe(22 + 36)
  })
})
