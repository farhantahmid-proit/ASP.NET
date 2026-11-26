import { useMutation, useQuery } from '@tanstack/react-query'
import { runGitLsRemoteDiagnostic, verifyOrPushBranch } from './git'
import { gitSshStatusQueryOptions } from './git.query'

export function useGitSshStatus(probe = false, githubToken?: string) {
  return useQuery(gitSshStatusQueryOptions(probe, githubToken))
}

export function useVerifyOrPushBranch() {
  return useMutation({ mutationFn: verifyOrPushBranch })
}

export function useGitLsRemoteDiagnostic() {
  return useMutation({ mutationFn: runGitLsRemoteDiagnostic })
}
