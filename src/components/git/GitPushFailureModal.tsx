import { useEffect, useMemo, useState } from 'react'
import { fetchGitSshStatus, parseAndValidateClientPushUrl } from '@/api/git/git'
import { useGitLsRemoteDiagnostic } from '@/api/git/git.hooks'
import type { GitPushRootCause } from '@/api/$types/git/response'
import type { GitHubSshDiagnosticStatus } from '@/types/audit'

export interface GitPushFailureModalProps {
  isOpen: boolean
  onClose: () => void
  onRetryPush?: () => void
  pushError?: string | null
  repoFullName?: string
  repoUrl?: string
  headBranch?: string
  defaultEmail?: string
  githubAccessToken?: string
}

function rootCauseLabel(cause: GitPushRootCause): string {
  switch (cause) {
    case 'invalid_push_url':
      return 'Invalid Push URL'
    case 'missing_ssh_keys':
      return 'Missing SSH Keys'
    case 'incorrect_permissions':
      return 'Incorrect Permissions'
    case 'ready':
      return 'Remote Verified'
  }
}

export function GitPushFailureModal({
  isOpen,
  onClose,
  onRetryPush,
  pushError,
  repoFullName = 'owner/repository',
  repoUrl = 'https://github.com/owner/repository',
  headBranch = 'fresnel/remediation',
  defaultEmail = '',
  githubAccessToken,
}: GitPushFailureModalProps) {
  const lsRemoteMutation = useGitLsRemoteDiagnostic()

  const [sshStatus, setSshStatus] = useState<GitHubSshDiagnosticStatus | null>(null)
  const [isCheckingSsh, setIsCheckingSsh] = useState(false)
  const [diagnosticUrl, setDiagnosticUrl] = useState(repoUrl)
  const [protocol, setProtocol] = useState<'auto' | 'ssh' | 'https'>('auto')
  const [userEmail, setUserEmail] = useState(defaultEmail)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const urlValidation = useMemo(
    () => parseAndValidateClientPushUrl(diagnosticUrl),
    [diagnosticUrl],
  )

  useEffect(() => {
    if (!isOpen) return
    if (repoUrl) setDiagnosticUrl(repoUrl)
    if (defaultEmail) setUserEmail(defaultEmail)

    setIsCheckingSsh(true)
    void fetchGitSshStatus({ probe: true, githubToken: githubAccessToken })
      .then((res) => setSshStatus(res))
      .catch(() => undefined)
      .finally(() => setIsCheckingSsh(false))
  }, [isOpen, repoUrl, defaultEmail, githubAccessToken])

  useEffect(() => {
    if (!isOpen) return
    const handleEscape = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const effectiveEmail = userEmail.trim() || defaultEmail.trim() || 'your_email@example.com'
  const effectiveError =
    pushError ||
    'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'

  function copyCommand(id: string, text: string) {
    void navigator.clipboard?.writeText(text)
    setCopiedKey(id)
    window.setTimeout(() => setCopiedKey(null), 1600)
  }

  async function handleRunLsRemote() {
    await lsRemoteMutation.mutateAsync({
      repoUrl: diagnosticUrl.trim() || repoUrl || `https://github.com/${repoFullName}`,
      protocol,
      headBranch: headBranch || 'main',
      githubToken: githubAccessToken,
    })
  }

  return (
    <div
      className="fr-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="git-push-modal-title"
      onClick={onClose}
    >
      <div className="fr-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="fr-section-head">
          <div>
            <p className="fr-eyebrow">
              <span className="fr-eyebrow-line" /> GIT PUSH &amp; SSH DIAGNOSTICS
            </p>
            <h2 id="git-push-modal-title" className="fr-section-title">
              Troubleshoot Git Push Failure ({repoFullName})
            </h2>
          </div>
          <button
            type="button"
            className="fr-btn-secondary"
            aria-label="Close Git push troubleshooter"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <pre className="fr-code-block">{effectiveError}</pre>

        <div className="fr-intake-grid">
          <label className="fr-field">
            <span className="fr-label">Remote Repository URL to Probe</span>
            <input
              type="text"
              className="fr-input"
              value={diagnosticUrl}
              onChange={(e) => setDiagnosticUrl(e.target.value)}
            />
          </label>

          <label className="fr-field">
            <span className="fr-label">Transport Protocol</span>
            <select
              className="fr-input"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as 'auto' | 'ssh' | 'https')}
            >
              <option value="auto">Auto</option>
              <option value="ssh">SSH (git@github.com)</option>
              <option value="https">HTTPS</option>
            </select>
          </label>
        </div>

        {!urlValidation.valid && urlValidation.reason && (
          <p className="fr-error" role="alert">
            {urlValidation.reason}
          </p>
        )}

        <div className="fr-actions">
          <button
            type="button"
            id="git-modal-ls-remote-btn"
            className="fr-btn-primary"
            disabled={lsRemoteMutation.isPending || !urlValidation.valid}
            onClick={() => void handleRunLsRemote()}
          >
            {lsRemoteMutation.isPending ? 'Probing Remote...' : 'Run git ls-remote Diagnostic'}
          </button>

          {onRetryPush && (
            <button type="button" className="fr-btn-secondary" onClick={onRetryPush}>
              Retry Push
            </button>
          )}
        </div>

        {isCheckingSsh ? (
          <p className="fr-muted">Probing local SSH readiness...</p>
        ) : sshStatus ? (
          <div className="fr-bundle-box">
            <strong>SSH Probe Status: {sshStatus.status}</strong>
            <p className="fr-muted">{sshStatus.probeMessage || sshStatus.recommendations[0]}</p>
          </div>
        ) : null}

        {lsRemoteMutation.data && (
          <div className="fr-bundle-box">
            <strong>
              {rootCauseLabel(lsRemoteMutation.data.rootCause)}: {lsRemoteMutation.data.headline}
            </strong>
            <p className="fr-muted">{lsRemoteMutation.data.summary}</p>
            {lsRemoteMutation.data.resolutionSteps.map((step) => (
              <div key={step.title} className="fr-saved-row">
                <div>
                  <strong>{step.title}</strong>
                  <p className="fr-muted">{step.detail}</p>
                  <pre className="fr-code-block">{step.command}</pre>
                </div>
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() => copyCommand(step.title, step.command)}
                >
                  {copiedKey === step.title ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="fr-bundle-box">
          <strong>Quick Ed25519 Key Setup ({effectiveEmail})</strong>
          <pre className="fr-code-block">{`ssh-keygen -t ed25519 -C "${effectiveEmail}"`}</pre>
          <button
            type="button"
            className="fr-btn-secondary"
            onClick={() =>
              copyCommand('keygen', `ssh-keygen -t ed25519 -C "${effectiveEmail}"`)
            }
          >
            {copiedKey === 'keygen' ? 'Copied ✓' : 'Copy ssh-keygen command'}
          </button>
        </div>
      </div>
    </div>
  )
}
