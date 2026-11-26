import { apiFetch } from '@/api/client'
import type { GitHubSshDiagnosticStatus } from '@/types/audit'
import type {
  GitLsRemoteDiagnosticRequest,
  GitPushRequest,
  GitSshStatusRequest,
} from '../$types/git/request'
import type { GitLsRemoteDiagnosticResult, GitPushResponse } from '../$types/git/response'

const SAFE_GH_SEGMENT_RE = /^[a-zA-Z0-9._-]{1,100}$/

function isSafeSegment(seg: string): boolean {
  return (
    SAFE_GH_SEGMENT_RE.test(seg) &&
    seg !== '.' &&
    seg !== '..' &&
    !seg.startsWith('-') &&
    !seg.includes('..')
  )
}

export function parseAndValidateClientPushUrl(rawUrl: string): {
  valid: boolean
  reason: string | null
  owner: string | null
  repo: string | null
  protocol: 'ssh' | 'https' | null
  normalizedSshUrl: string | null
  normalizedHttpsUrl: string | null
} {
  const trimmed = (rawUrl || '').trim()
  if (!trimmed) {
    return {
      valid: false,
      reason: 'Target push URL is empty. Enter a GitHub SSH or HTTPS repository URL.',
      owner: null,
      repo: null,
      protocol: null,
      normalizedSshUrl: null,
      normalizedHttpsUrl: null,
    }
  }
  if (/[\s\r\n\0'"`$|;&<>\\]/.test(trimmed) || trimmed.startsWith('-')) {
    return {
      valid: false,
      reason: 'Push URL contains illegal whitespace, shell characters, or a leading dash.',
      owner: null,
      repo: null,
      protocol: null,
      normalizedSshUrl: null,
      normalizedHttpsUrl: null,
    }
  }
  if (/^(ext::|file:|ftp:|javascript:|data:)/i.test(trimmed)) {
    return {
      valid: false,
      reason: 'Unsupported Git transport protocol. Use git@github.com:... or https://github.com/...',
      owner: null,
      repo: null,
      protocol: null,
      normalizedSshUrl: null,
      normalizedHttpsUrl: null,
    }
  }

  const scpMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed)
  if (scpMatch && isSafeSegment(scpMatch[1]) && isSafeSegment(scpMatch[2])) {
    const [, owner, repo] = scpMatch
    return {
      valid: true,
      reason: null,
      owner,
      repo,
      protocol: 'ssh',
      normalizedSshUrl: `git@github.com:${owner}/${repo}.git`,
      normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`,
    }
  }

  const sshMatch = /^ssh:\/\/git@github\.com(?::22)?\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed)
  if (sshMatch && isSafeSegment(sshMatch[1]) && isSafeSegment(sshMatch[2])) {
    const [, owner, repo] = sshMatch
    return {
      valid: true,
      reason: null,
      owner,
      repo,
      protocol: 'ssh',
      normalizedSshUrl: `git@github.com:${owner}/${repo}.git`,
      normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`,
    }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol !== 'https:') {
        return {
          valid: false,
          reason: 'Insecure HTTP remote URL detected. GitHub requires HTTPS or SSH.',
          owner: null,
          repo: null,
          protocol: 'https',
          normalizedSshUrl: null,
          normalizedHttpsUrl: null,
        }
      }
      const host = parsed.hostname.toLowerCase()
      if (host !== 'github.com' && host !== 'www.github.com') {
        return {
          valid: false,
          reason: `Unsupported remote host "${parsed.hostname}". Expected github.com.`,
          owner: null,
          repo: null,
          protocol: 'https',
          normalizedSshUrl: null,
          normalizedHttpsUrl: null,
        }
      }
      const segs = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
      if (segs.length !== 2) {
        return {
          valid: false,
          reason:
            'GitHub push URL must target https://github.com/<owner>/<repo> with no extra /tree/ or /blob/ path.',
          owner: null,
          repo: null,
          protocol: 'https',
          normalizedSshUrl: null,
          normalizedHttpsUrl: null,
        }
      }
      const owner = segs[0]
      const repo = segs[1].replace(/\.git$/i, '')
      if (isSafeSegment(owner) && isSafeSegment(repo)) {
        return {
          valid: true,
          reason: null,
          owner,
          repo,
          protocol: 'https',
          normalizedSshUrl: `git@github.com:${owner}/${repo}.git`,
          normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`,
        }
      }
    } catch {
      // fall through to invalid
    }
  }

  const shortMatch = /^([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed)
  if (shortMatch && isSafeSegment(shortMatch[1]) && isSafeSegment(shortMatch[2])) {
    const [, owner, repo] = shortMatch
    return {
      valid: true,
      reason: null,
      owner,
      repo,
      protocol: 'https',
      normalizedSshUrl: `git@github.com:${owner}/${repo}.git`,
      normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`,
    }
  }

  return {
    valid: false,
    reason:
      'Invalid GitHub push URL format. Expected git@github.com:<owner>/<repo>.git or https://github.com/<owner>/<repo>.git.',
    owner: null,
    repo: null,
    protocol: null,
    normalizedSshUrl: null,
    normalizedHttpsUrl: null,
  }
}

export function fetchGitSshStatus(
  input: GitSshStatusRequest = {},
): Promise<GitHubSshDiagnosticStatus> {
  const query = input.probe ? '?probe=1' : ''
  return apiFetch<GitHubSshDiagnosticStatus>(`/api/git/ssh-status${query}`, {
    accessToken: input.githubToken,
    fallbackError: 'Unable to inspect local GitHub SSH readiness.',
  })
}

export function verifyOrPushBranch(input: GitPushRequest): Promise<GitPushResponse> {
  return apiFetch<GitPushResponse>('/api/git/push', {
    method: 'POST',
    body: JSON.stringify(input),
    fallbackError: 'Unable to verify remote branch push readiness.',
  })
}

export function runGitLsRemoteDiagnostic(
  input: GitLsRemoteDiagnosticRequest,
): Promise<GitLsRemoteDiagnosticResult> {
  return apiFetch<GitLsRemoteDiagnosticResult>('/api/git/ls-remote-diagnostic', {
    method: 'POST',
    accessToken: input.githubToken,
    body: JSON.stringify(input),
    fallbackError: 'Unable to execute git ls-remote diagnostic.',
  })
}
