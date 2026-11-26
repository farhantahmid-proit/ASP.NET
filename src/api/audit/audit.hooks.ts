import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createAuditPullRequest,
  exportAuditReport,
  fastForwardAudit,
  generateAuditPatch,
  generateExecutiveSummary,
  runAuditGrounding,
  startAudit,
  startLhrAudit,
} from './audit'
import {
  auditKeys,
  auditStatusQueryOptions,
  engineInfoQueryOptions,
  fresnelConfigQueryOptions,
} from './audit.query'

export function useEngineInfo() {
  return useQuery(engineInfoQueryOptions())
}

export function useFresnelConfig() {
  return useQuery(fresnelConfigQueryOptions())
}

export function useAuditStatus(sessionId: string) {
  return useQuery(auditStatusQueryOptions(sessionId))
}

export function useStartAudit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: startAudit,
    onSuccess: (session) => {
      queryClient.setQueryData(auditKeys.session(session.id), session)
    },
  })
}

export function useStartLhrAudit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: startLhrAudit,
    onSuccess: (session) => {
      queryClient.setQueryData(auditKeys.session(session.id), session)
    },
  })
}

export function useFastForwardAudit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fastForwardAudit,
    onSuccess: (session) => {
      queryClient.setQueryData(auditKeys.session(session.id), session)
    },
  })
}

export function useGenerateAuditPatch() {
  return useMutation({ mutationFn: generateAuditPatch })
}

export function useCreateAuditPullRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createAuditPullRequest,
    onSuccess: (pr, vars) => {
      queryClient.setQueryData(auditKeys.session(vars.sessionId), (prev) => {
        if (!prev || typeof prev !== 'object') return prev
        return { ...(prev as Record<string, unknown>), pr }
      })
    },
  })
}

export function useExportAuditReport() {
  return useMutation({ mutationFn: exportAuditReport })
}

export function useRunAuditGrounding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: runAuditGrounding,
    onSuccess: (groundingData, vars) => {
      queryClient.setQueryData(auditKeys.session(vars.sessionId), (prev) => {
        if (!prev || typeof prev !== 'object') return prev
        return { ...(prev as Record<string, unknown>), groundingData }
      })
    },
  })
}

export function useGenerateExecutiveSummary() {
  return useMutation({ mutationFn: generateExecutiveSummary })
}
