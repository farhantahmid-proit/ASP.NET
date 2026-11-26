import type { AuditRunPhase } from './audit'

export interface ComparableAuditRun {
  id: string
  label: string
  badge: string
  significanceTag?: 'Initial Scan' | 'Latest Optimized'
  sourceType: 'initial-baseline' | 'current' | 'paired-run' | 'workspace'
  repoFullName: string
  runPhase: AuditRunPhase
  timestampIso?: string
  timestampLabel: string
  selectedCommitsCount: number
  totalCommitsCount: number
  performanceBefore: number
  performanceAfter: number
  accessibilityBefore: number
  accessibilityAfter: number
  bestPracticesBefore: number
  bestPracticesAfter: number
  seoBefore: number
  seoAfter: number
  lcpBefore: number
  lcpAfter: number
  clsBefore: number
  clsAfter: number
  fidBefore: number
  fidAfter: number
  wcagAriaBefore: number
  wcagAriaAfter: number
  summaryNotes: string
}

export interface MetricComparisonRow {
  id: string
  label: string
  shortLabel: string
  category: 'performance' | 'accessibility' | 'secondary'
  runABefore: number
  runAAfter: number
  runAGain: number
  runBBefore: number
  runBAfter: number
  runBGain: number
  afterDiff: number
  gainDiff: number
}
