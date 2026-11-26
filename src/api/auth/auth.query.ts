import { queryOptions } from '@tanstack/react-query'
import { fetchWorkspaceMe } from './auth'

export const authKeys = {
  all: ['fresnel', 'auth'] as const,
  me: (accessToken: string) => ['fresnel', 'auth', 'me', accessToken] as const,
}

export function workspaceMeQueryOptions(accessToken: string) {
  return queryOptions({
    queryKey: authKeys.me(accessToken),
    queryFn: () => fetchWorkspaceMe(accessToken),
    enabled: Boolean(accessToken),
    staleTime: 60_000,
    retry: false,
  })
}
