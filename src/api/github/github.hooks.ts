import { useQuery } from '@tanstack/react-query'
import { githubRepoIssuesQueryOptions, githubRepoMetaQueryOptions } from './github.query'

export function useGitHubRepoMeta(owner: string, repo: string, githubToken?: string) {
  return useQuery(githubRepoMetaQueryOptions(owner, repo, githubToken))
}

export function useGitHubRepoIssues(owner: string, repo: string) {
  return useQuery(githubRepoIssuesQueryOptions(owner, repo))
}
