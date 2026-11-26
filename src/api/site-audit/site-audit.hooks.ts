import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { runWidgetSiteAudit, startSiteAudit } from './site-audit'
import { siteAuditKeys, siteAuditStatusQueryOptions } from './site-audit.query'

export function useSiteAuditStatus(sessionId: string) {
  return useQuery(siteAuditStatusQueryOptions(sessionId))
}

export function useStartSiteAudit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: startSiteAudit,
    onSuccess: (session) => {
      queryClient.setQueryData(siteAuditKeys.status(session.id), session)
    },
  })
}

export function useRunWidgetSiteAudit() {
  return useMutation({
    mutationFn: runWidgetSiteAudit,
  })
}
