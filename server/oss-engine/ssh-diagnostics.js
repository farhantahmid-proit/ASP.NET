/**
 * Fresnel GitHub SSH Key Readiness Detector
 *
 * Read-only local SSH inspection without ever reading or exposing private keys.
 * Uses child_process.execFile with fixed arguments (shell: false) to prevent
 * command injection.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const KNOWN_PUBLIC_KEY_FILES = [
  'id_ed25519.pub',
  'id_ed25519_sk.pub',
  'id_ecdsa.pub',
  'id_ecdsa_sk.pub',
  'id_rsa.pub',
  'id_dsa.pub'
];

function safeStatIsFile(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function safeStatIsDir(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function inspectSshConfigForGithub(sshDir) {
  const configPath = path.join(sshDir, 'config');
  if (!safeStatIsFile(configPath)) {
    return { hasConfigFile: false, hasGithubConfigEntry: false };
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8').slice(0, 32768);
    const hasGithub = /^\s*Host\s+[^\n]*github\.com\b/im.test(raw);
    return { hasConfigFile: true, hasGithubConfigEntry: hasGithub };
  } catch {
    return { hasConfigFile: true, hasGithubConfigEntry: false };
  }
}

async function checkCommandExists(cmd, args = ['--version']) {
  try {
    await execFileAsync(cmd, args, { timeout: 2000, shell: false });
    return true;
  } catch (err) {
    return err?.code !== 'ENOENT';
  }
}

async function inspectSshAgentCount() {
  try {
    const { stdout } = await execFileAsync('ssh-add', ['-l'], {
      timeout: 2500,
      shell: false
    });
    const lines = String(stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.toLowerCase().includes('no identities'));
    return lines.length;
  } catch (err) {
    const combined = `${err?.stdout || ''}\n${err?.stderr || ''}`.toLowerCase();
    if (combined.includes('no identities')) {
      return 0;
    }
    return null;
  }
}

async function probeGithubSshConnection() {
  try {
    const { stdout, stderr } = await execFileAsync(
      'ssh',
      [
        '-T',
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'ConnectTimeout=3',
        'git@github.com'
      ],
      { timeout: 4500, shell: false }
    );
    const combined = `${stdout || ''} ${stderr || ''}`.trim();
    if (/successfully authenticated/i.test(combined)) {
      return {
        probeAuthenticated: true,
        probeMessage: 'GitHub SSH authentication succeeded.'
      };
    }
    return {
      probeAuthenticated: false,
      probeMessage: combined || 'GitHub SSH handshake did not confirm authentication.'
    };
  } catch (err) {
    // GitHub returns exit code 1 even on successful `ssh -T git@github.com`!
    const combined = `${err?.stdout || ''}\n${err?.stderr || ''}`.trim();
    if (/successfully authenticated/i.test(combined)) {
      return {
        probeAuthenticated: true,
        probeMessage: 'GitHub SSH authentication succeeded.'
      };
    }
    if (/permission denied\s*\(publickey\)/i.test(combined)) {
      return {
        probeAuthenticated: false,
        probeMessage: 'Permission denied (publickey) from git@github.com.'
      };
    }
    return {
      probeAuthenticated: null,
      probeMessage: combined
        ? combined.split('\n')[0].slice(0, 180)
        : 'Unable to reach git@github.com from this host.'
    };
  }
}

async function checkGithubApiAccountKeys(githubToken) {
  if (typeof githubToken !== 'string' || !githubToken.trim()) {
    return null;
  }
  try {
    const resp = await fetch('https://api.github.com/user/keys', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken.trim()}`,
        'User-Agent': 'Fresnel-Audit-Agent'
      },
      signal: AbortSignal.timeout(3500)
    });
    if (!resp.ok) return null;
    const keys = await resp.json();
    return Array.isArray(keys) ? keys.length : null;
  } catch {
    return null;
  }
}

/**
 * Inspects local SSH key readiness without reading private key contents.
 */
export async function detectGithubSshReadiness(options = {}) {
  const sshDir = options.sshDir || path.join(os.homedir(), '.ssh');
  const probeRemote = Boolean(options.probeRemote);
  const githubToken = options.githubToken || null;

  const sshDirExists = safeStatIsDir(sshDir);
  let dirEntries = [];
  if (sshDirExists) {
    try {
      dirEntries = fs.readdirSync(sshDir);
    } catch {
      dirEntries = [];
    }
  }

  const pubKeySet = new Set();
  for (const name of dirEntries) {
    if (KNOWN_PUBLIC_KEY_FILES.includes(name) || (/^[a-zA-Z0-9._-]+\.pub$/.test(name))) {
      if (safeStatIsFile(path.join(sshDir, name))) {
        pubKeySet.add(name);
      }
    }
  }

  const detectedPublicKeys = Array.from(pubKeySet).sort();
  const hasMatchingPrivateKey = detectedPublicKeys.some((pubFile) => {
    const privName = pubFile.replace(/\.pub$/, '');
    return safeStatIsFile(path.join(sshDir, privName));
  });

  const configInfo = sshDirExists
    ? inspectSshConfigForGithub(sshDir)
    : { hasConfigFile: false, hasGithubConfigEntry: false };

  const [sshKeygenAvailable, gitAvailable, agentLoadedCount, githubAccountKeysCount] =
    await Promise.all([
      options.skipSystemCmds ? Promise.resolve(true) : checkCommandExists('ssh-keygen', ['-?']),
      options.skipSystemCmds ? Promise.resolve(true) : checkCommandExists('git', ['--version']),
      options.skipSystemCmds ? Promise.resolve(null) : inspectSshAgentCount(),
      checkGithubApiAccountKeys(githubToken)
    ]);

  let probeAttempted = false;
  let probeAuthenticated = null;
  let probeMessage = null;

  if (probeRemote && !options.skipSystemCmds) {
    probeAttempted = true;
    const probeRes = await probeGithubSshConnection();
    probeAuthenticated = probeRes.probeAuthenticated;
    probeMessage = probeRes.probeMessage;
  }

  let status = 'missing_key';
  const missingLocalKey = detectedPublicKeys.length === 0 || !hasMatchingPrivateKey;

  if (probeAttempted && probeAuthenticated === true) {
    status = 'ready';
  } else if (probeAttempted && probeAuthenticated === false) {
    status = missingLocalKey ? 'missing_key' : 'github_unregistered';
  } else if (missingLocalKey) {
    status = 'missing_key';
  } else if (agentLoadedCount === 0) {
    status = 'agent_unloaded';
  } else if (githubAccountKeysCount === 0) {
    status = 'github_unregistered';
  } else {
    status = 'ready';
  }

  const recommendations = [];
  if (missingLocalKey) {
    recommendations.push(
      'No SSH public/private key pair found in ~/.ssh. Generate an Ed25519 key with ssh-keygen.'
    );
  }
  if (!missingLocalKey && agentLoadedCount === 0) {
    recommendations.push(
      'SSH key exists on disk but is not loaded into ssh-agent. Run eval "$(ssh-agent -s)" and ssh-add.'
    );
  }
  if (githubAccountKeysCount === 0 || status === 'github_unregistered') {
    recommendations.push(
      'No public SSH key is registered on GitHub or GitHub rejected the key. Add your .pub key in GitHub Settings → SSH and GPG keys.'
    );
  }
  if (!configInfo.hasGithubConfigEntry) {
    recommendations.push(
      'Add a Host github.com block to ~/.ssh/config so git automatically selects your GitHub key.'
    );
  }

  return {
    status,
    missingSshKey: status === 'missing_key' || status === 'github_unregistered',
    sshDirExists,
    detectedPublicKeys,
    hasMatchingPrivateKey,
    agentLoadedCount,
    hasConfigFile: configInfo.hasConfigFile,
    hasGithubConfigEntry: configInfo.hasGithubConfigEntry,
    sshKeygenAvailable,
    gitAvailable,
    probeAttempted,
    probeAuthenticated,
    probeMessage,
    githubAccountKeysCount,
    checkedAtIso: new Date().toISOString(),
    recommendations
  };
}

const SAFE_GH_SEGMENT_RE = /^[a-zA-Z0-9._-]{1,100}$/;

function isSafeGithubSegment(segment) {
  return (
    typeof segment === 'string' &&
    SAFE_GH_SEGMENT_RE.test(segment) &&
    segment !== '.' &&
    segment !== '..' &&
    !segment.startsWith('-') &&
    !segment.includes('..')
  );
}

function scrubSecretFromText(text, secret) {
  let out = String(text || '');
  if (secret && typeof secret === 'string' && secret.trim().length > 3) {
    out = out.split(secret.trim()).join('[REDACTED]');
  }
  out = out.replace(/https?:\/\/[^@\s/]+@github\.com/gi, 'https://[REDACTED]@github.com');
  return out.trim();
}

/**
 * Strictly validates a GitHub push URL (SSH, HTTPS, or owner/repo shorthand)
 * to prevent command/argument injection and detect invalid push URLs that cause
 * "Request contains an invalid argument" or remote push failures.
 */
export function validateGitPushUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      reason: 'Push URL is empty. Provide a valid GitHub SSH or HTTPS repository URL.',
      detectedProtocol: null,
      owner: null,
      repo: null,
      normalizedHttpsUrl: null,
      normalizedSshUrl: null
    };
  }

  if (/[\s\r\n\0'"`$|;&<>\\]/.test(trimmed) || trimmed.startsWith('-')) {
    return {
      valid: false,
      reason:
        'Push URL contains illegal whitespace, shell characters, or a leading dash (invalid git argument).',
      detectedProtocol: null,
      owner: null,
      repo: null,
      normalizedHttpsUrl: null,
      normalizedSshUrl: null
    };
  }

  if (/^(ext::|file:|ftp:|javascript:|data:)/i.test(trimmed)) {
    return {
      valid: false,
      reason: 'Unsupported or unsafe Git transport protocol. Use GitHub SSH (git@github.com:...) or HTTPS.',
      detectedProtocol: null,
      owner: null,
      repo: null,
      normalizedHttpsUrl: null,
      normalizedSshUrl: null
    };
  }

  // 1. SCP-style SSH: git@github.com:owner/repo(.git)?
  const scpMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed);
  if (scpMatch) {
    const owner = scpMatch[1];
    const repo = scpMatch[2];
    if (!isSafeGithubSegment(owner) || !isSafeGithubSegment(repo)) {
      return {
        valid: false,
        reason: `Invalid GitHub owner/repository segment in SSH URL ("${owner}/${repo}").`,
        detectedProtocol: 'ssh',
        owner: null,
        repo: null,
        normalizedHttpsUrl: null,
        normalizedSshUrl: null
      };
    }
    return {
      valid: true,
      reason: null,
      detectedProtocol: 'ssh',
      owner,
      repo,
      normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`,
      normalizedSshUrl: `git@github.com:${owner}/${repo}.git`
    };
  }

  // 2. ssh://git@github.com/owner/repo(.git)?
  const sshProtoMatch = /^ssh:\/\/git@github\.com(?::22)?\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed);
  if (sshProtoMatch) {
    const owner = sshProtoMatch[1];
    const repo = sshProtoMatch[2];
    if (!isSafeGithubSegment(owner) || !isSafeGithubSegment(repo)) {
      return {
        valid: false,
        reason: `Invalid GitHub owner/repository segment in ssh:// URL ("${owner}/${repo}").`,
        detectedProtocol: 'ssh',
        owner: null,
        repo: null,
        normalizedHttpsUrl: null,
        normalizedSshUrl: null
      };
    }
    return {
      valid: true,
      reason: null,
      detectedProtocol: 'ssh',
      owner,
      repo,
      normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`,
      normalizedSshUrl: `git@github.com:${owner}/${repo}.git`
    };
  }

  // 3. HTTPS: https://github.com/owner/repo(.git)?
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:') {
        return {
          valid: false,
          reason: 'Insecure HTTP remote URL detected. GitHub requires HTTPS or SSH.',
          detectedProtocol: 'https',
          owner: null,
          repo: null,
          normalizedHttpsUrl: null,
          normalizedSshUrl: null
        };
      }
      if (parsed.hostname.toLowerCase() !== 'github.com' && parsed.hostname.toLowerCase() !== 'www.github.com') {
        return {
          valid: false,
          reason: `Unsupported remote host "${parsed.hostname}". Expected github.com.`,
          detectedProtocol: 'https',
          owner: null,
          repo: null,
          normalizedHttpsUrl: null,
          normalizedSshUrl: null
        };
      }
      const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (segments.length !== 2) {
        return {
          valid: false,
          reason: 'GitHub URL must point directly to https://github.com/<owner>/<repo> without extra tree/blob paths.',
          detectedProtocol: 'https',
          owner: null,
          repo: null,
          normalizedHttpsUrl: null,
          normalizedSshUrl: null
        };
      }
      const owner = segments[0];
      const repo = segments[1].replace(/\.git$/i, '');
      if (!isSafeGithubSegment(owner) || !isSafeGithubSegment(repo)) {
        return {
          valid: false,
          reason: `Invalid GitHub owner/repository name ("${owner}/${repo}").`,
          detectedProtocol: 'https',
          owner: null,
          repo: null,
          normalizedHttpsUrl: null,
          normalizedSshUrl: null
        };
      }
      return {
        valid: true,
        reason: null,
        detectedProtocol: 'https',
        owner,
        repo,
        normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`,
        normalizedSshUrl: `git@github.com:${owner}/${repo}.git`
      };
    } catch {
      return {
        valid: false,
        reason: 'Malformed remote URL syntax. Expected https://github.com/<owner>/<repo>.git or git@github.com:<owner>/<repo>.git.',
        detectedProtocol: null,
        owner: null,
        repo: null,
        normalizedHttpsUrl: null,
        normalizedSshUrl: null
      };
    }
  }

  // 4. Shorthand owner/repo
  const shortMatch = /^([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed);
  if (shortMatch) {
    const owner = shortMatch[1];
    const repo = shortMatch[2];
    if (isSafeGithubSegment(owner) && isSafeGithubSegment(repo)) {
      return {
        valid: true,
        reason: null,
        detectedProtocol: 'https',
        owner,
        repo,
        normalizedHttpsUrl: `https://github.com/${owner}/${repo}.git`,
        normalizedSshUrl: `git@github.com:${owner}/${repo}.git`
      };
    }
  }

  return {
    valid: false,
    reason:
      'Unrecognized GitHub push URL format. Use git@github.com:<owner>/<repo>.git or https://github.com/<owner>/<repo>.git.',
    detectedProtocol: null,
    owner: null,
    repo: null,
    normalizedHttpsUrl: null,
    normalizedSshUrl: null
  };
}

/**
 * Classifies `git ls-remote` failure stderr + SSH readiness into one of the three
 * concrete root causes: missing_ssh_keys, incorrect_permissions, or invalid_push_url.
 */
export function classifyGitLsRemoteError(stderrText, context = {}) {
  const text = String(stderrText || '');
  const lower = text.toLowerCase();
  const sshStatus = context.sshStatus || null;
  const protocol = context.protocol || 'ssh';
  const apiPermissions = context.apiPermissions || null;

  if (
    /permission denied\s*\(publickey\)/i.test(text) ||
    /publickey/i.test(text) ||
    /host key verification failed/i.test(text) ||
    /no such identity/i.test(text) ||
    (protocol === 'ssh' &&
      /could not read from remote repository/i.test(text) &&
      (!sshStatus || sshStatus.missingSshKey || sshStatus.status !== 'ready'))
  ) {
    return {
      rootCause: 'missing_ssh_keys',
      headline: 'Missing or Unregistered SSH Key',
      summary:
        'git ls-remote over SSH was rejected by git@github.com because no authorized SSH key pair is loaded in ssh-agent or registered on your GitHub account.'
    };
  }

  if (
    /invalid argument/i.test(text) ||
    /does not appear to be a git repository/i.test(text) ||
    /could not resolve host/i.test(text) ||
    /unsupported protocol/i.test(text) ||
    /malformed/i.test(text) ||
    /bad port/i.test(text)
  ) {
    return {
      rootCause: 'invalid_push_url',
      headline: 'Invalid Push URL or Remote Ref Argument',
      summary:
        'Git rejected the remote URL or reference argument. Verify the remote points directly to git@github.com:<owner>/<repo>.git or https://github.com/<owner>/<repo>.git.'
    };
  }

  if (
    /repository not found/i.test(text) ||
    /authentication failed/i.test(text) ||
    /403|401|forbidden|denied to|write access|push protection|gh013|protected branch/i.test(lower) ||
    /terminal prompts disabled|could not read username/i.test(lower) ||
    (apiPermissions && apiPermissions.push === false)
  ) {
    return {
      rootCause: 'incorrect_permissions',
      headline: 'Incorrect Repository Permissions or Missing Write Access',
      summary:
        'GitHub denied access to the target repository. Your account, OAuth token, or GitHub App installation lacks read/write ("repo") permissions on this repository.'
    };
  }

  if (protocol === 'ssh' && sshStatus && sshStatus.missingSshKey) {
    return {
      rootCause: 'missing_ssh_keys',
      headline: 'Missing Local SSH Key Pair',
      summary:
        'No valid SSH public/private key pair was detected in ~/.ssh for authenticating with git@github.com.'
    };
  }

  return {
    rootCause: 'incorrect_permissions',
    headline: 'Remote Authentication or Permission Failure',
    summary:
      'git ls-remote could not authenticate with the target repository. Check repository collaborator permissions, GitHub token scopes, or SSH key registration.'
  };
}

function buildDiagnosticResolutionSteps(rootCause, parsedUrl, branch = 'main') {
  const repoFullName =
    parsedUrl?.owner && parsedUrl?.repo ? `${parsedUrl.owner}/${parsedUrl.repo}` : 'owner/repository';
  const sshUrl = parsedUrl?.normalizedSshUrl || `git@github.com:${repoFullName}.git`;
  const httpsUrl = parsedUrl?.normalizedHttpsUrl || `https://github.com/${repoFullName}.git`;
  const safeBranch = String(branch || 'main').replace(/[^a-zA-Z0-9._/-]/g, '') || 'main';

  if (rootCause === 'invalid_push_url') {
    return [
      {
        title: 'Inspect your current Git remote URLs',
        command: 'git remote -v',
        detail: 'Check for typos, extra /tree/ or /blob/ path segments, whitespace, or invalid protocols.'
      },
      {
        title: 'Reset origin to the canonical GitHub SSH or HTTPS URL',
        command: `git remote set-url origin ${sshUrl}`,
        detail: `Or for HTTPS: git remote set-url origin ${httpsUrl}`
      },
      {
        title: 'Verify connectivity with git ls-remote',
        command: `git ls-remote --heads origin`,
        detail: 'Confirm Git resolves remote branch refs cleanly without invalid argument errors.'
      }
    ];
  }

  if (rootCause === 'missing_ssh_keys') {
    return [
      {
        title: 'Generate a new Ed25519 SSH key pair locally',
        command: 'ssh-keygen -t ed25519 -C "your_email@example.com"',
        detail: 'Accept the default ~/.ssh/id_ed25519 location to create your private and public keys.'
      },
      {
        title: 'Load the key into ssh-agent and copy the public key',
        command: 'eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub',
        detail: 'Add the printed public key in GitHub Settings → SSH and GPG keys → New SSH key.'
      },
      {
        title: 'Verify SSH handshake and authenticated git ls-remote',
        command: `ssh -T git@github.com && git ls-remote --heads ${sshUrl}`,
        detail: `Once refs list cleanly, push with: git push -u origin ${safeBranch}`
      }
    ];
  }

  if (rootCause === 'incorrect_permissions') {
    return [
      {
        title: 'Verify GitHub account / GitHub App repository write permissions',
        command: `gh auth status && gh repo view ${repoFullName}`,
        detail:
          'Confirm you have Write/Admin collaborator access and that Google AI Studio is authorized for this repo under GitHub Settings → Applications.'
      },
      {
        title: 'Refresh credentials or switch to an authenticated SSH remote',
        command: `git remote set-url origin ${sshUrl} && git ls-remote --heads origin`,
        detail:
          'If using HTTPS with a Personal Access Token, ensure the token grants full "repo" write scope (or Contents: Read & Write for fine-grained PATs).'
      },
      {
        title: 'Check branch protection & push to a dedicated feature branch',
        command: `git checkout -b fresnel/audit-fixes && git push -u origin fresnel/audit-fixes`,
        detail: 'If main is protected against direct pushes, push to a feature branch and open a Pull Request.'
      }
    ];
  }

  return [
    {
      title: 'Remote verified — re-authorize AI Studio GitHub App if platform push fails',
      command: `git ls-remote --heads ${sshUrl}`,
      detail:
        'Your repository URL and authentication succeeded. If AI Studio still shows "invalid argument", revoke and re-authorize Google AI Studio in GitHub Settings → Applications, or push from your local terminal.'
    },
    {
      title: 'Push directly from local terminal',
      command: `git push -u origin ${safeBranch}`,
      detail: 'Directly pushes your branch to GitHub without going through the AI Studio sync bridge.'
    }
  ];
}

async function checkGithubRepoPermissionsViaApi(owner, repo, githubToken) {
  if (!owner || !repo) return null;
  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Fresnel-Audit-Diagnostic'
    };
    if (githubToken && typeof githubToken === 'string' && githubToken.trim()) {
      headers.Authorization = `Bearer ${githubToken.trim()}`;
    }
    const resp = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers, signal: AbortSignal.timeout(4000) }
    );
    if (resp.status === 401 || resp.status === 403) {
      return { accessible: false, statusCode: resp.status, push: false, admin: false, private: null };
    }
    if (resp.status === 404) {
      return { accessible: false, statusCode: 404, push: false, admin: false, private: null };
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      accessible: true,
      statusCode: 200,
      defaultBranch: data?.default_branch || 'main',
      private: Boolean(data?.private),
      push: typeof data?.permissions?.push === 'boolean' ? data.permissions.push : null,
      admin: typeof data?.permissions?.admin === 'boolean' ? data.permissions.admin : null
    };
  } catch {
    return null;
  }
}

/**
 * Runs an authenticated `git ls-remote` diagnostic check against the target repository
 * using `execFile` (shell: false) with `--` option termination to determine whether push
 * failures stem from an invalid push URL, missing SSH keys, or incorrect permissions.
 */
export async function diagnoseGitRemotePush(options = {}) {
  const rawUrl = String(options.repoUrl || '').trim();
  const requestedProtocol =
    options.protocol === 'ssh' || options.protocol === 'https' ? options.protocol : 'auto';
  const githubToken = typeof options.githubToken === 'string' ? options.githubToken.trim() : '';
  const headBranch = String(options.headBranch || 'main').trim() || 'main';
  const checkedAtIso = new Date().toISOString();

  const urlCheck = validateGitPushUrl(rawUrl);
  if (!urlCheck.valid) {
    return {
      ok: false,
      rootCause: 'invalid_push_url',
      headline: 'Invalid GitHub Push URL',
      summary: urlCheck.reason,
      commandExecuted: 'git ls-remote (blocked: invalid push URL)',
      protocolUsed: urlCheck.detectedProtocol || 'unknown',
      targetUrl: rawUrl,
      normalizedSshUrl: null,
      normalizedHttpsUrl: null,
      refsCount: 0,
      defaultBranch: null,
      stderr: urlCheck.reason,
      sshStatus: null,
      apiPermissions: null,
      resolutionSteps: buildDiagnosticResolutionSteps('invalid_push_url', urlCheck, headBranch),
      checkedAtIso
    };
  }

  const effectiveProtocol =
    requestedProtocol === 'auto'
      ? githubToken
        ? 'https'
        : urlCheck.detectedProtocol || 'ssh'
      : requestedProtocol;

  const targetRemoteUrl =
    effectiveProtocol === 'ssh' ? urlCheck.normalizedSshUrl : urlCheck.normalizedHttpsUrl;

  const [sshStatus, apiPermissions] = await Promise.all([
    detectGithubSshReadiness({
      sshDir: options.sshDir,
      probeRemote: effectiveProtocol === 'ssh' && !options.skipSystemCmds,
      githubToken: githubToken || null,
      skipSystemCmds: Boolean(options.skipSystemCmds)
    }),
    options.skipSystemCmds
      ? Promise.resolve(null)
      : checkGithubRepoPermissionsViaApi(urlCheck.owner, urlCheck.repo, githubToken)
  ]);

  const displayCmd =
    effectiveProtocol === 'https' && githubToken
      ? `git -c http.extraHeader="AUTHORIZATION: basic [REDACTED]" ls-remote --heads --symref -- ${targetRemoteUrl}`
      : `git ls-remote --heads --symref -- ${targetRemoteUrl}`;

  if (options.skipSystemCmds) {
    const simulatedRootCause =
      effectiveProtocol === 'ssh' && sshStatus.missingSshKey ? 'missing_ssh_keys' : 'ready';
    return {
      ok: simulatedRootCause === 'ready',
      rootCause: simulatedRootCause,
      headline:
        simulatedRootCause === 'ready'
          ? 'Push URL & SSH Configuration Ready'
          : 'Missing Local SSH Key Pair',
      summary:
        simulatedRootCause === 'ready'
          ? 'Push URL passed strict validation and local SSH key pair is present.'
          : 'Push URL is valid, but no matching SSH key pair was found in ~/.ssh.',
      commandExecuted: displayCmd,
      protocolUsed: effectiveProtocol,
      targetUrl: targetRemoteUrl,
      normalizedSshUrl: urlCheck.normalizedSshUrl,
      normalizedHttpsUrl: urlCheck.normalizedHttpsUrl,
      refsCount: 0,
      defaultBranch: apiPermissions?.defaultBranch || 'main',
      stderr: '',
      sshStatus,
      apiPermissions,
      resolutionSteps: buildDiagnosticResolutionSteps(simulatedRootCause, urlCheck, headBranch),
      checkedAtIso
    };
  }

  const gitArgs = [];
  if (effectiveProtocol === 'https' && githubToken) {
    const basicCred = Buffer.from(`x-access-token:${githubToken}`, 'utf8').toString('base64');
    gitArgs.push('-c', `http.extraHeader=AUTHORIZATION: basic ${basicCred}`);
  }
  gitArgs.push('ls-remote', '--heads', '--symref', '--', targetRemoteUrl);

  try {
    const { stdout } = await execFileAsync('git', gitArgs, {
      timeout: 7000,
      shell: false,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND:
          'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5'
      }
    });

    const lines = String(stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const branchLines = lines.filter((l) => l.includes('refs/heads/'));
    const symrefLine = lines.find((l) => l.startsWith('ref: refs/heads/'));
    const detectedDefaultBranch = symrefLine
      ? symrefLine.replace(/^ref:\s*refs\/heads\//, '').split(/\s+/)[0]
      : apiPermissions?.defaultBranch || 'main';

    // Even when `git ls-remote` reads a public repo over HTTPS, check if the authenticated token lacks push permission!
    if (apiPermissions && apiPermissions.push === false) {
      return {
        ok: false,
        rootCause: 'incorrect_permissions',
        headline: 'Read Access Only — Push Permission Denied',
        summary: `git ls-remote succeeded (${branchLines.length} branch refs), but your authenticated GitHub token does not have push/write permission on ${urlCheck.owner}/${urlCheck.repo}.`,
        commandExecuted: displayCmd,
        protocolUsed: effectiveProtocol,
        targetUrl: targetRemoteUrl,
        normalizedSshUrl: urlCheck.normalizedSshUrl,
        normalizedHttpsUrl: urlCheck.normalizedHttpsUrl,
        refsCount: branchLines.length,
        defaultBranch: detectedDefaultBranch,
        stderr: 'GitHub API reports permissions.push = false for the current credentials.',
        sshStatus,
        apiPermissions,
        resolutionSteps: buildDiagnosticResolutionSteps('incorrect_permissions', urlCheck, headBranch),
        checkedAtIso
      };
    }

    return {
      ok: true,
      rootCause: 'ready',
      headline: `git ls-remote Verified (${branchLines.length} remote ${branchLines.length === 1 ? 'branch' : 'branches'})`,
      summary: `Authenticated remote check succeeded against ${urlCheck.owner}/${urlCheck.repo} (default branch: ${detectedDefaultBranch}). URL and transport are valid.`,
      commandExecuted: displayCmd,
      protocolUsed: effectiveProtocol,
      targetUrl: targetRemoteUrl,
      normalizedSshUrl: urlCheck.normalizedSshUrl,
      normalizedHttpsUrl: urlCheck.normalizedHttpsUrl,
      refsCount: branchLines.length,
      defaultBranch: detectedDefaultBranch,
      stderr: '',
      sshStatus,
      apiPermissions,
      resolutionSteps: buildDiagnosticResolutionSteps('ready', urlCheck, headBranch),
      checkedAtIso
    };
  } catch (err) {
    const rawStderr = scrubSecretFromText(
      `${err?.stderr || ''}\n${err?.stdout || ''}\n${err?.message || ''}`,
      githubToken
    );
    const classified = classifyGitLsRemoteError(rawStderr, {
      sshStatus,
      protocol: effectiveProtocol,
      apiPermissions
    });

    return {
      ok: false,
      rootCause: classified.rootCause,
      headline: classified.headline,
      summary: classified.summary,
      commandExecuted: displayCmd,
      protocolUsed: effectiveProtocol,
      targetUrl: targetRemoteUrl,
      normalizedSshUrl: urlCheck.normalizedSshUrl,
      normalizedHttpsUrl: urlCheck.normalizedHttpsUrl,
      refsCount: 0,
      defaultBranch: apiPermissions?.defaultBranch || null,
      stderr: rawStderr.split('\n').slice(0, 6).join('\n').slice(0, 600),
      sshStatus,
      apiPermissions,
      resolutionSteps: buildDiagnosticResolutionSteps(classified.rootCause, urlCheck, headBranch),
      checkedAtIso
    };
  }
}

