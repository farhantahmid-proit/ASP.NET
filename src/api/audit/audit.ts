import { apiFetch } from '@/api/client'
import type {
  CreatePullRequestRequest,
  ExportAuditRequest,
  GenerateExecutiveSummaryRequest,
  GeneratePatchRequest,
  RunGroundingRequest,
  StartAuditRequest,
  StartLhrAuditRequest,
} from '../$types/audit/request'
import type {
  AuditStatusResponse,
  EngineInfoResponse,
  ExecutiveSummaryResponse,
  FresnelConfigResponse,
  GroundingResponse,
  PatchBundleResponse,
  PullRequestResponse,
  ReportExportResponse,
  StartAuditResponse,
} from '../$types/audit/response'
import { apiFetchBlob, apiFetchText } from '@/api/client'

function buildCommitQuery(selectedCommitIds?: string[]): string {
  if (!selectedCommitIds || selectedCommitIds.length === 0) return ''
  return `?commits=${encodeURIComponent(selectedCommitIds.join(','))}`
}

export function fetchEngineInfo(): Promise<EngineInfoResponse> {
  return apiFetch<EngineInfoResponse>('/api/engine/info', {
    fallbackError: 'Unable to load Fresnel engine capabilities.',
  })
}

export function fetchFresnelConfig(): Promise<FresnelConfigResponse> {
  return apiFetch<FresnelConfigResponse>('/api/config', {
    fallbackError: 'Unable to load Fresnel configuration.',
  })
}

export function startAudit(input: StartAuditRequest): Promise<StartAuditResponse> {
  return apiFetch<StartAuditResponse>('/api/audit/start', {
    method: 'POST',
    includeClientId: true,
    body: JSON.stringify(input),
    fallbackError: 'Unable to start repository audit.',
  })
}

export function startLhrAudit(input: StartLhrAuditRequest): Promise<StartAuditResponse> {
  const { sessionId, ...payload } = input
  return apiFetch<StartAuditResponse>(
    `/api/audit/${encodeURIComponent(sessionId)}/lhr-start`,
    {
      method: 'POST',
      includeClientId: true,
      body: JSON.stringify(payload),
      fallbackError: 'Unable to start Lighthouse LHR correlation audit.',
    },
  )
}

export function fetchAuditStatus(sessionId: string): Promise<AuditStatusResponse> {
  return apiFetch<AuditStatusResponse>(
    `/api/audit/${encodeURIComponent(sessionId)}/status`,
    {
      includeClientId: true,
      fallbackError: 'Unable to load audit session status.',
    },
  )
}

export function fastForwardAudit(sessionId: string): Promise<AuditStatusResponse> {
  return apiFetch<AuditStatusResponse>(
    `/api/audit/${encodeURIComponent(sessionId)}/fast-forward`,
    {
      method: 'POST',
      includeClientId: true,
      body: JSON.stringify({}),
      fallbackError: 'Unable to fast-forward audit session.',
    },
  )
}

export function fetchAuditPatchDiff(
  sessionId: string,
  selectedCommitIds?: string[],
): Promise<string> {
  return apiFetchText(
    `/api/audit/${encodeURIComponent(sessionId)}/patch.diff${buildCommitQuery(selectedCommitIds)}`,
    {
      includeClientId: true,
      fallbackError: 'Unable to download git patch diff.',
    },
  )
}

export function generateAuditPatch(input: GeneratePatchRequest): Promise<PatchBundleResponse> {
  const { sessionId, selectedCommitIds } = input
  return apiFetch<PatchBundleResponse>(
    `/api/audit/${encodeURIComponent(sessionId)}/patch`,
    {
      method: 'POST',
      includeClientId: true,
      body: JSON.stringify({ selectedCommitIds }),
      fallbackError: 'Unable to build git patch bundle.',
    },
  )
}

export function createAuditPullRequest(
  input: CreatePullRequestRequest,
): Promise<PullRequestResponse> {
  const { sessionId, ...payload } = input
  return apiFetch<PullRequestResponse>(
    `/api/audit/${encodeURIComponent(sessionId)}/pr`,
    {
      method: 'POST',
      includeClientId: true,
      body: JSON.stringify(payload),
      fallbackError: 'Unable to build pull request CLI bundle.',
    },
  )
}

export function downloadAuditExportMarkdown(
  sessionId: string,
  selectedCommitIds?: string[],
): Promise<string> {
  return apiFetchText(
    `/api/audit/${encodeURIComponent(sessionId)}/export.md${buildCommitQuery(selectedCommitIds)}`,
    {
      includeClientId: true,
      fallbackError: 'Unable to download Markdown audit report.',
    },
  )
}

export function downloadAuditExportPdf(
  sessionId: string,
  selectedCommitIds?: string[],
): Promise<Blob> {
  return apiFetchBlob(
    `/api/audit/${encodeURIComponent(sessionId)}/export.pdf${buildCommitQuery(selectedCommitIds)}`,
    {
      includeClientId: true,
      fallbackError: 'Unable to download PDF audit report.',
    },
  )
}

export function exportAuditReport(input: ExportAuditRequest): Promise<ReportExportResponse> {
  const { sessionId, selectedCommitIds } = input
  return apiFetch<ReportExportResponse>(
    `/api/audit/${encodeURIComponent(sessionId)}/export`,
    {
      method: 'POST',
      includeClientId: true,
      body: JSON.stringify({ selectedCommitIds }),
      fallbackError: 'Unable to export audit report bundle.',
    },
  )
}

export function runAuditGrounding(input: RunGroundingRequest): Promise<GroundingResponse> {
  const { sessionId, query } = input
  return apiFetch<GroundingResponse>(
    `/api/audit/${encodeURIComponent(sessionId)}/grounding`,
    {
      method: 'POST',
      includeClientId: true,
      body: JSON.stringify({ query }),
      fallbackError: 'Unable to retrieve web standards grounding references.',
    },
  )
}

export function generateExecutiveSummary(
  input: GenerateExecutiveSummaryRequest,
): Promise<ExecutiveSummaryResponse> {
  const endpoint = input.sessionId
    ? `/api/audit/${encodeURIComponent(input.sessionId)}/executive-summary`
    : '/api/audit/executive-summary'
  return apiFetch<ExecutiveSummaryResponse>(endpoint, {
    method: 'POST',
    includeClientId: true,
    body: JSON.stringify(input),
    fallbackError: 'Unable to generate executive summary.',
  })
}
