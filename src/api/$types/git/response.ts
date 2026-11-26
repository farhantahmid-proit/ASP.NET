import type { GitHubSshDiagnosticStatus } from '@/types/audit'

export type GitPushRootCause =
  | 'ready'
  | 'invalid_push_url'
  | 'missing_ssh_keys'
  | 'incorrect_permissions'

export interface GitDiagnosticResolutionStep {
  title: string
  command: string
  detail: string
}

export interface GitLsRemoteDiagnosticResult {
  ok: boolean
  rootCause: GitPushRootCause
  headline: string
  summary: string
  commandExecuted: string
  protocolUsed: 'ssh' | 'https' | 'unknown'
  targetUrl: string
  normalizedSshUrl: string | null
  normalizedHttpsUrl: string | null
  refsCount: number
  defaultBranch: string | null
  stderr: string
  sshStatus: GitHubSshDiagnosticStatus | null
  apiPermissions: {
    accessible: boolean
    statusCode: number
    defaultBranch?: string
    private: boolean | null
    push: boolean | null
    admin: boolean | null
  } | null
  resolutionSteps: GitDiagnosticResolutionStep[]
  checkedAtIso: string
}

export interface GitPushResponse {
  success: boolean
  message?: string
  error?: string
  errorCode?: string
  details?: string
  branch?: string
  repoUrl?: string
  sshStatus?: GitHubSshDiagnosticStatus
}
