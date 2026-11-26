import { useMutation, useQuery } from '@tanstack/react-query'
import { loginWorkspace, refreshWorkspaceSession, registerWorkspace } from './auth'
import { workspaceMeQueryOptions } from './auth.query'

export function useRegisterWorkspace() {
  return useMutation({ mutationFn: registerWorkspace })
}

export function useLoginWorkspace() {
  return useMutation({ mutationFn: loginWorkspace })
}

export function useRefreshWorkspaceSession() {
  return useMutation({ mutationFn: refreshWorkspaceSession })
}

export function useWorkspaceMe(accessToken: string) {
  return useQuery(workspaceMeQueryOptions(accessToken))
}
