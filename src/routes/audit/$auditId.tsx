import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useAuditStatus,
  useCreateAuditPullRequest,
  useExportAuditReport,
  useFastForwardAudit,
  useGenerateAuditPatch,
  useGenerateExecutiveSummary,
} from '@/api/audit/audit.hooks'
import { getFresnelApiBaseUrl } from '@/api/client'
import { AuditRunComparison } from '@/components/audit/AuditRunComparison'
import { CommitDiffViewer } from '@/components/audit/CommitDiffViewer'
import { ExecutiveSummaryCard } from '@/components/audit/ExecutiveSummaryCard'
import { ImpactRadarChart } from '@/components/audit/ImpactRadarChart'
import { RepoContextBar } from '@/components/audit/RepoContextBar'
import { RadialScoreGauge } from '@/components/ui/RadialScoreGauge'
import { useAuditStream } from '@/hooks/useAuditStream'
import { useLocalAuditStorage } from '@/hooks/useLocalAuditStorage'
import { hasWorkspacePermission } from '@/lib/rbac'
import { auditResultCache } from '@/lib/services/audit-result-cache'
import { useAuth } from '@/providers/auth-provider'
import type {
  ExecutiveSummaryResult,
  LighthouseCategory,
  PatchBundle,
  PullRequestResult,
  ReportExportBundle,
} from '@/types/audit'
import { computeAuditImpactMetrics } from '@/utils/audit-impact.util'

export const Route = createFileRoute('/audit/$auditId')({
  component: AuditSessionPage,
})

const FILTER_TABS: Array<{ id: LighthouseCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'performance', label: 'Performance' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'best-practices', label: 'Best Practices' },
  { id: 'seo', label: 'SEO' },
  { id: 'security', label: 'Security' },
]

function triggerTextDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function AuditSessionPage() {
  const { auditId } = Route.useParams()
  const { session: authSession } = useAuth()
  const { localAudits, saveSessionLocally } = useLocalAuditStorage()

  const localSnapshot = useMemo(() => {
    const fromSaved = localAudits.find(
      (rec) => rec.auditId === auditId && rec.snapshotSession,
    )?.snapshotSession
    if (fromSaved) return fromSaved
    const fromCache = auditResultCache
      .cachedAudits()
      .find((entry) => entry.auditId === auditId)?.session
    return fromCache ?? null
  }, [auditId, localAudits])

  const {
    data: remoteSession,
    isLoading: isRemoteLoading,
    error: remoteError,
    refetch,
  } = useAuditStatus(localSnapshot ? '' : auditId)

  const session = remoteSession ?? localSnapshot

  useAuditStream(
    auditId,
    Boolean(!localSnapshot && remoteSession?.status === 'in_progress'),
    {
      onCompleted: () => {
        void refetch()
      },
    },
  )

  const fastForwardMutation = useFastForwardAudit()
  const patchMutation = useGenerateAuditPatch()
  const prMutation = useCreateAuditPullRequest()
  const exportMutation = useExportAuditReport()
  const execSummaryMutation = useGenerateExecutiveSummary()

  const [selectedCommitIds, setSelectedCommitIds] = useState<string[]>([])
  const [categoryFilter, setCategoryFilter] = useState<LighthouseCategory>('all')
  const [expandedCommitIds, setExpandedCommitIds] = useState<Record<string, boolean>>({})
  const [patchBundle, setPatchBundle] = useState<PatchBundle | null>(null)
  const [prBundle, setPrBundle] = useState<PullRequestResult | null>(null)
  const [exportBundle, setExportBundle] = useState<ReportExportBundle | null>(null)
  const [execSummary, setExecSummary] = useState<ExecutiveSummaryResult | null>(null)
  const [execError, setExecError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)

  const initializedSessionIdRef = useRef<string | null>(null)
  const cachedSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!session || session.commits.length === 0) return
    if (initializedSessionIdRef.current !== session.id) {
      initializedSessionIdRef.current = session.id
      const allIds = session.commits.map((c) => c.id)
      setSelectedCommitIds(allIds)
      setExpandedCommitIds({ [allIds[0]]: true })
    }
  }, [session])

  const selectedSet = useMemo(() => new Set(selectedCommitIds), [selectedCommitIds])

  const impactMetrics = useMemo(
    () => computeAuditImpactMetrics(session, selectedSet),
    [session, selectedSet],
  )

  useEffect(() => {
    if (
      session &&
      session.status === 'completed' &&
      cachedSessionIdRef.current !== `${session.id}:${session.commits.length}`
    ) {
      cachedSessionIdRef.current = `${session.id}:${session.commits.length}`
      auditResultCache.cacheAuditResult(
        session,
        impactMetrics,
        selectedCommitIds,
        categoryFilter,
      )
    }
  }, [session, impactMetrics, selectedCommitIds, categoryFilter])

  const visibleCommits = useMemo(() => {
    if (!session) return []
    if (categoryFilter === 'all') return session.commits
    return session.commits.filter((c) => c.category === categoryFilter)
  }, [session, categoryFilter])

  const effectiveRole = authSession?.administrator.role ?? 'admin'
  const canExportOrPatch = hasWorkspacePermission(effectiveRole, 'canRunAudit')

  if (isRemoteLoading && !session) {
    return (
      <section className="fr-card" role="status" aria-live="polite">
        <div className="fr-eyebrow">
          <span className="fr-eyebrow-line" /> LOADING AUDIT SESSION
        </div>
        <h2>Connecting to Fresnel telemetry stream...</h2>
        <p className="fr-muted">Session ID: {auditId}</p>
      </section>
    )
  }

  if (!session) {
    return (
      <section className="fr-card" role="alert">
        <div className="fr-eyebrow">
          <span className="fr-eyebrow-line" /> SESSION NOT FOUND
        </div>
        <h2>Audit session unavailable</h2>
        <p className="fr-muted">
          {remoteError instanceof Error
            ? remoteError.message
            : `No active or saved audit found for "${auditId}".`}
        </p>
        <div className="fr-actions">
          <Link to="/" className="fr-btn-primary">
            Back to Workbench →
          </Link>
          <Link to="/dashboard" className="fr-btn-secondary">
            Open Saved Audits
          </Link>
        </div>
      </section>
    )
  }

  function toggleCommitSelection(commitId: string) {
    setSelectedCommitIds((prev) =>
      prev.includes(commitId) ? prev.filter((id) => id !== commitId) : [...prev, commitId],
    )
  }

  function toggleCommitExpanded(commitId: string) {
    setExpandedCommitIds((prev) => ({
      ...prev,
      [commitId]: !prev[commitId],
    }))
  }

  async function handleDownloadPatch() {
    if (!session) return
    setActionNotice(null)
    try {
      const result = await patchMutation.mutateAsync({
        sessionId: session.id,
        selectedCommitIds,
      })
      setPatchBundle(result)
      triggerTextDownload(result.filename, result.patchContent, 'text/x-diff;charset=utf-8')
      setActionNotice(`Downloaded ${result.filename} (${result.selectedCount} commits).`)
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : 'Unable to generate git patch.')
    }
  }

  async function handleExportMarkdownReport() {
    if (!session) return
    setActionNotice(null)
    try {
      const bundle = await exportMutation.mutateAsync({
        sessionId: session.id,
        selectedCommitIds,
      })
      setExportBundle(bundle)
      triggerTextDownload(
        bundle.markdownFilename,
        bundle.markdownContent,
        'text/markdown;charset=utf-8',
      )
      setActionNotice(`Exported Markdown report ${bundle.markdownFilename}.`)
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : 'Unable to export Markdown report.')
    }
  }

  async function handlePreparePrBundle() {
    if (!session) return
    setActionNotice(null)
    try {
      const result = await prMutation.mutateAsync({
        sessionId: session.id,
        selectedCommitIds,
        headBranch: `fresnel/${session.runPhase === 'lhr' ? 'lhr-fixes' : 'code-audit'}`,
      })
      setPrBundle(result)
      setActionNotice(`Prepared PR bundle #${result.number} on branch ${result.headBranch}.`)
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : 'Unable to prepare PR bundle.')
    }
  }

  function handleSaveLocally() {
    if (!session) return
    const selectedCommits = session.commits.filter((c) => selectedSet.has(c.id))
    const saved = saveSessionLocally(session, impactMetrics, selectedCommits, 'json')
    setActionNotice(`Saved "${saved.repoFullName}" (${saved.auditId}) to local browser storage.`)
  }

  async function handleRegenerateSummary() {
    if (!session) return
    setExecError(null)
    const pool = session.commits.filter((c) => selectedSet.has(c.id))
    const activePool = pool.length > 0 ? pool : session.commits
    try {
      const result = await execSummaryMutation.mutateAsync({
        sessionId: session.id,
        repoFullName: session.repo.fullName,
        branch: session.branch,
        runPhase: session.runPhase,
        metrics: {
          performanceBefore: impactMetrics.performanceBefore,
          performanceAfter: impactMetrics.performanceAfter,
          accessibilityBefore: impactMetrics.accessibilityBefore,
          accessibilityAfter: impactMetrics.accessibilityAfter,
          bestPracticesBefore: impactMetrics.bestPracticesBefore,
          bestPracticesAfter: impactMetrics.bestPracticesAfter,
          seoBefore: impactMetrics.seoBefore,
          seoAfter: impactMetrics.seoAfter,
          securityBefore: impactMetrics.securityBefore,
          securityAfter: impactMetrics.securityAfter,
        },
        commits: activePool.slice(0, 18).map((c) => ({
          category: c.category,
          categoryLabel: c.categoryLabel,
          title: c.title,
          summary: c.summary,
          ruleId: c.ruleId,
        })),
      })
      setExecSummary(result)
    } catch (err) {
      setExecError(
        err instanceof Error ? err.message : 'Failed to generate AI Executive Summary.',
      )
    }
  }

  const baseUrl = getFresnelApiBaseUrl()

  return (
    <div className="fr-audit-session">
      <header className="fr-audit-header">
        <div>
          <div className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> {session.mode.toUpperCase()} ·{' '}
            {session.runPhase.toUpperCase()} AUDIT
          </div>
          <h1 className="fr-audit-title">{session.repo.fullName}</h1>
          <p className="fr-muted">
            Branch: <code>{session.branch}</code> · {session.commits.length} atomic remediation
            commits
          </p>
        </div>

        <div className="fr-actions">
          <Link to="/" className="fr-btn-secondary">
            New Audit
          </Link>
          <Link to="/dashboard" className="fr-btn-secondary">
            Workspace &amp; History
          </Link>
        </div>
      </header>

      {session.status === 'in_progress' ? (
        <section className="fr-card fr-telemetry-card" aria-live="polite">
          <div className="fr-section-head">
            <div>
              <div className="fr-eyebrow">
                <span className="fr-eyebrow-line" /> REAL-TIME SSE TELEMETRY
              </div>
              <h2 className="fr-section-title">
                {session.currentStep?.headline || 'Analyzing repository AST & web quality...'}
              </h2>
              <p className="fr-muted">{session.currentStep?.narrative}</p>
            </div>
            <button
              type="button"
              id="audit-fast-forward-btn"
              className="fr-btn-primary"
              disabled={fastForwardMutation.isPending}
              onClick={() => void fastForwardMutation.mutateAsync(session.id)}
            >
              {fastForwardMutation.isPending ? 'Completing...' : 'Fast-Forward →'}
            </button>
          </div>

          <div className="fr-progress-panel">
            <div className="fr-progress-panel__top">
              <span>Phase: {session.currentStep?.phase || 'Scanning'}</span>
              <span>
                {session.progressPercent}%{' '}
                {session.estimatedTimeRemainingLabel
                  ? `· ${session.estimatedTimeRemainingLabel}`
                  : ''}
              </span>
            </div>
            <div className="fr-progress-track">
              <div
                className="fr-progress-fill"
                style={{ width: `${session.progressPercent}%` }}
              />
            </div>
          </div>

          {session.steps.length > 0 && (
            <ol className="fr-telemetry-steps">
              {session.steps.map((step) => (
                <li key={`${step.index}-${step.headline}`} className="fr-telemetry-step">
                  <span className="fr-badge">{step.category}</span>
                  <strong>{step.headline}</strong>
                  <span className="fr-muted">{step.narrative}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : (
        <>
          <RepoContextBar repo={session.repo} />

          <section className="fr-card" aria-label="Category audit score gauges">
            <div className="fr-section-head">
              <div>
                <h2 className="fr-section-title">Projected Lighthouse &amp; Security Impact</h2>
                <p className="fr-muted">
                  Toggling commit checkboxes recalculates projected scores and radar geometry
                  immediately.
                </p>
              </div>
              <span className="fr-badge">
                {selectedCommitIds.length} / {session.commits.length} selected
              </span>
            </div>

            <div className="fr-gauge-grid">
              <RadialScoreGauge
                label="Performance"
                category="performance"
                beforeScore={impactMetrics.performanceBefore}
                score={impactMetrics.performanceAfter}
              />
              <RadialScoreGauge
                label="Accessibility"
                category="accessibility"
                beforeScore={impactMetrics.accessibilityBefore}
                score={impactMetrics.accessibilityAfter}
              />
              <RadialScoreGauge
                label="Best Practices"
                category="best-practices"
                beforeScore={impactMetrics.bestPracticesBefore}
                score={impactMetrics.bestPracticesAfter}
              />
              <RadialScoreGauge
                label="SEO"
                category="seo"
                beforeScore={impactMetrics.seoBefore}
                score={impactMetrics.seoAfter}
              />
              {session.runPhase !== 'lhr' && (
                <RadialScoreGauge
                  label="Security"
                  category="security"
                  beforeScore={impactMetrics.securityBefore}
                  score={impactMetrics.securityAfter}
                />
              )}
            </div>
          </section>

          <ExecutiveSummaryCard
            summary={execSummary}
            isLoading={execSummaryMutation.isPending}
            errorMessage={execError}
            onRegenerate={() => void handleRegenerateSummary()}
          />

          <ImpactRadarChart
            metrics={impactMetrics}
            selectedCount={selectedCommitIds.length}
            totalCount={session.commits.length}
            activeCategoryTab={categoryFilter}
          />

          <AuditRunComparison
            currentSession={session}
            currentMetrics={impactMetrics}
            selectedCommitsCount={selectedCommitIds.length}
            totalCommitsCount={session.commits.length}
            savedAudits={localAudits}
          />

          <section className="fr-card fr-actions-bar" aria-label="Export and patch actions">
            <div className="fr-actions">
              <button
                type="button"
                id="audit-save-local-btn"
                className="fr-btn-secondary"
                onClick={handleSaveLocally}
              >
                Save to Local Audits
              </button>

              <button
                type="button"
                id="audit-download-patch-btn"
                className="fr-btn-primary"
                disabled={
                  !canExportOrPatch ||
                  patchMutation.isPending ||
                  selectedCommitIds.length === 0
                }
                onClick={() => void handleDownloadPatch()}
              >
                {patchMutation.isPending ? 'Building Patch...' : 'Download .patch'}
              </button>

              <button
                type="button"
                id="audit-export-md-btn"
                className="fr-btn-secondary"
                disabled={exportMutation.isPending || selectedCommitIds.length === 0}
                onClick={() => void handleExportMarkdownReport()}
              >
                Export Markdown
              </button>

              <button
                type="button"
                id="audit-prepare-pr-btn"
                className="fr-btn-secondary"
                disabled={
                  !canExportOrPatch ||
                  prMutation.isPending ||
                  selectedCommitIds.length === 0
                }
                onClick={() => void handlePreparePrBundle()}
              >
                Prepare PR Bundle
              </button>
            </div>

            {actionNotice && (
              <p className="fr-muted" role="status" aria-live="polite">
                {actionNotice}
              </p>
            )}

            {patchBundle && (
              <div className="fr-bundle-box">
                <strong>Git Apply Instructions ({patchBundle.filename})</strong>
                <pre className="fr-code-block">
                  {[
                    patchBundle.instructions.branchCmd,
                    patchBundle.instructions.applyAmCmd,
                    patchBundle.instructions.pushCmd,
                  ].join('\n')}
                </pre>
              </div>
            )}

            {exportBundle?.pdfDownloadUrl && (
              <p className="fr-muted">
                PDF download URL:{' '}
                <a
                  href={`${baseUrl}${exportBundle.pdfDownloadUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {exportBundle.pdfFilename}
                </a>
              </p>
            )}

            {prBundle && (
              <div className="fr-bundle-box">
                <strong>
                  PR #{prBundle.number}: {prBundle.title} ({prBundle.headBranch} {'->'}{' '}
                  {prBundle.baseBranch})
                </strong>
                {prBundle.shortTerminalCommand && (
                  <pre className="fr-code-block">{prBundle.shortTerminalCommand}</pre>
                )}
              </div>
            )}
          </section>

          <section className="fr-card" aria-labelledby="fr-commits-heading">
            <div className="fr-section-head">
              <div>
                <h2 id="fr-commits-heading" className="fr-section-title">
                  Atomic Remediation Commits ({visibleCommits.length})
                </h2>
                <p className="fr-muted">
                  Inspect side-by-side diffs and include/exclude individual fixes.
                </p>
              </div>

              <div className="fr-actions">
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() => setSelectedCommitIds(session.commits.map((c) => c.id))}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() => setSelectedCommitIds([])}
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="fr-segmented" role="tablist" aria-label="Filter commits by category">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={categoryFilter === tab.id}
                  className={`fr-segmented__btn${categoryFilter === tab.id ? ' is-active' : ''}`}
                  onClick={() => setCategoryFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="fr-commit-list">
              {visibleCommits.map((commit) => {
                const isSelected = selectedSet.has(commit.id)
                const isExpanded = Boolean(expandedCommitIds[commit.id])
                return (
                  <article
                    key={commit.id}
                    className={`fr-commit-card${isSelected ? ' is-selected' : ''}`}
                  >
                    <div className="fr-commit-head">
                      <label className="fr-commit-check">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleCommitSelection(commit.id)}
                        />
                        <div>
                          <div className="fr-commit-badges">
                            <span className="fr-badge">{commit.categoryLabel}</span>
                            <code>{commit.sha}</code>
                            <code>{commit.ruleId}</code>
                          </div>
                          <h3 className="fr-commit-title">{commit.title}</h3>
                          <p className="fr-muted">{commit.summary}</p>
                        </div>
                      </label>

                      <button
                        type="button"
                        className="fr-btn-secondary"
                        aria-expanded={isExpanded}
                        onClick={() => toggleCommitExpanded(commit.id)}
                      >
                        {isExpanded ? 'Hide Diff' : 'View Side-by-Side Diff'}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="fr-commit-body">
                        <CommitDiffViewer
                          diff={commit.diff}
                          additions={commit.additions}
                          deletions={commit.deletions}
                        />
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
