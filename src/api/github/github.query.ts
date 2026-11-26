import { queryOptions } from '@tanstack/react-query'
import { fetchGitHubRepoIssues, fetchGitHubRepoMeta } from './github'

export const githubKeys = {
  all: ['fresnel', 'github'] as const,
  repoMeta: (owner: string, repo: string) =>
    ['fresnel', 'github', 'repo-meta', owner, repo] as const,
  repoIssues: (owner: string, repo: string) =>
    ['fresnel', 'github', 'repo-issues', owner, repo] as const,
}

export function githubRepoMetaQueryOptions(owner: string, repo: string, githubToken?: string) {
  return queryOptions({
    queryKey: githubKeys.repoMeta(owner, repo),
    queryFn: () => fetchGitHubRepoMeta({ owner, repo, githubToken }),
    enabled: Boolean(owner && repo),
    staleTime: 60_000,
  })
}

export function githubRepoIssuesQueryOptions(owner: string, repo: string) {
  return queryOptions({
    queryKey: githubKeys.repoIssues(owner, repo),
    queryFn: () => fetchGitHubRepoIssues({ owner, repo }),
    enabled: Boolean(owner && repo),
    staleTime: 60_000,
  })
}
