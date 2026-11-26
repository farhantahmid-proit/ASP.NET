import { apiFetch } from '@/api/client'
import type { WorkspaceLoginRequest, WorkspaceRegistrationRequest } from '../$types/auth/request'
import type { WorkspaceAuthResponse, WorkspaceRegistrationResponse } from '../$types/auth/response'

export function registerWorkspace(
  input: WorkspaceRegistrationRequest,
): Promise<WorkspaceRegistrationResponse> {
  return apiFetch<WorkspaceRegistrationResponse>('/api/workspaces/register', {
    method: 'POST',
    body: JSON.stringify(input),
    fallbackError: 'We could not create your workspace. Please try again.',
  })
}

export function loginWorkspace(input: WorkspaceLoginRequest): Promise<WorkspaceAuthResponse> {
  return apiFetch<WorkspaceAuthResponse>('/api/workspaces/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
    fallbackError: 'We could not sign you in. Please try again.',
  })
}

export function refreshWorkspaceSession(refreshToken: string): Promise<WorkspaceAuthResponse> {
  return apiFetch<WorkspaceAuthResponse>('/api/workspaces/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
    fallbackError: 'Your session expired. Please sign in again.',
  })
}
