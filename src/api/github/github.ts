import { apiFetch } from '@/api/client'
import type { GitHubRepoQueryRequest } from '../$types/github/request'
import type { GitHubRepoIssuesResponse, GitHubRepoRealtimeStats } from '../$types/github/response'

export function fetchGitHubRepoMeta(
  input: GitHubRepoQueryRequest,
): Promise<GitHubRepoRealtimeStats> {
  const params = new URLSearchParams({
    owner: input.owner,
    repo: input.repo,
  })
  return apiFetch<GitHubRepoRealtimeStats>(`/api/github/repo-meta?${params.toString()}`, {
    accessToken: input.githubToken,
    fallbackError: 'Unable to fetch GitHub repository metadata.',
  })
}

export function fetchGitHubRepoIssues(
  input: Omit<GitHubRepoQueryRequest, 'githubToken'>,
): Promise<GitHubRepoIssuesResponse> {
  const params = new URLSearchParams({
    owner: input.owner,
    repo: input.repo,
  })
  return apiFetch<GitHubRepoIssuesResponse>(`/api/github/repo-issues?${params.toString()}`, {
    fallbackError: 'Unable to fetch GitHub repository issues.',
  })
}
