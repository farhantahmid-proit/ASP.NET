import { queryOptions } from '@tanstack/react-query'
import { fetchSiteAuditStatus } from './site-audit'

export const siteAuditKeys = {
  all: ['fresnel', 'site-audit'] as const,
  status: (sessionId: string) => ['fresnel', 'site-audit', 'status', sessionId] as const,
}

export function siteAuditStatusQueryOptions(sessionId: string) {
  return queryOptions({
    queryKey: siteAuditKeys.status(sessionId),
    queryFn: () => fetchSiteAuditStatus(sessionId),
    enabled: Boolean(sessionId),
  })
}
