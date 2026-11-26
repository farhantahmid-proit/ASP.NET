import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditImpactMetrics, AuditSession } from '@/types/audit'
import {
  AUDIT_RESULT_CACHE_MAX_ITEMS,
  AUDIT_RESULT_CACHE_STORAGE_KEY,
  AuditResultCacheService,
  buildAuditCacheKey,
} from './audit-result-cache'

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
}

function makeSession(idx: number): AuditSession {
  return {
    id: `sess-${idx}`,
    interactionId: `int-${idx}`,
    mode: 'demo',
    runPhase: 'static',
    status: 'completed',
    progressPercent: 100,
    repo: {
      owner: 'org',
      repo: `app-${idx}`,
      fullName: `org/app-${idx}`,
      url: `https://github.com/org/app-${idx}`,
    },
    branch: 'main',
    categories: ['performance'],
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
      {
        id: `c-${idx}-1`,
        sha: 'abc1234',
        fullSha: 'abc1234',
        category: 'performance',
        categoryLabel: 'Performance',
        ruleId: 'lcp',
        title: 'Optimize hero',
        commitMessage: 'perf: optimize hero',
        summary: 'Preload hero image',
        files: ['index.html'],
        additions: 1,
        deletions: 1,
        author: 'Fresnel',
        date: '2026-11-26',
        body: '',
        diff: '',
      },
    ],
    totalCommits: 1,
    pr: null,
  }
}

const sampleImpact: AuditImpactMetrics = {
  performanceBefore: 60,
  performanceAfter: 90,
  accessibilityBefore: 70,
  accessibilityAfter: 95,
  bestPracticesBefore: 75,
  bestPracticesAfter: 92,
  seoBefore: 80,
  seoAfter: 96,
  securityBefore: 72,
  securityAfter: 94,
  detailedAxes: [],
  categoryAxes: [],
}

describe('AuditResultCacheService', () => {
  let ls: Storage
  let service: AuditResultCacheService

  beforeEach(() => {
    ls = createMemoryStorage()
    vi.stubGlobal('window', { localStorage: ls })
    service = new AuditResultCacheService()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds deterministic cache keys and stores up to MAX_ITEMS entries with LRU eviction', () => {
    expect(buildAuditCacheKey('org/app', 'static')).toBe('org/app::static')

    for (let i = 1; i <= AUDIT_RESULT_CACHE_MAX_ITEMS + 2; i++) {
      service.cacheAuditResult(makeSession(i), sampleImpact, [`c-${i}-1`], 'performance')
    }

    expect(service.cacheCount()).toBe(AUDIT_RESULT_CACHE_MAX_ITEMS)
    const rawPersisted = ls.getItem(AUDIT_RESULT_CACHE_STORAGE_KEY)
    expect(rawPersisted).toBeTruthy()
    expect(service.latestCachedAudit()?.repoFullName).toBe(
      `org/app-${AUDIT_RESULT_CACHE_MAX_ITEMS + 2}`,
    )
  })

  it('updates selected commit IDs, notifies subscribers, and clears entries', () => {
    const onNotify = vi.fn()
    const unsubscribe = service.subscribe(onNotify)

    const entry = service.cacheAuditResult(makeSession(1), sampleImpact, ['c-1-1'], 'all')
    expect(entry).not.toBeNull()
    expect(service.activeCacheKey()).toBe(entry?.cacheKey)

    service.updateSelectionInCache(entry!.cacheKey, [], 'accessibility')
    expect(service.cachedAudits()[0]?.selectedCommitIds).toEqual([])
    expect(service.cachedAudits()[0]?.categoryFilter).toBe('accessibility')
    expect(onNotify).toHaveBeenCalled()

    service.removeCachedAudit(entry!.cacheKey)
    expect(service.cacheCount()).toBe(0)

    service.cacheAuditResult(makeSession(2), sampleImpact, ['c-2-1'], 'all')
    service.clearCache()
    expect(service.cacheCount()).toBe(0)
    expect(service.activeCacheKey()).toBeNull()

    unsubscribe()
  })
})
