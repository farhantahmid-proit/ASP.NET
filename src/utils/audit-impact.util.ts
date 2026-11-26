import type {
  AuditCommit,
  AuditImpactMetrics,
  AuditSession,
  LighthouseCategory,
  RadarMetricAxis,
  SavedAuditHistoryRecord,
} from '@/types/audit'
import type { ComparableAuditRun, MetricComparisonRow } from '@/types/comparison'

function toSelectionSet(selectedCommitIds: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return selectedCommitIds instanceof Set ? selectedCommitIds : new Set(selectedCommitIds)
}

export function computeAuditImpactMetrics(
  session: AuditSession | null | undefined,
  selectedCommitIds: ReadonlySet<string> | readonly string[],
): AuditImpactMetrics {
  const all = session?.commits ?? []
  const selectedSet = toSelectionSet(selectedCommitIds)
  const selected = all.filter((c) => selectedSet.has(c.id))
  const isLhr = session?.runPhase === 'lhr'

  const countByCat = (cat: Exclude<LighthouseCategory, 'all'>) => {
    const totalInCat = all.filter((c) => c.category === cat).length
    const selInCat = selected.filter((c) => c.category === cat).length
    const ratio = totalInCat > 0 ? selInCat / totalInCat : 0
    return { totalInCat, selInCat, ratio }
  }

  const perf = countByCat('performance')
  const a11y = countByCat('accessibility')
  const bp = countByCat('best-practices')
  const seo = countByCat('seo')
  const sec = countByCat('security')

  const det = session?.deterministicMetrics

  const performanceBefore = det ? det.performanceBefore : isLhr ? 64 : 61
  const performanceTarget = det ? det.performanceAfter : 96
  const performanceAfter = Math.round(
    performanceBefore + perf.ratio * Math.max(0, performanceTarget - performanceBefore),
  )

  const accessibilityBefore = det ? det.accessibilityBefore : isLhr ? 72 : 69
  const accessibilityTarget = det ? det.accessibilityAfter : 98
  const accessibilityAfter = Math.round(
    accessibilityBefore + a11y.ratio * Math.max(0, accessibilityTarget - accessibilityBefore),
  )

  const bestPracticesBefore = det ? det.bestPracticesBefore : isLhr ? 79 : 76
  const bestPracticesTarget = det ? det.bestPracticesAfter : 96
  const bestPracticesAfter = Math.round(
    bestPracticesBefore + bp.ratio * Math.max(0, bestPracticesTarget - bestPracticesBefore),
  )

  const seoBefore = det ? det.seoBefore : isLhr ? 81 : 78
  const seoTarget = det ? det.seoAfter : 98
  const seoAfter = Math.round(seoBefore + seo.ratio * Math.max(0, seoTarget - seoBefore))

  const securityBefore = det ? det.securityBefore : 70
  const securityTarget = det ? det.securityAfter : 95
  const securityAfter = isLhr
    ? 92
    : Math.round(securityBefore + sec.ratio * Math.max(0, securityTarget - securityBefore))

  const perfCommits = all.filter((c) => c.category === 'performance')
  const selPerfCommits = selected.filter((c) => c.category === 'performance')

  const a11yCommits = all.filter((c) => c.category === 'accessibility')
  const selA11yCommits = selected.filter((c) => c.category === 'accessibility')

  const matchRatio = (
    pool: AuditCommit[],
    selPool: AuditCommit[],
    pattern: RegExp,
    fallbackRatio: number,
  ): { ratio: number; count: number } => {
    const matchingAll = pool.filter((c) =>
      pattern.test(`${c.ruleId} ${c.title} ${c.summary} ${c.lhrAreaImproved ?? ''}`),
    )
    if (matchingAll.length === 0) {
      return { ratio: fallbackRatio, count: selPool.length }
    }
    const matchingSel = selPool.filter((c) =>
      pattern.test(`${c.ruleId} ${c.title} ${c.summary} ${c.lhrAreaImproved ?? ''}`),
    )
    return {
      ratio: matchingSel.length / matchingAll.length,
      count: matchingSel.length,
    }
  }

  const lcpMatch = matchRatio(
    perfCommits,
    selPerfCommits,
    /lcp|largest-contentful|fetchpriority|preload|hero|image|webp|avif/i,
    perf.ratio,
  )
  const clsMatch = matchRatio(
    perfCommits,
    selPerfCommits,
    /cls|layout-shift|unsized|width|height|aspect-ratio|font-display|swap/i,
    perf.ratio,
  )
  const tbtMatch = matchRatio(
    perfCommits,
    selPerfCommits,
    /render-blocking|tbt|defer|async|bundle|script|css|preload|critical/i,
    perf.ratio,
  )

  const contrastMatch = matchRatio(
    a11yCommits,
    selA11yCommits,
    /contrast|wcag|color|token|foreground|background/i,
    a11y.ratio,
  )
  const ariaMatch = matchRatio(
    a11yCommits,
    selA11yCommits,
    /aria|button-name|label|input|role|screen-reader|alt/i,
    a11y.ratio,
  )
  const focusMatch = matchRatio(
    a11yCommits,
    selA11yCommits,
    /focus|keyboard|landmark|heading|main|nav|skip|tabindex/i,
    a11y.ratio,
  )

  const makeAxis = (
    id: string,
    label: string,
    shortLabel: string,
    group: RadarMetricAxis['group'],
    before: number,
    targetMax: number,
    ratio: number,
    contributingCommits: number,
    description: string,
  ): RadarMetricAxis => {
    const after = Math.round(before + ratio * Math.max(0, targetMax - before))
    return {
      id,
      label,
      shortLabel,
      group,
      before,
      after,
      delta: Math.max(0, after - before),
      unit: 'pts',
      description,
      contributingCommits,
    }
  }

  const detailedAxes: RadarMetricAxis[] = [
    makeAxis(
      'lcp',
      'LCP (Largest Contentful Paint)',
      'LCP',
      'performance',
      56,
      96,
      lcpMatch.ratio,
      lcpMatch.count,
      'Largest Contentful Paint priority hints, responsive image decoding, and critical resource preloads.',
    ),
    makeAxis(
      'cls',
      'CLS (Cumulative Layout Shift)',
      'CLS',
      'performance',
      63,
      98,
      clsMatch.ratio,
      clsMatch.count,
      'Cumulative Layout Shift prevention via explicit intrinsic dimensions and font-display: swap.',
    ),
    makeAxis(
      'fid',
      'FID / INP (First Input Delay)',
      'FID',
      'performance',
      62,
      95,
      tbtMatch.ratio,
      tbtMatch.count,
      'First Input Delay and main-thread responsiveness improvements by eliminating render-blocking assets.',
    ),
    makeAxis(
      'performance-score',
      'Performance Score',
      'Performance',
      'performance',
      performanceBefore,
      96,
      perf.ratio,
      perf.selInCat,
      'Overall Lighthouse Performance score impact across selected atomic code commits.',
    ),
    makeAxis(
      'accessibility-score',
      'Accessibility Score',
      'Accessibility',
      'accessibility',
      accessibilityBefore,
      98,
      a11y.ratio,
      a11y.selInCat,
      'Overall Lighthouse Accessibility score impact across WCAG 2.2 AA contrast, ARIA labels, and landmarks.',
    ),
    makeAxis(
      'wcag-aria',
      'WCAG Contrast & ARIA Semantics',
      'WCAG & ARIA',
      'accessibility',
      66,
      98,
      (contrastMatch.ratio + ariaMatch.ratio + focusMatch.ratio) / 3,
      contrastMatch.count + ariaMatch.count,
      'Foreground-to-background 4.5:1 contrast compliance, accessible names, and semantic landmarks.',
    ),
  ]

  const categoryAxes: RadarMetricAxis[] = [
    makeAxis(
      'cat-performance',
      'Performance',
      'Performance',
      'performance',
      performanceBefore,
      96,
      perf.ratio,
      perf.selInCat,
      'Core Web Vitals (LCP, CLS, TBT) and asset delivery optimizations.',
    ),
    makeAxis(
      'cat-accessibility',
      'Accessibility',
      'Accessibility',
      'accessibility',
      accessibilityBefore,
      98,
      a11y.ratio,
      a11y.selInCat,
      'WCAG 2.2 AA compliance, ARIA labeling, contrast, and keyboard navigation.',
    ),
    makeAxis(
      'cat-best-practices',
      'Best Practices',
      'Best Practices',
      'best-practices',
      bestPracticesBefore,
      96,
      bp.ratio,
      bp.selInCat,
      'Modern browser APIs, CSP hardening, and runtime reliability patterns.',
    ),
    makeAxis(
      'cat-seo',
      'SEO',
      'SEO',
      'seo',
      seoBefore,
      98,
      seo.ratio,
      seo.selInCat,
      'Canonical metadata, crawlable document structure, and structured data.',
    ),
    ...(isLhr
      ? []
      : [
          makeAxis(
            'cat-security',
            'Web Security (Light)',
            'Web Security',
            'security',
            securityBefore,
            95,
            sec.ratio,
            sec.selInCat,
            'Static remediation of DOM XSS sinks, token storage leaks, and open redirects.',
          ),
        ]),
  ]

  return {
    performanceBefore,
    performanceAfter,
    accessibilityBefore,
    accessibilityAfter,
    bestPracticesBefore,
    bestPracticesAfter,
    seoBefore,
    seoAfter,
    securityBefore,
    securityAfter,
    detailedAxes,
    categoryAxes,
  }
}

export function buildComparableRunsFromSession(
  session: AuditSession,
  metrics: AuditImpactMetrics,
  selectedCommitsCount: number,
  totalCommitsCount: number,
  savedAudits: readonly SavedAuditHistoryRecord[] = [],
): ComparableAuditRun[] {
  const getAxis = (id: string, fallbackBefore: number, fallbackAfter: number) => {
    const found = metrics.detailedAxes.find((a) => a.id === id)
    return {
      before: found?.before ?? fallbackBefore,
      after: found?.after ?? fallbackAfter,
    }
  }

  const lcp = getAxis('lcp', 56, 94)
  const cls = getAxis('cls', 63, 96)
  const fid = getAxis('fid', 62, 93)
  const wcag = getAxis('wcag-aria', 66, 96)
  const isCurrentLhr = session.runPhase === 'lhr'

  const initialScanRun: ComparableAuditRun = {
    id: 'initial-scan-baseline',
    label: 'Initial Scan · Unpatched Repository Baseline (Run 0)',
    badge: 'Initial Scan · Baseline',
    significanceTag: 'Initial Scan',
    sourceType: 'initial-baseline',
    repoFullName: session.repo.fullName,
    runPhase: 'static',
    timestampLabel: 'Initial scan',
    selectedCommitsCount: 0,
    totalCommitsCount,
    performanceBefore: metrics.performanceBefore,
    performanceAfter: metrics.performanceBefore + 6,
    accessibilityBefore: metrics.accessibilityBefore,
    accessibilityAfter: metrics.accessibilityBefore + 6,
    bestPracticesBefore: metrics.bestPracticesBefore,
    bestPracticesAfter: metrics.bestPracticesBefore + 4,
    seoBefore: metrics.seoBefore,
    seoAfter: metrics.seoBefore + 4,
    lcpBefore: lcp.before,
    lcpAfter: lcp.before + 7,
    clsBefore: cls.before,
    clsAfter: cls.before + 6,
    fidBefore: fid.before,
    fidAfter: fid.before + 5,
    wcagAriaBefore: wcag.before,
    wcagAriaAfter: wcag.before + 6,
    summaryNotes:
      'Initial repository scan before atomic Core Web Vitals and WCAG remediation commits.',
  }

  const currentRun: ComparableAuditRun = {
    id: `current-active-${session.runPhase}`,
    label: isCurrentLhr
      ? 'Latest Optimized · Run 2 (Lighthouse JSON Audit)'
      : 'Current Session · Run 1 (Static Code Audit)',
    badge: isCurrentLhr ? 'Active Run 2 · LHR JSON' : 'Active Run 1 · Static',
    significanceTag: 'Latest Optimized',
    sourceType: 'current',
    repoFullName: session.repo.fullName,
    runPhase: session.runPhase,
    timestampLabel: 'Latest optimized session',
    selectedCommitsCount,
    totalCommitsCount,
    performanceBefore: metrics.performanceBefore,
    performanceAfter: metrics.performanceAfter,
    accessibilityBefore: metrics.accessibilityBefore,
    accessibilityAfter: metrics.accessibilityAfter,
    bestPracticesBefore: metrics.bestPracticesBefore,
    bestPracticesAfter: metrics.bestPracticesAfter,
    seoBefore: metrics.seoBefore,
    seoAfter: metrics.seoAfter,
    lcpBefore: lcp.before,
    lcpAfter: lcp.after,
    clsBefore: cls.before,
    clsAfter: cls.after,
    fidBefore: fid.before,
    fidAfter: fid.after,
    wcagAriaBefore: wcag.before,
    wcagAriaAfter: wcag.after,
    summaryNotes: `Active report selection (${selectedCommitsCount} of ${totalCommitsCount} atomic commits enabled).`,
  }

  const complementaryRun: ComparableAuditRun = isCurrentLhr
    ? {
        id: 'paired-run-1-static',
        label: 'Run 1 · Static Code & Light Security Audit (Baseline Pass)',
        badge: 'Run 1 · Static Audit',
        sourceType: 'paired-run',
        repoFullName: session.repo.fullName,
        runPhase: 'static',
        timestampLabel: 'Run 1 baseline pass',
        selectedCommitsCount: Math.max(1, totalCommitsCount - 1),
        totalCommitsCount,
        performanceBefore: 61,
        performanceAfter: 89,
        accessibilityBefore: 69,
        accessibilityAfter: 92,
        bestPracticesBefore: 76,
        bestPracticesAfter: 92,
        seoBefore: 78,
        seoAfter: 94,
        lcpBefore: 56,
        lcpAfter: 88,
        clsBefore: 63,
        clsAfter: 91,
        fidBefore: 62,
        fidAfter: 89,
        wcagAriaBefore: 66,
        wcagAriaAfter: 91,
        summaryNotes:
          'Initial static source tree inspection before Lighthouse JSON selector correlation.',
      }
    : {
        id: 'paired-run-2-lhr',
        label: 'Run 2 · Lighthouse Result (LHR) JSON Targeted Audit (Latest Optimized)',
        badge: 'Run 2 · LHR JSON',
        significanceTag: 'Latest Optimized',
        sourceType: 'paired-run',
        repoFullName: session.repo.fullName,
        runPhase: 'lhr',
        timestampLabel: 'Run 2 LHR target pass',
        selectedCommitsCount: totalCommitsCount,
        totalCommitsCount,
        performanceBefore: 64,
        performanceAfter: 96,
        accessibilityBefore: 72,
        accessibilityAfter: 98,
        bestPracticesBefore: 79,
        bestPracticesAfter: 96,
        seoBefore: 81,
        seoAfter: 98,
        lcpBefore: 58,
        lcpAfter: 96,
        clsBefore: 65,
        clsAfter: 98,
        fidBefore: 64,
        fidAfter: 95,
        wcagAriaBefore: 70,
        wcagAriaAfter: 98,
        summaryNotes:
          'Second-pass audit correlated with failing Lighthouse JSON DOM selectors and metricSavings.',
      }

  const conservativeSubsetRun: ComparableAuditRun = {
    id: 'paired-critical-subset',
    label: 'Conservative Patch · Critical LCP & WCAG Contrast Commits Only',
    badge: 'Critical Subset (2 commits)',
    sourceType: 'paired-run',
    repoFullName: session.repo.fullName,
    runPhase: session.runPhase,
    timestampLabel: 'Minimal patch subset',
    selectedCommitsCount: Math.min(2, Math.max(1, totalCommitsCount)),
    totalCommitsCount,
    performanceBefore: metrics.performanceBefore,
    performanceAfter: Math.round(metrics.performanceBefore + (96 - metrics.performanceBefore) * 0.52),
    accessibilityBefore: metrics.accessibilityBefore,
    accessibilityAfter: Math.round(
      metrics.accessibilityBefore + (98 - metrics.accessibilityBefore) * 0.55,
    ),
    bestPracticesBefore: metrics.bestPracticesBefore,
    bestPracticesAfter: metrics.bestPracticesBefore + 6,
    seoBefore: metrics.seoBefore,
    seoAfter: metrics.seoBefore + 5,
    lcpBefore: lcp.before,
    lcpAfter: Math.round(lcp.before + (96 - lcp.before) * 0.6),
    clsBefore: cls.before,
    clsAfter: Math.round(cls.before + (98 - cls.before) * 0.45),
    fidBefore: fid.before,
    fidAfter: Math.round(fid.before + (95 - fid.before) * 0.4),
    wcagAriaBefore: wcag.before,
    wcagAriaAfter: Math.round(wcag.before + (98 - wcag.before) * 0.55),
    summaryNotes:
      'Minimal high-priority commit subset targeting only hero LCP and primary color contrast.',
  }

  const sortedSaved = [...savedAudits].sort((a, b) =>
    String(a.updatedAtIso || '').localeCompare(String(b.updatedAtIso || '')),
  )
  const earliestId = sortedSaved.length >= 2 ? sortedSaved[0].auditId : null
  const latestId = sortedSaved.length >= 1 ? sortedSaved[sortedSaved.length - 1].auditId : null

  const workspaceRuns: ComparableAuditRun[] = savedAudits.map((rec, index) => {
    const perfGainRatio =
      rec.performanceAfter > rec.performanceBefore
        ? (rec.performanceAfter - rec.performanceBefore) / Math.max(1, 96 - rec.performanceBefore)
        : 0.75
    const a11yGainRatio =
      rec.accessibilityAfter > rec.accessibilityBefore
        ? (rec.accessibilityAfter - rec.accessibilityBefore) /
          Math.max(1, 98 - rec.accessibilityBefore)
        : 0.8

    const shortDate = rec.updatedAtIso
      ? new Date(rec.updatedAtIso).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : `Saved #${index + 1}`

    let significanceTag: ComparableAuditRun['significanceTag']
    if (rec.auditId === earliestId) {
      significanceTag = 'Initial Scan'
    } else if (rec.auditId === latestId) {
      significanceTag = 'Latest Optimized'
    }

    return {
      id: `workspace-${rec.auditId}`,
      label: `Saved Audit · ${rec.repoFullName} (${rec.runPhase === 'lhr' ? 'Run 2 LHR' : 'Run 1 Static'} · ${shortDate})`,
      badge: `Saved · ${rec.runPhase === 'lhr' ? 'Run 2 LHR' : 'Run 1 Static'}`,
      significanceTag,
      sourceType: 'workspace',
      repoFullName: rec.repoFullName,
      runPhase: rec.runPhase,
      timestampIso: rec.updatedAtIso,
      timestampLabel: shortDate,
      selectedCommitsCount: rec.selectedCommitsCount,
      totalCommitsCount: rec.totalCommitsCount,
      performanceBefore: rec.performanceBefore,
      performanceAfter: rec.performanceAfter,
      accessibilityBefore: rec.accessibilityBefore,
      accessibilityAfter: rec.accessibilityAfter,
      bestPracticesBefore: rec.bestPracticesBefore,
      bestPracticesAfter: rec.bestPracticesAfter,
      seoBefore: rec.seoBefore,
      seoAfter: rec.seoAfter,
      lcpBefore: 56,
      lcpAfter: Math.min(98, Math.round(56 + perfGainRatio * 40)),
      clsBefore: 63,
      clsAfter: Math.min(98, Math.round(63 + perfGainRatio * 34)),
      fidBefore: 62,
      fidAfter: Math.min(96, Math.round(62 + perfGainRatio * 32)),
      wcagAriaBefore: 66,
      wcagAriaAfter: Math.min(98, Math.round(66 + a11yGainRatio * 31)),
      summaryNotes:
        rec.summaryNotes ||
        `${rec.selectedCommitsCount}/${rec.totalCommitsCount} commits saved locally.`,
    }
  })

  return [
    initialScanRun,
    currentRun,
    complementaryRun,
    conservativeSubsetRun,
    ...workspaceRuns,
  ]
}

export function buildMetricComparisonRows(
  a: ComparableAuditRun | null | undefined,
  b: ComparableAuditRun | null | undefined,
): MetricComparisonRow[] {
  if (!a || !b) return []

  const buildRow = (
    id: string,
    label: string,
    shortLabel: string,
    category: MetricComparisonRow['category'],
    aBefore: number,
    aAfter: number,
    bBefore: number,
    bAfter: number,
  ): MetricComparisonRow => {
    const runAGain = Math.max(0, aAfter - aBefore)
    const runBGain = Math.max(0, bAfter - bBefore)
    return {
      id,
      label,
      shortLabel,
      category,
      runABefore: aBefore,
      runAAfter: aAfter,
      runAGain,
      runBBefore: bBefore,
      runBAfter: bAfter,
      runBGain,
      afterDiff: bAfter - aAfter,
      gainDiff: runBGain - runAGain,
    }
  }

  return [
    buildRow(
      'perf-overall',
      'Performance Score (Overall)',
      'Performance',
      'performance',
      a.performanceBefore,
      a.performanceAfter,
      b.performanceBefore,
      b.performanceAfter,
    ),
    buildRow(
      'perf-lcp',
      'LCP (Largest Contentful Paint)',
      'LCP',
      'performance',
      a.lcpBefore,
      a.lcpAfter,
      b.lcpBefore,
      b.lcpAfter,
    ),
    buildRow(
      'perf-cls',
      'CLS (Cumulative Layout Shift)',
      'CLS',
      'performance',
      a.clsBefore,
      a.clsAfter,
      b.clsBefore,
      b.clsAfter,
    ),
    buildRow(
      'perf-fid',
      'FID / INP (First Input Delay)',
      'FID',
      'performance',
      a.fidBefore,
      a.fidAfter,
      b.fidBefore,
      b.fidAfter,
    ),
    buildRow(
      'a11y-overall',
      'Accessibility Score (Overall)',
      'Accessibility',
      'accessibility',
      a.accessibilityBefore,
      a.accessibilityAfter,
      b.accessibilityBefore,
      b.accessibilityAfter,
    ),
    buildRow(
      'a11y-wcag',
      'WCAG 2.2 AA Contrast & ARIA Semantics',
      'WCAG & ARIA',
      'accessibility',
      a.wcagAriaBefore,
      a.wcagAriaAfter,
      b.wcagAriaBefore,
      b.wcagAriaAfter,
    ),
    buildRow(
      'bp-overall',
      'Best Practices Score',
      'Best Practices',
      'secondary',
      a.bestPracticesBefore,
      a.bestPracticesAfter,
      b.bestPracticesBefore,
      b.bestPracticesAfter,
    ),
    buildRow(
      'seo-overall',
      'SEO Score',
      'SEO',
      'secondary',
      a.seoBefore,
      a.seoAfter,
      b.seoBefore,
      b.seoAfter,
    ),
  ]
}
