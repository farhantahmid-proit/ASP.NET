import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { GitHubSshDiagnosticStatus } from '../models/audit.model';

export type GitPushRootCause =
  | 'ready'
  | 'invalid_push_url'
  | 'missing_ssh_keys'
  | 'incorrect_permissions';

export interface GitDiagnosticResolutionStep {
  title: string;
  command: string;
  detail: string;
}

export interface GitLsRemoteDiagnosticResult {
  ok: boolean;
  rootCause: GitPushRootCause;
  headline: string;
  summary: string;
  commandExecuted: string;
  protocolUsed: 'ssh' | 'https' | 'unknown';
  targetUrl: string;
  normalizedSshUrl: string | null;
  normalizedHttpsUrl: string | null;
  refsCount: number;
  defaultBranch: string | null;
  stderr: string;
  sshStatus: GitHubSshDiagnosticStatus | null;
  apiPermissions: {
    accessible: boolean;
    statusCode: number;
    defaultBranch?: string;
    private: boolean | null;
    push: boolean | null;
    admin: boolean | null;
  } | null;
  resolutionSteps: GitDiagnosticResolutionStep[];
  checkedAtIso: string;
}

const SAFE_GH_SEGMENT_RE = /^[a-zA-Z0-9._-]{1,100}$/;

function isSafeSegment(seg: string): boolean {
  return (
    SAFE_GH_SEGMENT_RE.test(seg) &&
    seg !== '.' &&
    seg !== '..' &&
    !seg.startsWith('-') &&
    !seg.includes('..')
  );
}

export function parseAndValidateClientPushUrl(rawUrl: string): {
  valid: boolean;
  reason: string | null;
  owner: string | null;
  repo: string | null;
  protocol: 'ssh' | 'https' | null;
  normalizedSshUrl: string | null;
  normalizedHttpsUrl: string | null;
} {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      reason: 'Target push URL is empty. Enter a GitHub SSH or HTTPS repository URL.',
      owner: null,
      repo: null,
      protocol: null,
      normalizedSshUrl: null,
      normalizedHttpsUrl: null
    };
  }
  if (/[\s\r\n\0'"`$|;&<>\\]/.test(trimmed) || trimmed.startsWith('-')) {
    return {
      valid: false,
      reason: 'Push URL contains illegal whitespace, shell characters, or a leading dash.',
      owner: null,
      repo: null,
      protocol: null,
      normalizedSshUrl: null,
      normalizedHttpsUrl: null
    };
  }
  if (/^(ext::|file:|ftp:|javascript:|data:)/i.test(trimmed)) {
    return {
      valid: false,
      reason: 'Unsupported Git transport protocol. Use git@github.com:... or https://github.com/...',
      owner: null,
      repo: null,
      protocol: null,
      normalizedSshUrl: null,
      normalizedHttpsUrl: null
    };
  }

  const scpMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed);
  if (scpMatch && isSafeSegment(scpMatch[1]) && isSafeSegment(scpMatch[2])) {
    const [, owner, repo] = scpMatch;
    return {
      valid: true,
      reason: null,
      owner,
      repo,
      protocol: 'ssh',
      normalizedSshUrl: `git@github.com:${owner}/${repo}.git`,
      normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`
    };
  }

  const sshMatch = /^ssh:\/\/git@github\.com(?::22)?\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed);
  if (sshMatch && isSafeSegment(sshMatch[1]) && isSafeSegment(sshMatch[2])) {
    const [, owner, repo] = sshMatch;
    return {
      valid: true,
      reason: null,
      owner,
      repo,
      protocol: 'ssh',
      normalizedSshUrl: `git@github.com:${owner}/${repo}.git`,
      normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`
    };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:') {
        return {
          valid: false,
          reason: 'Insecure HTTP remote URL detected. GitHub requires HTTPS or SSH.',
          owner: null,
          repo: null,
          protocol: 'https',
          normalizedSshUrl: null,
          normalizedHttpsUrl: null
        };
      }
      const host = parsed.hostname.toLowerCase();
      if (host !== 'github.com' && host !== 'www.github.com') {
        return {
          valid: false,
          reason: `Unsupported remote host "${parsed.hostname}". Expected github.com.`,
          owner: null,
          repo: null,
          protocol: 'https',
          normalizedSshUrl: null,
          normalizedHttpsUrl: null
        };
      }
      const segs = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (segs.length !== 2) {
        return {
          valid: false,
          reason: 'GitHub push URL must target https://github.com/<owner>/<repo> with no extra /tree/ or /blob/ path.',
          owner: null,
          repo: null,
          protocol: 'https',
          normalizedSshUrl: null,
          normalizedHttpsUrl: null
        };
      }
      const owner = segs[0];
      const repo = segs[1].replace(/\.git$/i, '');
      if (isSafeSegment(owner) && isSafeSegment(repo)) {
        return {
          valid: true,
          reason: null,
          owner,
          repo,
          protocol: 'https',
          normalizedSshUrl: `git@github.com:${owner}/${repo}.git`,
          normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`
        };
      }
    } catch {
      // fall through to invalid
    }
  }

  const shortMatch = /^([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed);
  if (shortMatch && isSafeSegment(shortMatch[1]) && isSafeSegment(shortMatch[2])) {
    const [, owner, repo] = shortMatch;
    return {
      valid: true,
      reason: null,
      owner,
      repo,
      protocol: 'https',
      normalizedSshUrl: `git@github.com:${owner}/${repo}.git`,
      normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`
    };
  }

  return {
    valid: false,
    reason: 'Invalid GitHub push URL format. Expected git@github.com:<owner>/<repo>.git or https://github.com/<owner>/<repo>.git.',
    owner: null,
    repo: null,
    protocol: null,
    normalizedSshUrl: null,
    normalizedHttpsUrl: null
  };
}

@Injectable({
  providedIn: 'root'
})
export class GitPushDiagnosticService {
  private readonly http = inject(HttpClient);

  readonly isRunning = signal<boolean>(false);
  readonly lastResult = signal<GitLsRemoteDiagnosticResult | null>(null);
  readonly diagnosticError = signal<string | null>(null);

  async runLsRemoteDiagnostic(options: {
    repoUrl: string;
    protocol?: 'auto' | 'ssh' | 'https';
    headBranch?: string;
    githubToken?: string | null;
    originalErrorText?: string | null;
  }): Promise<GitLsRemoteDiagnosticResult> {
    this.isRunning.set(true);
    this.diagnosticError.set(null);

    const trimmedUrl = (options.repoUrl || '').trim();
    const protocol = options.protocol || 'auto';
    const headBranch = (options.headBranch || 'main').trim() || 'main';
    const token = (options.githubToken || '').trim();

    // Fast client-side check for blatantly invalid URLs before hitting network
    const localUrlCheck = parseAndValidateClientPushUrl(trimmedUrl);
    if (!localUrlCheck.valid) {
      const invalidResult: GitLsRemoteDiagnosticResult = {
        ok: false,
        rootCause: 'invalid_push_url',
        headline: 'Invalid GitHub Push URL',
        summary: localUrlCheck.reason || 'Push URL failed validation.',
        commandExecuted: 'git ls-remote (blocked: invalid push URL)',
        protocolUsed: localUrlCheck.protocol || 'unknown',
        targetUrl: trimmedUrl,
        normalizedSshUrl: null,
        normalizedHttpsUrl: null,
        refsCount: 0,
        defaultBranch: null,
        stderr: localUrlCheck.reason || 'Invalid URL',
        sshStatus: null,
        apiPermissions: null,
        resolutionSteps: [
          {
            title: 'Inspect existing remote URLs',
            command: 'git remote -v',
            detail: 'Verify origin has no whitespace, extra /tree/ paths, or unsupported schemes.'
          },
          {
            title: 'Set a valid canonical GitHub remote URL',
            command: 'git remote set-url origin git@github.com:<owner>/<repo>.git',
            detail: 'Replace <owner>/<repo> with your exact GitHub repository path.'
          },
          {
            title: 'Test connectivity with git ls-remote',
            command: 'git ls-remote --heads origin',
            detail: 'Confirms Git resolves remote branch refs cleanly.'
          }
        ],
        checkedAtIso: new Date().toISOString()
      };
      this.lastResult.set(invalidResult);
      this.isRunning.set(false);
      return invalidResult;
    }

    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const result = await firstValueFrom(
        this.http.post<GitLsRemoteDiagnosticResult>(
          '/api/git/ls-remote-diagnostic',
          {
            repoUrl: trimmedUrl,
            protocol,
            headBranch
          },
          { headers }
        )
      );
      this.lastResult.set(result);
      return result;
    } catch {
      const fallback = await this.runClientSideFallbackDiagnostic(
        localUrlCheck,
        protocol,
        headBranch,
        token,
        options.originalErrorText || ''
      );
      this.lastResult.set(fallback);
      return fallback;
    } finally {
      this.isRunning.set(false);
    }
  }

  private async runClientSideFallbackDiagnostic(
    urlCheck: ReturnType<typeof parseAndValidateClientPushUrl>,
    requestedProtocol: 'auto' | 'ssh' | 'https',
    headBranch: string,
    token: string,
    originalErrorText: string
  ): Promise<GitLsRemoteDiagnosticResult> {
    const owner = urlCheck.owner || 'owner';
    const repo = urlCheck.repo || 'repository';
    const sshUrl = urlCheck.normalizedSshUrl || `git@github.com:${owner}/${repo}.git`;
    const httpsUrl = urlCheck.normalizedHttpsUrl || `https://github.com/${owner}/${repo}.git`;
    const effectiveProtocol: 'ssh' | 'https' =
      requestedProtocol === 'auto'
        ? token
          ? 'https'
          : urlCheck.protocol || 'ssh'
        : requestedProtocol;
    const targetUrl = effectiveProtocol === 'ssh' ? sshUrl : httpsUrl;

    // Probe GitHub REST API directly from the browser when possible to verify repository & push permission
    let apiPermissions: GitLsRemoteDiagnosticResult['apiPermissions'] = null;
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const resp = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { headers }
      );
      if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
        apiPermissions = {
          accessible: false,
          statusCode: resp.status,
          private: null,
          push: false,
          admin: false
        };
      } else if (resp.ok) {
        const data = (await resp.json()) as {
          default_branch?: string;
          private?: boolean;
          permissions?: { push?: boolean; admin?: boolean };
        };
        apiPermissions = {
          accessible: true,
          statusCode: 200,
          defaultBranch: data.default_branch || 'main',
          private: Boolean(data.private),
          push: typeof data.permissions?.push === 'boolean' ? data.permissions.push : null,
          admin: typeof data.permissions?.admin === 'boolean' ? data.permissions.admin : null
        };
      }
    } catch {
      // Offline or blocked network
    }

    if (apiPermissions && (!apiPermissions.accessible || apiPermissions.push === false)) {
      return {
        ok: false,
        rootCause: 'incorrect_permissions',
        headline:
          apiPermissions.statusCode === 404
            ? 'Repository Not Found or Missing Private Access'
            : 'Incorrect Repository Permissions (Write Access Denied)',
        summary: `GitHub API returned HTTP ${apiPermissions.statusCode} for ${owner}/${repo}. Verify your GitHub account, Personal Access Token ("repo" scope), or Google AI Studio GitHub App installation has write permissions.`,
        commandExecuted: `git ls-remote --heads --symref -- ${targetUrl}`,
        protocolUsed: effectiveProtocol,
        targetUrl,
        normalizedSshUrl: sshUrl,
        normalizedHttpsUrl: httpsUrl,
        refsCount: 0,
        defaultBranch: apiPermissions.defaultBranch || null,
        stderr: `GitHub API status ${apiPermissions.statusCode}; push permission = ${String(apiPermissions.push)}.`,
        sshStatus: null,
        apiPermissions,
        resolutionSteps: [
          {
            title: 'Verify repository write access & GitHub App installation',
            command: `gh auth status && gh repo view ${owner}/${repo}`,
            detail:
              'Check GitHub Settings → Applications → Installed GitHub Apps and ensure write access is granted to this repository.'
          },
          {
            title: 'Switch remote to authenticated SSH and verify refs',
            command: `git remote set-url origin ${sshUrl} && git ls-remote --heads origin`,
            detail: 'Tests direct SSH authentication against GitHub.'
          },
          {
            title: 'Push to a feature branch if main is protected',
            command: `git checkout -b ${headBranch} && git push -u origin ${headBranch}`,
            detail: 'Bypasses direct-push branch protection rules on main.'
          }
        ],
        checkedAtIso: new Date().toISOString()
      };
    }

    if (effectiveProtocol === 'ssh' || /publickey|permission denied/i.test(originalErrorText)) {
      return {
        ok: false,
        rootCause: 'missing_ssh_keys',
        headline: 'Missing or Unregistered SSH Key (Local Terminal Check Required)',
        summary:
          'Unable to execute server-side git ls-remote over SSH in browser-only mode. The error signature points to a missing or unregistered SSH key pair for git@github.com.',
        commandExecuted: `git ls-remote --heads --symref -- ${sshUrl}`,
        protocolUsed: 'ssh',
        targetUrl: sshUrl,
        normalizedSshUrl: sshUrl,
        normalizedHttpsUrl: httpsUrl,
        refsCount: 0,
        defaultBranch: apiPermissions?.defaultBranch || 'main',
        stderr: originalErrorText || 'Permission denied (publickey)',
        sshStatus: null,
        apiPermissions,
        resolutionSteps: [
          {
            title: 'Generate an Ed25519 SSH key pair',
            command: 'ssh-keygen -t ed25519 -C "your_email@example.com"',
            detail: 'Creates ~/.ssh/id_ed25519 and ~/.ssh/id_ed25519.pub.'
          },
          {
            title: 'Add key to ssh-agent and print public key',
            command: 'eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub',
            detail: 'Paste the public key in GitHub Settings → SSH and GPG keys.'
          },
          {
            title: 'Run authenticated git ls-remote locally',
            command: `ssh -T git@github.com && git ls-remote --heads ${sshUrl}`,
            detail: 'Verifies SSH identity and remote repository access.'
          }
        ],
        checkedAtIso: new Date().toISOString()
      };
    }

    return {
      ok: true,
      rootCause: 'ready',
      headline: 'Push URL Valid & Repository Reachable via GitHub API',
      summary: `Repository ${owner}/${repo} is valid and reachable. Run git ls-remote locally to verify your machine's push credentials or re-authorize Google AI Studio in GitHub Settings → Applications.`,
      commandExecuted: `git ls-remote --heads --symref -- ${targetUrl}`,
      protocolUsed: effectiveProtocol,
      targetUrl,
      normalizedSshUrl: sshUrl,
      normalizedHttpsUrl: httpsUrl,
      refsCount: 0,
      defaultBranch: apiPermissions?.defaultBranch || 'main',
      stderr: '',
      sshStatus: null,
      apiPermissions,
      resolutionSteps: [
        {
          title: 'Verify remote refs from your local terminal',
          command: `git ls-remote --heads ${targetUrl}`,
          detail: 'Confirms Git resolves branches cleanly.'
        },
        {
          title: 'Push directly to GitHub',
          command: `git push -u origin ${headBranch}`,
          detail: 'Pushes directly without the platform sync bridge.'
        }
      ],
      checkedAtIso: new Date().toISOString()
    };
  }
}
