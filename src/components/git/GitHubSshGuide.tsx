import { useEffect, useMemo, useState } from 'react'
import { fetchGitSshStatus } from '@/api/git/git'
import type { GitHubSshDiagnosticStatus } from '@/types/audit'

export interface SshSetupStep {
  number: number
  id: string
  title: string
  description: string
  command: string
  note?: string
  externalUrl?: string
  externalLabel?: string
}

export function sanitizeSshEmail(rawEmail: string | null | undefined): string {
  const cleaned = String(rawEmail ?? '')
    .trim()
    .replace(/["'`$\\;\n\r|&<>(){}]/g, '')
    .slice(0, 120)
  if (!cleaned || !cleaned.includes('@')) {
    return 'you@example.com'
  }
  return cleaned
}

export function sanitizeGitRepoPath(rawFullName: string | null | undefined): string {
  const cleaned = String(rawFullName ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._/-]/g, '')
  if (!cleaned || !cleaned.includes('/') || cleaned.includes('..')) {
    return 'owner/repository'
  }
  return cleaned
}

export function sanitizePushBranch(rawBranch: string | null | undefined): string {
  const cleaned = String(rawBranch ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._/-]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
  return cleaned || 'fresnel/oss-audit'
}

export function classifyPushErrorText(rawError: string | null | undefined): {
  isMissingSshKey: boolean
  headline: string
  explanation: string
} {
  const text = String(rawError ?? '').trim().toLowerCase()
  if (!text) {
    return {
      isMissingSshKey: false,
      headline: 'Paste a git push error to diagnose',
      explanation: 'Example: "git@github.com: Permission denied (publickey)."',
    }
  }
  if (
    text.includes('permission denied (publickey)') ||
    text.includes('no such identity') ||
    text.includes('publickey') ||
    text.includes('could not read from remote repository')
  ) {
    return {
      isMissingSshKey: true,
      headline: 'Missing or unregistered GitHub SSH key detected',
      explanation:
        'GitHub rejected the push because no matching SSH private/public key pair was offered by ssh-agent or linked to your GitHub account. Complete steps 1-5 below.',
    }
  }
  if (text.includes('host key verification failed')) {
    return {
      isMissingSshKey: true,
      headline: 'GitHub SSH known_hosts entry missing or mismatched',
      explanation:
        'Run ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts and re-test ssh -T git@github.com.',
    }
  }
  if (
    text.includes('repository not found') ||
    text.includes('403') ||
    text.includes('authentication failed')
  ) {
    return {
      isMissingSshKey: true,
      headline: 'Repository authentication or permission error detected',
      explanation:
        'Ensure your SSH key is added to the GitHub account with write access to this repository, or switch origin to HTTPS with git remote set-url.',
    }
  }
  return {
    isMissingSshKey: false,
    headline: 'Error does not look SSH-specific, but you can verify SSH readiness below',
    explanation: 'Run ssh -T git@github.com to confirm your local SSH identity works before pushing.',
  }
}

export function buildSshCliSteps(options: {
  email: string
  algorithm: 'ed25519' | 'rsa'
  os: 'mac' | 'linux' | 'windows'
  repoFullName: string
  headBranch: string
}): SshSetupStep[] {
  const safeEmail = sanitizeSshEmail(options.email)
  const safeRepo = sanitizeGitRepoPath(options.repoFullName)
  const safeBranch = sanitizePushBranch(options.headBranch)
  const keyName = options.algorithm === 'rsa' ? 'id_rsa' : 'id_ed25519'

  const keygenCmd =
    options.algorithm === 'rsa'
      ? `ssh-keygen -t rsa -b 4096 -C "${safeEmail}"`
      : `ssh-keygen -t ed25519 -C "${safeEmail}"`

  const agentCmd =
    options.os === 'mac'
      ? `eval "$(ssh-agent -s)"\nssh-add --apple-use-keychain ~/.ssh/${keyName}`
      : `eval "$(ssh-agent -s)"\nssh-add ~/.ssh/${keyName}`

  const copyPubCmd =
    options.os === 'mac'
      ? `pbcopy < ~/.ssh/${keyName}.pub`
      : options.os === 'windows'
        ? `clip < ~/.ssh/${keyName}.pub`
        : `cat ~/.ssh/${keyName}.pub`

  const configCmd = [
    'mkdir -p ~/.ssh && chmod 700 ~/.ssh',
    "cat << 'EOF' >> ~/.ssh/config",
    'Host github.com',
    '  HostName github.com',
    '  User git',
    '  AddKeysToAgent yes',
    `  IdentityFile ~/.ssh/${keyName}`,
    'EOF',
    'chmod 600 ~/.ssh/config',
  ].join('\n')

  const verifyPushCmd = [
    'ssh -T git@github.com',
    `git remote set-url origin git@github.com:${safeRepo}.git`,
    `git push -u origin ${safeBranch}`,
  ].join('\n')

  return [
    {
      number: 1,
      id: 'check-existing',
      title: 'Check for existing SSH keys',
      description: 'Verify if ~/.ssh already has an id_ed25519.pub or id_rsa.pub key pair.',
      command: 'ls -al ~/.ssh',
      note: 'If id_ed25519.pub already appears, skip Step 2 and load it in Step 3.',
    },
    {
      number: 2,
      id: 'generate-key',
      title: `Generate a new ${options.algorithm === 'rsa' ? 'RSA 4096' : 'Ed25519'} SSH key`,
      description: 'Press Enter at the file prompt to save to the default path, then set a passphrase.',
      command: keygenCmd,
    },
    {
      number: 3,
      id: 'add-to-agent',
      title: 'Start ssh-agent & register your private key',
      description: 'Loads your private key into the active SSH authentication agent.',
      command: agentCmd,
      note: 'Optional ~/.ssh/config setup:\n' + configCmd,
    },
    {
      number: 4,
      id: 'add-to-github',
      title: 'Copy public key & add it to your GitHub account',
      description:
        'Copy only the .pub file contents, open GitHub SSH Settings, choose Authentication Key, and paste it.',
      command: copyPubCmd,
      externalUrl: 'https://github.com/settings/ssh/new',
      externalLabel: 'Open GitHub -> New SSH Key ↗',
    },
    {
      number: 5,
      id: 'test-and-push',
      title: 'Verify GitHub SSH handshake & push your branch',
      description:
        'Confirms GitHub recognizes your account, sets the SSH remote URL, and pushes the audit branch.',
      command: verifyPushCmd,
      note: 'Expected output: "Hi <username>! You\'ve successfully authenticated, but GitHub does not provide shell access."',
    },
  ]
}

export interface GitHubSshGuideProps {
  repoFullName?: string
  repoUrl?: string
  headBranch?: string
  defaultEmail?: string
  githubAccessToken?: string
}

export function GitHubSshGuide({
  repoFullName = 'owner/repository',
  repoUrl = 'https://github.com/owner/repository',
  headBranch = 'fresnel/oss-audit',
  defaultEmail = '',
  githubAccessToken,
}: GitHubSshGuideProps) {
  const [diagnostic, setDiagnostic] = useState<GitHubSshDiagnosticStatus | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [emailInput, setEmailInput] = useState(defaultEmail)
  const [pushErrorInput, setPushErrorInput] = useState('')
  const [algorithm, setAlgorithm] = useState<'ed25519' | 'rsa'>('ed25519')
  const [osTarget, setOsTarget] = useState<'mac' | 'linux' | 'windows'>(() => {
    if (typeof navigator !== 'undefined') {
      const ua = (navigator.userAgent || '').toLowerCase()
      if (ua.includes('win')) return 'windows'
      if (ua.includes('linux')) return 'linux'
    }
    return 'mac'
  })
  const [copiedStepId, setCopiedStepId] = useState<string | null>(null)
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([])

  async function runCheck(probeRemote: boolean) {
    setIsChecking(true)
    try {
      const status = await fetchGitSshStatus({ probe: probeRemote, githubToken: githubAccessToken })
      setDiagnostic(status)
      if (status.missingSshKey || status.status === 'agent_unloaded') {
        setIsExpanded(true)
      }
    } catch {
      // Keep last known diagnostic
    } finally {
      setIsChecking(false)
    }
  }

  useEffect(() => {
    void runCheck(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const errorDiagnostic = useMemo(() => classifyPushErrorText(pushErrorInput), [pushErrorInput])
  const isMissingKeyFlagged = Boolean(errorDiagnostic.isMissingSshKey || diagnostic?.missingSshKey)

  const steps = useMemo(
    () =>
      buildSshCliSteps({
        email: emailInput || defaultEmail || 'you@example.com',
        algorithm,
        os: osTarget,
        repoFullName,
        headBranch,
      }),
    [emailInput, defaultEmail, algorithm, osTarget, repoFullName, headBranch],
  )

  function toggleStep(stepId: string) {
    setCompletedStepIds((prev) =>
      prev.includes(stepId) ? prev.filter((id) => id !== stepId) : [...prev, stepId],
    )
  }

  return (
    <section
      className={`fr-card ssh-guide-card${isMissingKeyFlagged ? ' is-missing' : ''}`}
      aria-labelledby="ssh-guide-title"
    >
      <div className="fr-section-head">
        <div>
          <div className="fr-actions">
            <span className="fr-badge">
              {isChecking
                ? 'Checking SSH readiness...'
                : isMissingKeyFlagged
                  ? 'GitHub SSH Key Missing'
                  : diagnostic?.status === 'agent_unloaded'
                    ? 'SSH Key Found · Not Loaded in Agent'
                    : diagnostic?.status === 'ready'
                      ? 'SSH Key Ready'
                      : 'SSH Setup Assistant'}
            </span>
          </div>
          <h2 id="ssh-guide-title" className="fr-section-title">
            GitHub SSH Push Troubleshooter
          </h2>
          <p className="fr-muted">
            {diagnostic?.probeMessage ||
              'Inspect local SSH key readiness (~/.ssh), test GitHub SSH handshake, or generate an Ed25519 key.'}
          </p>
        </div>

        <div className="fr-actions">
          <button
            type="button"
            id="ssh-guide-probe-btn"
            className="fr-btn-secondary"
            disabled={isChecking}
            onClick={() => void runCheck(true)}
          >
            {isChecking ? 'Probing GitHub...' : 'Run Live SSH Probe'}
          </button>
          <button
            type="button"
            className="fr-btn-secondary"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((v) => !v)}
          >
            {isExpanded ? 'Hide Steps' : 'Show Setup Guide (5 Steps)'}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="fr-intake-form">
          <div className="fr-intake-grid">
            <label className="fr-field">
              <span className="fr-label">GitHub Email (for ssh-keygen -C)</span>
              <input
                type="email"
                className="fr-input"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com"
              />
            </label>

            <label className="fr-field">
              <span className="fr-label">Paste Git Push Error (Optional)</span>
              <input
                type="text"
                className="fr-input"
                value={pushErrorInput}
                onChange={(e) => setPushErrorInput(e.target.value)}
                placeholder="git@github.com: Permission denied (publickey)."
              />
            </label>
          </div>

          <div className="fr-actions">
            <div className="fr-segmented" role="group" aria-label="Operating system commands">
              {(['mac', 'linux', 'windows'] as const).map((os) => (
                <button
                  key={os}
                  type="button"
                  className={`fr-segmented__btn${osTarget === os ? ' is-active' : ''}`}
                  onClick={() => setOsTarget(os)}
                >
                  {os === 'mac' ? 'macOS' : os === 'linux' ? 'Linux' : 'Windows'}
                </button>
              ))}
            </div>

            <div className="fr-segmented" role="group" aria-label="SSH key algorithm">
              {(['ed25519', 'rsa'] as const).map((alg) => (
                <button
                  key={alg}
                  type="button"
                  className={`fr-segmented__btn${algorithm === alg ? ' is-active' : ''}`}
                  onClick={() => setAlgorithm(alg)}
                >
                  {alg.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {pushErrorInput.trim() && (
            <div className="fr-bundle-box">
              <strong>{errorDiagnostic.headline}</strong>
              <p className="fr-muted">{errorDiagnostic.explanation}</p>
            </div>
          )}

          <p className="fr-muted">
            {completedStepIds.length} of {steps.length} setup steps checked ·{' '}
            <a href="https://github.com/settings/ssh/new" target="_blank" rel="noopener noreferrer">
              GitHub SSH Key Settings ↗
            </a>
          </p>

          <ol className="fr-steps-list">
            {steps.map((step) => {
              const checked = completedStepIds.includes(step.id)
              return (
                <li key={step.id} className="fr-saved-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label className="fr-checkbox-label">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStep(step.id)}
                      />
                      <strong>
                        Step {step.number}: {step.title}
                      </strong>
                    </label>
                    <p className="fr-muted">{step.description}</p>
                    <pre className="fr-code-block">{step.command}</pre>
                    {step.note && <p className="fr-muted">{step.note}</p>}
                  </div>
                  <button
                    type="button"
                    className="fr-btn-secondary"
                    onClick={() => {
                      void navigator.clipboard?.writeText(step.command)
                      setCopiedStepId(step.id)
                      window.setTimeout(() => setCopiedStepId(null), 1600)
                    }}
                  >
                    {copiedStepId === step.id ? 'Copied!' : 'Copy CLI'}
                  </button>
                </li>
              )
            })}
          </ol>

          <p className="fr-muted">
            <strong>Prefer HTTPS instead of SSH?</strong> Authenticate GitHub CLI with{' '}
            <code>gh auth login</code> and set <code>git remote set-url origin {repoUrl}.git</code>.
          </p>
        </div>
      )}
    </section>
  )
}
