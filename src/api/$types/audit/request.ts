import type { AuditMode, DeterministicAuditMetrics, LighthouseCategory } from '@/types/audit'

export type StartAuditRequest = {
  repoUrl?: string
  mode?: AuditMode
  branch?: string
  categories?: Array<Exclude<LighthouseCategory, 'all'>>
}

export type StartLhrAuditRequest = {
  sessionId: string
  lhrJson: string
  mode?: AuditMode
  repoUrl?: string
}

export type GeneratePatchRequest = {
  sessionId: string
  selectedCommitIds?: string[]
}

export type CreatePullRequestRequest = {
  sessionId: string
  selectedCommitIds?: string[]
  headBranch?: string
  prTitle?: string
}

export type ExportAuditRequest = {
  sessionId: string
  selectedCommitIds?: string[]
}

export type RunGroundingRequest = {
  sessionId: string
  query?: string
}

export type ExecutiveSummaryCommitInput = {
  category: string
  categoryLabel: string
  title: string
  summary: string
  ruleId: string
}

export type GenerateExecutiveSummaryRequest = {
  sessionId?: string
  repoFullName?: string
  branch?: string
  runPhase?: string
  metrics?: DeterministicAuditMetrics | null
  commits?: ExecutiveSummaryCommitInput[]
}
