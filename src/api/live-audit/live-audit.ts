import { apiFetch } from '@/api/client'
import type { RunLiveLighthouseRequest, RunPageSpeedRequest } from '../$types/live-audit/request'
import type { LiveLighthouseResponse, PageSpeedAuditResult } from '../$types/live-audit/response'

export function runPageSpeedAudit(input: RunPageSpeedRequest): Promise<PageSpeedAuditResult> {
  return apiFetch<PageSpeedAuditResult>('/api/audit/pagespeed', {
    method: 'POST',
    includeClientId: true,
    body: JSON.stringify(input),
    fallbackError: 'Unable to run Google PageSpeed Insights audit.',
  })
}

export function runLiveLighthouse(input: RunLiveLighthouseRequest): Promise<LiveLighthouseResponse> {
  const { sessionId, targetUrl, strategy } = input
  return apiFetch<LiveLighthouseResponse>(
    `/api/audit/${encodeURIComponent(sessionId || 'oss-live')}/lighthouse-live`,
    {
      method: 'POST',
      includeClientId: true,
      body: JSON.stringify({ targetUrl, strategy }),
      fallbackError: 'Unable to run live Lighthouse audit on target URL.',
    },
  )
}
