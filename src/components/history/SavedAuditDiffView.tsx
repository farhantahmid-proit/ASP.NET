import { useEffect, useMemo, useState } from 'react'
import type { LocalSavedAuditRecord, SavedAuditHistoryRecord } from '@/types/audit'

export interface DiffComparableAuditSession {
  auditId: string
  repoFullName: string
  branch: string
  runPhase: 'static' | 'lhr'
  timestampMs: number
  timestampIso: string
  isLiveCurrentSession: boolean
  performanceBefore: number
  performanceAfter: number
  accessibilityBefore: number
  accessibilityAfter: number
  bestPracticesBefore: number
  bestPracticesAfter: number
  seoBefore: number
  seoAfter: number
  securityBefore: number
  securityAfter: number
  selectedCommitsCount: number
  totalCommitsCount: number
  summaryNotes: string
  commitTitles: string[]
  sourceRecord: SavedAuditHistoryRecord | LocalSavedAuditRecord
}

export interface DiffCategoryRow {
  id: 'performance' | 'accessibility' | 'bestPractices' | 'seo' | 'security'
  label: string
  prevBefore: number
  prevAfter: number
  currBefore: number
  currAfter: number
  afterDelta: number
  direction: 'improved' | 'unchanged' | 'regressed'
}

export interface RepositoryAuditDiffResult {
  repoFullName: string
  previousRun: DiffComparableAuditSession
  currentRun: DiffComparableAuditSession
  prevAvgAfter: number
  currAvgAfter: number
  overallAfterDelta: number
  categories: DiffCategoryRow[]
  improvedCategoriesCount: number
  addedCommits: string[]
  sharedCommits: string[]
  removedCommits: string[]
}

function parseTimestampMs(iso: string | undefined): number {
  const ms = new Date(iso || 0).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function clampPct(raw: number | undefined): number {
  const num = Number(raw)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.min(100, Math.round(num)))
}

export function listComparableDiffRepositories(
  savedAudits: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  currentSessionRecord: LocalSavedAuditRecord | null = null,
): Array<{ repoFullName: string; sessionCount: number; hasCurrentLive: boolean }> {
  const map = new Map<
    string,
    { repoFullName: string; ids: Set<string>; hasCurrentLive: boolean }
  >()

  const register = (rec: SavedAuditHistoryRecord | LocalSavedAuditRecord, isLive: boolean) => {
    const repoName = (rec.repoFullName || '').trim()
    if (!repoName) return
    const key = repoName.toLowerCase()
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        repoFullName: repoName,
        ids: new Set([rec.auditId]),
        hasCurrentLive: isLive,
      })
    } else {
      existing.ids.add(rec.auditId)
      if (isLive) existing.hasCurrentLive = true
    }
  }

  if (currentSessionRecord) register(currentSessionRecord, true)
  for (const rec of savedAudits) register(rec, false)

  return Array.from(map.values())
    .filter((entry) => entry.ids.size >= 2)
    .map((entry) => ({
      repoFullName: entry.repoFullName,
      sessionCount: entry.ids.size,
      hasCurrentLive: entry.hasCurrentLive,
    }))
    .sort((a, b) => {
      if (a.hasCurrentLive !== b.hasCurrentLive) return a.hasCurrentLive ? -1 : 1
      return b.sessionCount - a.sessionCount
    })
}

export function buildComparableRepositorySessions(
  savedAudits: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  currentSessionRecord: LocalSavedAuditRecord | null,
  repoFullName: string,
): DiffComparableAuditSession[] {
  const target = (repoFullName || '').trim().toLowerCase()
  if (!target) return []

  const byId = new Map<string, DiffComparableAuditSession>()

  const addRecord = (
    rec: SavedAuditHistoryRecord | LocalSavedAuditRecord,
    isLiveCurrentSession: boolean,
  ) => {
    if ((rec.repoFullName || '').trim().toLowerCase() !== target) return
    const tsIso = rec.updatedAtIso || rec.createdAtIso || new Date().toISOString()
    byId.set(rec.auditId, {
      auditId: rec.auditId,
      repoFullName: rec.repoFullName,
      branch: rec.branch || 'main',
      runPhase: rec.runPhase === 'lhr' ? 'lhr' : 'static',
      timestampMs: isLiveCurrentSession
        ? Math.max(Date.now(), parseTimestampMs(tsIso))
        : parseTimestampMs(tsIso),
      timestampIso: tsIso,
      isLiveCurrentSession,
      performanceBefore: clampPct(rec.performanceBefore),
      performanceAfter: clampPct(rec.performanceAfter),
      accessibilityBefore: clampPct(rec.accessibilityBefore),
      accessibilityAfter: clampPct(rec.accessibilityAfter),
      bestPracticesBefore: clampPct(rec.bestPracticesBefore),
      bestPracticesAfter: clampPct(rec.bestPracticesAfter),
      seoBefore: clampPct(rec.seoBefore),
      seoAfter: clampPct(rec.seoAfter),
      securityBefore: clampPct(rec.securityBefore),
      securityAfter: clampPct(rec.securityAfter),
      selectedCommitsCount: Math.max(0, rec.selectedCommitsCount || 0),
      totalCommitsCount: Math.max(0, rec.totalCommitsCount || 0),
      summaryNotes: rec.summaryNotes || '',
      commitTitles: Array.isArray(rec.commitTitles) ? rec.commitTitles : [],
      sourceRecord: rec,
    })
  }

  for (const rec of savedAudits) addRecord(rec, false)
  if (currentSessionRecord) addRecord(currentSessionRecord, true)

  return Array.from(byId.values()).sort((a, b) => {
    if (a.isLiveCurrentSession !== b.isLiveCurrentSession) {
      return a.isLiveCurrentSession ? -1 : 1
    }
    return b.timestampMs - a.timestampMs
  })
}

export function pickDefaultDiffPair(
  sessions: readonly DiffComparableAuditSession[],
  preferredCurrentAuditId?: string | null,
): { previousRun: DiffComparableAuditSession | null; currentRun: DiffComparableAuditSession | null } {
  if (sessions.length === 0) return { previousRun: null, currentRun: null }
  if (sessions.length === 1) return { previousRun: null, currentRun: sessions[0] }

  const preferred = preferredCurrentAuditId
    ? (sessions.find((s) => s.auditId === preferredCurrentAuditId) ?? null)
    : null
  const currentRun = preferred ?? sessions[0]
  const remaining = sessions.filter((s) => s.auditId !== currentRun.auditId)
  const olderRun = remaining.find((s) => s.timestampMs <= currentRun.timestampMs)
  return { previousRun: olderRun ?? remaining[0] ?? null, currentRun }
}

function averageScoreAfter(session: DiffComparableAuditSession): number {
  return Math.round(
    (session.performanceAfter +
      session.accessibilityAfter +
      session.bestPracticesAfter +
      session.seoAfter +
      session.securityAfter) /
      5,
  )
}

export function computeRepositoryAuditDiff(
  previousRun: DiffComparableAuditSession,
  currentRun: DiffComparableAuditSession,
): RepositoryAuditDiffResult {
  const categoryDefs: Array<{
    id: DiffCategoryRow['id']
    label: string
    prevBefore: number
    prevAfter: number
    currBefore: number
    currAfter: number
  }> = [
    {
      id: 'performance',
      label: 'Performance',
      prevBefore: previousRun.performanceBefore,
      prevAfter: previousRun.performanceAfter,
      currBefore: currentRun.performanceBefore,
      currAfter: currentRun.performanceAfter,
    },
    {
      id: 'accessibility',
      label: 'Accessibility',
      prevBefore: previousRun.accessibilityBefore,
      prevAfter: previousRun.accessibilityAfter,
      currBefore: currentRun.accessibilityBefore,
      currAfter: currentRun.accessibilityAfter,
    },
    {
      id: 'bestPractices',
      label: 'Best Practices',
      prevBefore: previousRun.bestPracticesBefore,
      prevAfter: previousRun.bestPracticesAfter,
      currBefore: currentRun.bestPracticesBefore,
      currAfter: currentRun.bestPracticesAfter,
    },
    {
      id: 'seo',
      label: 'SEO',
      prevBefore: previousRun.seoBefore,
      prevAfter: previousRun.seoAfter,
      currBefore: currentRun.seoBefore,
      currAfter: currentRun.seoAfter,
    },
    {
      id: 'security',
      label: 'Security',
      prevBefore: previousRun.securityBefore,
      prevAfter: previousRun.securityAfter,
      currBefore: currentRun.securityBefore,
      currAfter: currentRun.securityAfter,
    },
  ]

  const categories: DiffCategoryRow[] = categoryDefs.map((def) => {
    const afterDelta = def.currAfter - def.prevAfter
    const direction: DiffCategoryRow['direction'] =
      afterDelta > 0 ? 'improved' : afterDelta < 0 ? 'regressed' : 'unchanged'
    return { ...def, afterDelta, direction }
  })

  const prevAvgAfter = averageScoreAfter(previousRun)
  const currAvgAfter = averageScoreAfter(currentRun)

  const prevTitleKeys = new Set(previousRun.commitTitles.map((t) => t.trim().toLowerCase()).filter(Boolean))
  const currTitleKeys = new Set(currentRun.commitTitles.map((t) => t.trim().toLowerCase()).filter(Boolean))

  const addedCommits: string[] = []
  const sharedCommits: string[] = []
  for (const title of currentRun.commitTitles) {
    if (prevTitleKeys.has(title.trim().toLowerCase())) {
      sharedCommits.push(title)
    } else {
      addedCommits.push(title)
    }
  }
  const removedCommits = previousRun.commitTitles.filter(
    (title) => !currTitleKeys.has(title.trim().toLowerCase()),
  )

  return {
    repoFullName: currentRun.repoFullName,
    previousRun,
    currentRun,
    prevAvgAfter,
    currAvgAfter,
    overallAfterDelta: currAvgAfter - prevAvgAfter,
    categories,
    improvedCategoriesCount: categories.filter((c) => c.direction === 'improved').length,
    addedCommits,
    sharedCommits,
    removedCommits,
  }
}

export interface SavedAuditDiffViewProps {
  savedAudits: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
  currentSessionRecord?: LocalSavedAuditRecord | null
  targetRepoFullName?: string | null
  targetAuditId?: string | null
  onCloseDiff?: () => void
}

export function SavedAuditDiffView({
  savedAudits,
  currentSessionRecord = null,
  targetRepoFullName = null,
  targetAuditId = null,
  onCloseDiff,
}: SavedAuditDiffViewProps) {
  const comparableRepos = useMemo(
    () => listComparableDiffRepositories(savedAudits, currentSessionRecord),
    [savedAudits, currentSessionRecord],
  )
  const [selectedRepo, setSelectedRepo] = useState<string>(
    () => targetRepoFullName || comparableRepos[0]?.repoFullName || savedAudits[0]?.repoFullName || '',
  )

  useEffect(() => {
    if (targetRepoFullName) {
      setSelectedRepo(targetRepoFullName)
    } else if (
      comparableRepos.length > 0 &&
      !comparableRepos.some((r) => r.repoFullName === selectedRepo)
    ) {
      setSelectedRepo(comparableRepos[0].repoFullName)
    }
  }, [targetRepoFullName, comparableRepos, selectedRepo])

  const sessions = useMemo(
    () => buildComparableRepositorySessions(savedAudits, currentSessionRecord, selectedRepo),
    [savedAudits, currentSessionRecord, selectedRepo],
  )

  const [selectedPrevId, setSelectedPrevId] = useState<string | null>(null)
  const [selectedCurrId, setSelectedCurrId] = useState<string | null>(null)

  useEffect(() => {
    if (sessions.length < 2) {
      setSelectedPrevId(null)
      setSelectedCurrId(sessions[0]?.auditId ?? null)
      return
    }
    const validIds = new Set(sessions.map((s) => s.auditId))
    if (
      !selectedCurrId ||
      !selectedPrevId ||
      selectedCurrId === selectedPrevId ||
      !validIds.has(selectedCurrId) ||
      !validIds.has(selectedPrevId)
    ) {
      const pair = pickDefaultDiffPair(sessions, targetAuditId)
      setSelectedCurrId(pair.currentRun?.auditId ?? null)
      setSelectedPrevId(pair.previousRun?.auditId ?? null)
    }
  }, [sessions, selectedPrevId, selectedCurrId, targetAuditId])

  const diffResult = useMemo(() => {
    if (sessions.length < 2) return null
    const fallback = pickDefaultDiffPair(sessions, targetAuditId)
    const curr =
      (selectedCurrId ? sessions.find((s) => s.auditId === selectedCurrId) : null) ??
      fallback.currentRun
    const prev =
      (selectedPrevId ? sessions.find((s) => s.auditId === selectedPrevId) : null) ??
      fallback.previousRun
    if (!curr || !prev || curr.auditId === prev.auditId) return null
    return computeRepositoryAuditDiff(prev, curr)
  }, [sessions, selectedPrevId, selectedCurrId, targetAuditId])

  return (
    <section className="fr-card" aria-labelledby="saved-diff-heading">
      <div className="fr-section-head">
        <div>
          <p className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> REPOSITORY RUN-TO-RUN DIFF
          </p>
          <h2 id="saved-diff-heading" className="fr-section-title">
            Saved Audit Diff Comparison
          </h2>
        </div>
        <div className="fr-actions">
          {sessions.length >= 2 && (
            <button
              type="button"
              className="fr-btn-secondary"
              onClick={() => {
                setSelectedPrevId(selectedCurrId)
                setSelectedCurrId(selectedPrevId)
              }}
            >
              Swap Runs
            </button>
          )}
          {onCloseDiff && (
            <button type="button" className="fr-btn-secondary" onClick={onCloseDiff}>
              Close
            </button>
          )}
        </div>
      </div>

      {comparableRepos.length > 0 && (
        <label className="fr-select-field">
          <span className="fr-label">Repository ({comparableRepos.length} comparable)</span>
          <select
            className="fr-input"
            value={selectedRepo}
            onChange={(e) => {
              setSelectedRepo(e.target.value)
              setSelectedPrevId(null)
              setSelectedCurrId(null)
            }}
          >
            {comparableRepos.map((repo) => (
              <option key={repo.repoFullName} value={repo.repoFullName}>
                {repo.repoFullName} ({repo.sessionCount} runs)
              </option>
            ))}
          </select>
        </label>
      )}

      {!diffResult ? (
        <p className="fr-muted">
          Select a repository with at least 2 saved audit runs to inspect run-to-run score and
          commit deltas.
        </p>
      ) : (
        <>
          <div className="fr-comparison-selectors">
            <label className="fr-select-field">
              <span className="fr-label">Baseline Run</span>
              <select
                className="fr-input"
                value={diffResult.previousRun.auditId}
                onChange={(e) => setSelectedPrevId(e.target.value)}
              >
                {sessions.map((s) => (
                  <option key={s.auditId} value={s.auditId} disabled={s.auditId === selectedCurrId}>
                    {s.branch} ({s.runPhase}) · Perf {s.performanceAfter}
                  </option>
                ))}
              </select>
            </label>

            <label className="fr-select-field">
              <span className="fr-label">Comparison Run</span>
              <select
                className="fr-input"
                value={diffResult.currentRun.auditId}
                onChange={(e) => setSelectedCurrId(e.target.value)}
              >
                {sessions.map((s) => (
                  <option key={s.auditId} value={s.auditId} disabled={s.auditId === selectedPrevId}>
                    {s.branch} ({s.runPhase}) · Perf {s.performanceAfter}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="fr-table-scroll">
            <table className="fr-comparison-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Baseline After</th>
                  <th>Current After</th>
                  <th>Delta</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {diffResult.categories.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{row.prevAfter}</td>
                    <td>
                      <strong>{row.currAfter}</strong>
                    </td>
                    <td>
                      <span className="fr-badge">
                        {row.afterDelta > 0 ? `+${row.afterDelta}` : row.afterDelta}
                      </span>
                    </td>
                    <td>{row.direction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="fr-intake-grid">
            <div className="fr-bundle-box">
              <strong>New Improvements ({diffResult.addedCommits.length})</strong>
              {diffResult.addedCommits.length === 0 ? (
                <p className="fr-muted">No new fix titles added between runs.</p>
              ) : (
                <ul className="fr-violation-list">
                  {diffResult.addedCommits.slice(0, 8).map((title) => (
                    <li key={title}>+ {title}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="fr-bundle-box">
              <strong>Removed / Superseded ({diffResult.removedCommits.length})</strong>
              {diffResult.removedCommits.length === 0 ? (
                <p className="fr-muted">No prior fixes removed.</p>
              ) : (
                <ul className="fr-violation-list">
                  {diffResult.removedCommits.slice(0, 8).map((title) => (
                    <li key={title}>- {title}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
