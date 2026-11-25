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
