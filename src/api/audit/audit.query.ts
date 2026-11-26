import { queryOptions } from '@tanstack/react-query'
import { fetchAuditStatus, fetchEngineInfo, fetchFresnelConfig } from './audit'

export const auditKeys = {
  all: ['fresnel', 'audit'] as const,
  engineInfo: () => ['fresnel', 'audit', 'engine-info'] as const,
  config: () => ['fresnel', 'audit', 'config'] as const,
  sessions: () => ['fresnel', 'audit', 'session'] as const,
  session: (sessionId: string) => ['fresnel', 'audit', 'session', sessionId] as const,
}

export function engineInfoQueryOptions() {
  return queryOptions({
    queryKey: auditKeys.engineInfo(),
    queryFn: fetchEngineInfo,
    staleTime: 60_000,
  })
}

export function fresnelConfigQueryOptions() {
  return queryOptions({
    queryKey: auditKeys.config(),
    queryFn: fetchFresnelConfig,
    staleTime: 5 * 60_000,
  })
}

export function auditStatusQueryOptions(sessionId: string) {
  return queryOptions({
    queryKey: auditKeys.session(sessionId),
    queryFn: () => fetchAuditStatus(sessionId),
    enabled: Boolean(sessionId),
  })
}
