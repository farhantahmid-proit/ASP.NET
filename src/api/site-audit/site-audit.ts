import { apiFetch, apiFetchText, getAuditClientId, getFresnelApiBaseUrl } from '@/api/client'
import type { RunWidgetSiteAuditRequest, StartSiteAuditRequest } from '../$types/site-audit/request'
import type { SiteAuditSession, WidgetSiteAuditResponse } from '../$types/site-audit/response'

export function startSiteAudit(input: StartSiteAuditRequest): Promise<SiteAuditSession> {
  return apiFetch<SiteAuditSession>('/api/audit/site/start', {
    method: 'POST',
    includeClientId: true,
    body: JSON.stringify(input),
    fallbackError: 'Unable to start All-in-One Site Audit.',
  })
}

export function fetchSiteAuditStatus(sessionId: string): Promise<SiteAuditSession> {
  return apiFetch<SiteAuditSession>(`/api/audit/site/${encodeURIComponent(sessionId)}/status`, {
    includeClientId: true,
    fallbackError: 'Unable to load site audit session status.',
  })
}

export function getSiteCrawlCsvDownloadUrl(sessionId: string): string {
  const base = getFresnelApiBaseUrl()
  const cid = encodeURIComponent(getAuditClientId())
  return `${base}/api/audit/site/${encodeURIComponent(sessionId)}/export.csv?cid=${cid}`
}

export function fetchSiteCrawlCsv(sessionId: string): Promise<string> {
  return apiFetchText(`/api/audit/site/${encodeURIComponent(sessionId)}/export.csv`, {
    includeClientId: true,
    fallbackError: 'Unable to download site crawl CSV.',
  })
}

export function runWidgetSiteAudit(
  input: RunWidgetSiteAuditRequest,
): Promise<WidgetSiteAuditResponse> {
  return apiFetch<WidgetSiteAuditResponse>(
    `/api/widget/${encodeURIComponent(input.publicKey)}/audit`,
    {
      method: 'POST',
      body: JSON.stringify({ targetUrl: input.targetUrl }),
      fallbackError: 'Unable to run live widget audit for this URL.',
    },
  )
}
