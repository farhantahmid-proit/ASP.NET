import { queryOptions } from '@tanstack/react-query'
import { fetchGitSshStatus } from './git'

export const gitKeys = {
  all: ['fresnel', 'git'] as const,
  sshStatus: (probe = false) => ['fresnel', 'git', 'ssh-status', { probe }] as const,
}

export function gitSshStatusQueryOptions(probe = false, githubToken?: string) {
  return queryOptions({
    queryKey: gitKeys.sshStatus(probe),
    queryFn: () => fetchGitSshStatus({ probe, githubToken }),
    staleTime: 60_000,
  })
}
