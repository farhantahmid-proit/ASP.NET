export type GitSshStatusRequest = {
  probe?: boolean
  githubToken?: string
}

export type GitPushRequest = {
  repoUrl: string
  headBranch?: string
  githubToken?: string
}

export type GitLsRemoteDiagnosticRequest = {
  repoUrl: string
  protocol?: 'auto' | 'ssh' | 'https'
  headBranch?: string
  githubToken?: string
}
