import type {
  AuditSession,
  ExecutiveSummaryResult,
  FresnelLore,
  GroundingResult,
  PatchBundle,
  PullRequestResult,
  ReportExportBundle,
} from '@/types/audit'

export type EngineInfoResponse = {
  engine: Record<string, unknown>
  zeroAi: boolean
  liveLighthouseAvailable: boolean
  chromiumDetected: boolean
}

export type FresnelConfigResponse = {
  brand: string
  zeroAi: boolean
  engineConfig: Record<string, unknown>
  liveLighthouseAvailable: boolean
  lore: FresnelLore
  sampleLhrJson: string
}

export type StartAuditResponse = AuditSession
export type AuditStatusResponse = AuditSession
export type PatchBundleResponse = PatchBundle
export type PullRequestResponse = PullRequestResult
export type ReportExportResponse = ReportExportBundle
export type GroundingResponse = GroundingResult
export type ExecutiveSummaryResponse = ExecutiveSummaryResult
