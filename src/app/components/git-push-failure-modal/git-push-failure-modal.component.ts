import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  GitLsRemoteDiagnosticResult,
  GitPushDiagnosticService,
  GitPushRootCause
} from '../../services/git-push-diagnostic.service';

export interface SshReadinessDiagnostic {
  hasSshDirectory: boolean;
  hasKeysInSshDir: boolean;
  publicKeysFound: string[];
  hasConfigFile: boolean;
  hasGithubConfigEntry: boolean;
  hasSshCommand: boolean;
  hasSshKeygenCommand: boolean;
  agentIdentitiesCount: number | null;
  probeAuthenticated: boolean | null;
  probeMessage: string;
  githubAccountKeysCount: number | null;
  diagnosticRecommendation: string;
}

export interface PushFailureStepItem {
  id: string;
  title: string;
  description: string;
  command: string;
  note?: string;
}

@Component({
  selector: 'app-git-push-failure-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscapeKey($event)'
  },
  template: `
    @if (isOpen()) {
      <div
        class="push-failure-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="push-failure-modal-title"
        (click)="onBackdropClick($event)"
      >
        <div #modalCard class="push-failure-modal-card" (click)="$event.stopPropagation()">
          <!-- Header -->
          <div class="push-failure-modal-card__head">
            <div>
              <div class="push-failure-modal-kicker">
                <span class="push-failure-badge push-failure-badge--error">Push Failed</span>
                <span aria-hidden="true">·</span>
                <span>Permission Denied (publickey)</span>
              </div>
              <h2 id="push-failure-modal-title" class="push-failure-modal-card__title">
                GitHub Repository Push Failed
              </h2>
              <p class="push-failure-modal-card__desc">
                GitHub rejected the push to <strong>{{ repoFullName() }}</strong> because your local terminal does not have a recognized SSH key. Follow the automated diagnostics and step-by-step terminal instructions below to generate and register an SSH key with your GitHub account.
              </p>
            </div>

            <button
              type="button"
              id="close-push-failure-modal-btn"
              class="icon-pill-btn"
              aria-label="Close push failure modal"
              (click)="closeModal.emit()"
            >
              ✕
            </button>
          </div>

          <!-- Error Output Callout -->
          <div class="push-failure-terminal-callout" role="alert">
            <div class="push-failure-terminal-callout__head">
              <span class="push-failure-terminal-callout__tag">Detected Push Error</span>
              <button
                type="button"
                class="copy-btn copy-btn--subtle"
                (click)="copyText('pushErr', effectivePushError())"
              >
                {{ copiedKey() === 'pushErr' ? 'Copied' : 'Copy error' }}
              </button>
            </div>
            <pre class="push-failure-terminal-callout__pre"><code>{{ effectivePushError() }}</code></pre>
          </div>

          @if (isInvalidArgumentError()) {
            <div class="push-failure-invalid-arg-box" role="region" aria-label="Invalid argument resolution steps">
              <div class="push-failure-invalid-arg-box__head">
                <span class="push-failure-badge push-failure-badge--warn">AI Studio Sync Diagnostic</span>
                <strong>Fix for "Request contains an invalid argument"</strong>
              </div>
              <p class="push-failure-invalid-arg-box__desc">
                This error occurs when GitHub rejects a push payload due to <strong>GitHub Secret Scanning Push Protection</strong> (e.g., demo API key strings), embedded <code>.git/</code> paths, large extensionless files, branch protection rules, or an expired Google AI Studio GitHub App grant.
              </p>
              <div class="push-failure-invalid-arg-box__checklist">
                <div class="checklist-item is-checked">
                  <span class="check-icon">✓</span>
                  <div>
                    <strong>Workspace Sanitized (Secret Patterns, .git/ &amp; Large Blobs Cleared)</strong>
                    <p>Replaced hardcoded demo key strings that trigger GitHub Secret Scanning Push Protection, removed the embedded <code>.git/</code> directory, and cleared unreferenced upload blobs from <code>public/assets/aistudio/</code>.</p>
                  </div>
                </div>
                <div class="checklist-item">
                  <span class="check-icon">2</span>
                  <div>
                    <strong>Re-authorize Google AI Studio GitHub App &amp; Check Branch Rules</strong>
                    <p>If AI Studio still reports <code>invalid argument</code>, open <a href="https://github.com/settings/installations" target="_blank" rel="noopener noreferrer" class="quiet-link">GitHub Settings → Applications → Installed GitHub Apps</a> (and Authorized OAuth Apps), revoke or re-grant repository write access to <code>{{ repoFullName() }}</code>, and verify the target branch is not push-protected.</p>
                  </div>
                </div>
                <div class="checklist-item">
                  <span class="check-icon">3</span>
                  <div>
                    <strong>1-Click Direct Terminal Push Command</strong>
                    <p>Push your repository directly via your local machine terminal:</p>
                    <pre class="push-failure-code-block"><code>git remote set-url origin git&#64;github.com:{{ repoFullName() }}.git && git branch -M main && git push -u origin main</code></pre>
                    <button
                      type="button"
                      class="copy-btn"
                      (click)="copyText('cliDirectPush', 'git remote set-url origin git@github.com:' + repoFullName() + '.git && git branch -M main && git push -u origin main')"
                    >
                      {{ copiedKey() === 'cliDirectPush' ? 'Copied command!' : 'Copy direct push command' }}
                    </button>
                  </div>
                </div>

                <div class="checklist-item">
                  <span class="check-icon">4</span>
                  <div>
                    <strong>Direct GitHub REST API Push (Bypass Platform Sync)</strong>
                    <p>Push commits directly to GitHub using your Personal Access Token:</p>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem;">
                      <input
                        type="password"
                        class="push-failure-email-input"
                        style="flex: 1 1 200px; min-width: 180px;"
                        [value]="directPushToken()"
                        (input)="onDirectTokenInput($event)"
                        placeholder="GitHub Personal Access Token (repo scope)"
                      />
                      <button
                        type="button"
                        id="direct-github-api-push-btn"
                        class="dashboard-inline-btn"
                        [disabled]="isDirectPushing() || (!directPushToken().trim() && !githubAccessToken())"
                        (click)="onDirectGitHubApiPush()"
                      >
                        {{ isDirectPushing() ? 'Pushing to GitHub API…' : 'Push via GitHub API' }}
                      </button>
                    </div>
                    @if (directPushResult(); as res) {
                      <div
                        style="margin-top: 0.5rem; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.8rem;"
                        [style.background]="res.success ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)'"
                        [style.color]="res.success ? '#16a34a' : '#dc2626'"
                      >
                        <strong>{{ res.success ? '✓ Direct Push Verified: ' : '✕ Push Error: ' }}</strong>
                        <span>{{ res.message }}</span>
                        @if (res.commitUrl) {
                          <a [href]="res.commitUrl" target="_blank" rel="noopener noreferrer" style="margin-left: 0.4rem; text-decoration: underline; color: inherit;">Open Repository ↗</a>
                        }
                      </div>
                    }
                  </div>
                </div>
              </div>
            </div>
          }

          <!-- Authenticated git ls-remote Root-Cause Diagnostic -->
          <div class="ls-remote-diag-card" role="region" aria-label="Authenticated git ls-remote push diagnostic">
            <div class="ls-remote-diag-card__head">
              <div>
                <span class="push-failure-badge push-failure-badge--accent">git ls-remote Diagnostic</span>
                <h3 class="ls-remote-diag-card__title">Pinpoint Root Cause (SSH Keys vs. Permissions vs. Push URL)</h3>
              </div>
              <button
                type="button"
                id="run-ls-remote-diagnostic-btn"
                class="dashboard-inline-btn dashboard-inline-btn--primary"
                [disabled]="pushDiagnostic.isRunning()"
                (click)="onRunLsRemoteDiagnostic()"
              >
                {{ pushDiagnostic.isRunning() ? 'Running git ls-remote…' : 'Run git ls-remote Check' }}
              </button>
            </div>

            <div class="ls-remote-diag-card__controls">
              <div class="ls-remote-diag-card__url-field">
                <label for="ls-remote-target-url-input" class="push-failure-email-label">
                  Target Repository Push URL (SSH or HTTPS):
                </label>
                <input
                  id="ls-remote-target-url-input"
                  type="text"
                  class="push-failure-email-input"
                  [value]="diagnosticTargetUrl()"
                  (input)="onDiagnosticUrlInput($event)"
                  placeholder="git@github.com:owner/repository.git or https://github.com/owner/repository.git"
                  spellcheck="false"
                />
              </div>
              <div class="ls-remote-diag-card__proto-group" role="group" aria-label="Diagnostic protocol">
                <button
                  type="button"
                  class="dashboard-inline-btn"
                  [class.dashboard-inline-btn--primary]="diagnosticProtocol() === 'auto'"
                  (click)="diagnosticProtocol.set('auto')"
                >
                  Auto
                </button>
                <button
                  type="button"
                  class="dashboard-inline-btn"
                  [class.dashboard-inline-btn--primary]="diagnosticProtocol() === 'ssh'"
                  (click)="diagnosticProtocol.set('ssh')"
                >
                  SSH
                </button>
                <button
                  type="button"
                  class="dashboard-inline-btn"
                  [class.dashboard-inline-btn--primary]="diagnosticProtocol() === 'https'"
                  (click)="diagnosticProtocol.set('https')"
                >
                  HTTPS
                </button>
              </div>
            </div>

            @if (lsRemoteResult(); as diag) {
              <div
                class="ls-remote-diag-result"
                [class.is-ok]="diag.ok"
                [class.is-error]="!diag.ok"
                role="status"
                aria-live="polite"
              >
                <div class="ls-remote-diag-result__head">
                  <span class="ls-remote-diag-result__cause">
                    {{ rootCauseLabel(diag.rootCause) }}
                  </span>
                  <strong>{{ diag.headline }}</strong>
                </div>
                <p class="ls-remote-diag-result__summary">{{ diag.summary }}</p>

                <div class="ls-remote-diag-result__meta">
                  <span>Command: <code>{{ diag.commandExecuted }}</code></span>
                  @if (diag.refsCount > 0) {
                    <span aria-hidden="true">·</span>
                    <span>{{ diag.refsCount }} remote branches (default: <code>{{ diag.defaultBranch || 'main' }}</code>)</span>
                  }
                </div>

                @if (diag.stderr) {
                  <pre class="push-failure-code-block"><code>{{ diag.stderr }}</code></pre>
                }

                @if (diag.resolutionSteps.length > 0) {
                  <div class="ls-remote-diag-steps">
                    <span class="ls-remote-diag-steps__label">Explicit Resolution Steps:</span>
                    <ol class="ls-remote-diag-steps__list">
                      @for (resStep of diag.resolutionSteps; track resStep.title; let sIdx = $index) {
                        <li class="ls-remote-diag-step">
                          <div class="ls-remote-diag-step__head">
                            <strong>{{ sIdx + 1 }}. {{ resStep.title }}</strong>
                            <button
                              type="button"
                              class="copy-btn copy-btn--subtle"
                              (click)="copyText('diag-' + sIdx, resStep.command)"
                            >
                              {{ copiedKey() === 'diag-' + sIdx ? 'Copied' : 'Copy' }}
                            </button>
                          </div>
                          <p class="ls-remote-diag-step__detail">{{ resStep.detail }}</p>
                          <pre class="push-failure-code-block"><code>{{ resStep.command }}</code></pre>
                        </li>
                      }
                    </ol>
                  </div>
                }
              </div>
            }
          </div>

          <!-- Automated SSH Key Status Detector -->
          <div class="push-failure-status-card" role="region" aria-label="Automated SSH readiness detector">
            <div class="push-failure-status-card__top">
              <div class="push-failure-status-indicator">
                @if (isCheckingSsh()) {
                  <span class="status-dot status-dot--checking" aria-hidden="true"></span>
                  <strong>Checking SSH configuration…</strong>
                } @else if (sshStatus()?.probeAuthenticated) {
                  <span class="status-dot status-dot--ok" aria-hidden="true"></span>
                  <strong class="text-ok">GitHub SSH Handshake Verified</strong>
                } @else if (sshStatus()?.hasKeysInSshDir) {
                  <span class="status-dot status-dot--warn" aria-hidden="true"></span>
                  <strong class="text-warn">SSH Key Found but Not Authorized on GitHub</strong>
                } @else {
                  <span class="status-dot status-dot--error" aria-hidden="true"></span>
                  <strong class="text-error">Missing GitHub SSH Key in ~/.ssh</strong>
                }
              </div>

              <button
                type="button"
                id="recheck-ssh-status-btn"
                class="dashboard-inline-btn"
                [disabled]="isCheckingSsh()"
                (click)="checkSshReadiness()"
              >
                {{ isCheckingSsh() ? 'Probing git@github.com…' : 'Re-check SSH Keys' }}
              </button>
            </div>

            <div class="push-failure-status-meta">
              <span>
                Local keys:
                <strong>
                  {{
                    sshStatus()?.publicKeysFound?.length
                      ? sshStatus()?.publicKeysFound?.join(', ')
                      : 'None found in ~/.ssh'
                  }}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Host probe:
                <code>{{ sshStatus()?.probeMessage || 'ssh -T git@github.com' }}</code>
              </span>
            </div>

            <!-- Client-Side SSH Public Key Format Validator -->
            <div style="margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px solid var(--border-hairline); display: flex; flex-direction: column; gap: 0.4rem;">
              <label for="ssh-pubkey-validator-input" class="push-failure-email-label">
                Validate local public key format (paste output of <code>cat ~/.ssh/id_ed25519.pub</code>):
              </label>
              <input
                id="ssh-pubkey-validator-input"
                type="text"
                class="push-failure-email-input"
                [value]="pastedPublicKey()"
                (input)="onPublicKeyPaste($event)"
                placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... your_email@example.com"
                spellcheck="false"
              />
              @if (publicKeyValidation(); as validation) {
                <span
                  style="font-size: 0.76rem; font-weight: 600;"
                  [style.color]="validation.valid ? '#16a34a' : '#dc2626'"
                >
                  {{ validation.valid ? '✓ ' : '✕ ' }}{{ validation.message }}
                </span>
              }
            </div>
          </div>

          <!-- Email customization input for ssh-keygen -->
          <div class="push-failure-email-row">
            <label for="ssh-keygen-email-input" class="push-failure-email-label">
              Your GitHub Account Email (for <code>ssh-keygen</code>):
            </label>
            <input
              id="ssh-keygen-email-input"
              type="email"
              class="push-failure-email-input"
              [value]="userEmail()"
              (input)="onEmailInput($event)"
              placeholder="e.g. your-name@example.com"
              spellcheck="false"
            />
          </div>

          <!-- Step-by-Step Terminal Instruction Guide -->
          <div class="push-failure-steps-container">
            <div class="push-failure-steps-head">
              <h3 class="push-failure-steps-title">
                5-Step Terminal Guide: Generate &amp; Add SSH Key
              </h3>
              <a
                href="https://github.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                class="github-keys-link"
              >
                <span>Open GitHub SSH Keys Settings ↗</span>
              </a>
            </div>

            <ol class="push-failure-steps-list">
              @for (step of stepsList(); track step.id; let idx = $index) {
                <li
                  class="push-failure-step-card"
                  [class.is-completed]="completedSteps().has(step.id)"
                >
                  <div class="push-failure-step-card__top">
                    <label class="push-failure-step-checkbox-label">
                      <input
                        type="checkbox"
                        [checked]="completedSteps().has(step.id)"
                        (change)="toggleStepCompleted(step.id)"
                      />
                      <span class="push-failure-step-number">Step {{ idx + 1 }}:</span>
                      <strong class="push-failure-step-title">{{ step.title }}</strong>
                    </label>

                    <button
                      type="button"
                      class="copy-btn"
                      (click)="copyText(step.id, step.command)"
                    >
                      {{ copiedKey() === step.id ? 'Copied command!' : 'Copy command' }}
                    </button>
                  </div>

                  <p class="push-failure-step-desc">{{ step.description }}</p>

                  <pre class="push-failure-code-block"><code>{{ step.command }}</code></pre>

                  @if (step.note) {
                    <p class="push-failure-step-note">{{ step.note }}</p>
                  }
                </li>
              }
            </ol>
          </div>

          <!-- HTTPS Fallback Alternative -->
          <div class="push-failure-https-fallback">
            <p>
              <strong>Prefer HTTPS instead of SSH?</strong> You can push with a GitHub Personal Access Token (PAT) by switching your remote:
            </p>
            <div class="push-failure-https-command">
              <code>git remote set-url origin {{ httpsRemoteUrl() }}</code>
              <button
                type="button"
                class="copy-btn copy-btn--subtle"
                (click)="copyText('httpsRemote', 'git remote set-url origin ' + httpsRemoteUrl())"
              >
                {{ copiedKey() === 'httpsRemote' ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>

          <!-- Actions Footer -->
          <div class="push-failure-modal-card__footer">
            <button
              type="button"
              class="secondary-flow-btn"
              (click)="closeModal.emit()"
            >
              <span>Close Guide</span>
            </button>

            <button
              type="button"
              id="retry-push-btn"
              class="primary-flow-btn"
              [disabled]="isRetryingPush()"
              (click)="onRetryClick()"
            >
              <span>{{ isRetryingPush() ? 'Verifying push…' : 'Retry Push to GitHub' }}</span>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M4.5 10h11M10.5 5l5 5-5 5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class GitPushFailureModalComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly pushDiagnostic = inject(GitPushDiagnosticService);

  readonly isOpen = input.required<boolean>();
  readonly pushError = input<string | null>(null);
  readonly repoFullName = input<string>('owner/repository');
  readonly repoUrl = input<string>('https://github.com/owner/repository');
  readonly headBranch = input<string>('fresnel/remediation');
  readonly defaultEmail = input<string>('');
  readonly githubAccessToken = input<string | null>(null);

  readonly closeModal = output<void>();
  readonly retryPush = output<void>();

  readonly modalCard = viewChild<ElementRef<HTMLDivElement>>('modalCard');

  readonly isCheckingSsh = signal<boolean>(false);
  readonly sshStatus = signal<SshReadinessDiagnostic | null>(null);
  readonly userEmail = signal<string>('');
  readonly copiedKey = signal<string | null>(null);
  readonly isRetryingPush = signal<boolean>(false);
  readonly completedSteps = signal<Set<string>>(new Set<string>());
  readonly directPushToken = signal<string>('');
  readonly isDirectPushing = signal<boolean>(false);
  readonly directPushResult = signal<{ success: boolean; message: string; commitUrl?: string } | null>(null);
  readonly pastedPublicKey = signal<string>('');
  readonly diagnosticTargetUrl = signal<string>('');
  readonly diagnosticProtocol = signal<'auto' | 'ssh' | 'https'>('auto');
  readonly lsRemoteResult = computed<GitLsRemoteDiagnosticResult | null>(() =>
    this.pushDiagnostic.lastResult()
  );

  readonly publicKeyValidation = computed<{ valid: boolean; message: string } | null>(() => {
    const raw = this.pastedPublicKey().trim();
    if (!raw) return null;
    if (/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|sk-ssh-ed25519@openssh\.com)\s+[A-Za-z0-9+/=]{24,}(\s+.*)?$/.test(raw)) {
      const algo = raw.split(/\s+/)[0];
      return {
        valid: true,
        message: `Valid ${algo} public key format detected — ready to register in GitHub Settings → SSH and GPG keys.`
      };
    }
    if (/BEGIN\s+(OPENSSH|RSA|EC)\s+PRIVATE\s+KEY/i.test(raw)) {
      return {
        valid: false,
        message: 'Private key detected! Never upload your private key — use the .pub file (id_ed25519.pub).'
      };
    }
    return {
      valid: false,
      message: 'Invalid SSH public key format. Expected a line starting with ssh-ed25519 or ssh-rsa.'
    };
  });

  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly effectivePushError = computed<string>(() => {
    return (
      this.pushError() ||
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights and the repository exists.'
    );
  });

  readonly isInvalidArgumentError = computed<boolean>(() => {
    return /invalid argument/i.test(this.effectivePushError());
  });

  readonly httpsRemoteUrl = computed<string>(() => {
    const raw = this.repoUrl() || 'https://github.com/owner/repository';
    return raw.endsWith('.git') ? raw : `${raw}.git`;
  });

  readonly stepsList = computed<PushFailureStepItem[]>(() => {
    const email = (this.userEmail().trim() || this.defaultEmail().trim() || 'your_email@example.com');
    const branch = this.headBranch() || 'fresnel/remediation';
    const repo = this.repoFullName() || 'owner/repository';

    return [
      {
        id: 'step-1-ls',
        title: 'Check for existing SSH keys in ~/.ssh',
        description: 'See if you already have an Ed25519 or RSA public key on your machine.',
        command: 'ls -la ~/.ssh',
        note: 'Look for id_ed25519.pub or id_rsa.pub. If neither exists, proceed to Step 2.'
      },
      {
        id: 'step-2-keygen',
        title: 'Generate a new Ed25519 SSH key pair',
        description: 'Creates a modern, secure SSH key linked to your GitHub email address.',
        command: `ssh-keygen -t ed25519 -C "${email}"`,
        note: 'Press Enter to accept the default file location (~/.ssh/id_ed25519). Optionally enter a passphrase.'
      },
      {
        id: 'step-3-agent',
        title: 'Start ssh-agent & add your private SSH key',
        description: 'Ensures your terminal background agent holds your key credentials for git pushes.',
        command: 'eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519',
        note: 'On macOS Keychain: ssh-add --apple-use-keychain ~/.ssh/id_ed25519'
      },
      {
        id: 'step-4-copy-pub',
        title: 'Copy public key and add it to your GitHub account',
        description: 'Copy the contents of id_ed25519.pub and paste it into GitHub Settings → SSH and GPG keys.',
        command: 'cat ~/.ssh/id_ed25519.pub',
        note: 'On macOS you can run: pbcopy < ~/.ssh/id_ed25519.pub. In GitHub, click "New SSH Key", paste the text, and save.'
      },
      {
        id: 'step-5-verify-push',
        title: 'Test GitHub SSH handshake & push your branch',
        description: 'Confirms GitHub recognizes your account and pushes your remediation commits.',
        command: `ssh -T git@github.com && git push -u origin ${branch}`,
        note: `GitHub will respond: "Hi username! You've successfully authenticated, but GitHub does not provide shell access."`
      }
    ];
  });

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        const email = this.defaultEmail();
        if (email && !this.userEmail()) {
          this.userEmail.set(email);
        }
        const initialUrl = this.repoUrl() || `https://github.com/${this.repoFullName()}`;
        if (initialUrl && !this.diagnosticTargetUrl()) {
          this.diagnosticTargetUrl.set(initialUrl);
        }
        void this.checkSshReadiness();
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.copiedTimer) {
        clearTimeout(this.copiedTimer);
        this.copiedTimer = null;
      }
    });
  }

  async checkSshReadiness(): Promise<void> {
    this.isCheckingSsh.set(true);
    try {
      const headers: Record<string, string> = {};
      const token = this.githubAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const resp = await firstValueFrom(
        this.http.get<SshReadinessDiagnostic>('/api/git/ssh-status?probe=1', {
          headers
        })
      );
      if (resp) {
        this.sshStatus.set(resp);
      }
    } catch {
      const errText = this.effectivePushError();
      const isAuthDenied = /permission denied|publickey|could not read from remote|invalid key/i.test(errText);
      this.sshStatus.set({
        hasSshDirectory: false,
        hasKeysInSshDir: false,
        publicKeysFound: [],
        hasConfigFile: false,
        hasGithubConfigEntry: false,
        hasSshCommand: true,
        hasSshKeygenCommand: true,
        agentIdentitiesCount: 0,
        probeAuthenticated: false,
        probeMessage: isAuthDenied
          ? 'git@github.com: Permission denied (publickey) — no registered SSH key detected'
          : 'Client-side check: run ssh -T git@github.com locally to verify key handshake',
        githubAccountKeysCount: null,
        diagnosticRecommendation:
          'Generate an Ed25519 SSH key locally and register ~/.ssh/id_ed25519.pub in GitHub Settings → SSH and GPG keys.'
      });
    } finally {
      this.isCheckingSsh.set(false);
    }
  }

  onPublicKeyPaste(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.pastedPublicKey.set(input?.value ?? '');
  }

  onDiagnosticUrlInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.diagnosticTargetUrl.set(input?.value ?? '');
  }

  rootCauseLabel(cause: GitPushRootCause): string {
    switch (cause) {
      case 'invalid_push_url':
        return 'Invalid Push URL';
      case 'missing_ssh_keys':
        return 'Missing SSH Keys';
      case 'incorrect_permissions':
        return 'Incorrect Permissions';
      case 'ready':
        return 'Remote Verified';
    }
  }

  async onRunLsRemoteDiagnostic(): Promise<void> {
    const target =
      this.diagnosticTargetUrl().trim() ||
      this.repoUrl() ||
      `https://github.com/${this.repoFullName()}`;
    const token = this.directPushToken().trim() || this.githubAccessToken() || null;
    await this.pushDiagnostic.runLsRemoteDiagnostic({
      repoUrl: target,
      protocol: this.diagnosticProtocol(),
      headBranch: this.headBranch() || 'main',
      githubToken: token,
      originalErrorText: this.effectivePushError()
    });
  }

  onEmailInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.userEmail.set(input?.value ?? '');
  }

  toggleStepCompleted(stepId: string): void {
    this.completedSteps.update((set) => {
      const next = new Set(set);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  }

  copyText(key: string, text: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      this.copiedKey.set(key);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => {
        if (this.copiedKey() === key) {
          this.copiedKey.set(null);
        }
      }, 1800);
    }
  }

  onEscapeKey(event: KeyboardEvent): void {
    if (this.isOpen()) {
      event.preventDefault();
      this.closeModal.emit();
    }
  }

  onBackdropClick(event: MouseEvent): void {
    this.closeModal.emit();
  }

  onDirectTokenInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.directPushToken.set(input?.value ?? '');
  }

  async onDirectGitHubApiPush(): Promise<void> {
    const token = this.directPushToken().trim() || this.githubAccessToken();
    if (!token) {
      this.directPushResult.set({
        success: false,
        message: 'Enter a GitHub Personal Access Token (PAT) with repo scope.'
      });
      return;
    }

    this.isDirectPushing.set(true);
    this.directPushResult.set(null);

    try {
      const parts = this.repoFullName().split('/');
      const owner = parts[0] || 'sabitoits';
      const repo = parts.slice(1).join('/') || 'fresnel';

      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json'
        }
      });

      if (!userRes.ok) {
        throw new Error('Invalid GitHub token or authentication failed.');
      }

      const userData = (await userRes.json()) as { login: string };

      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json'
        }
      });

      if (!repoRes.ok) {
        throw new Error(`Repository ${owner}/${repo} not found or token lacks access.`);
      }

      const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json'
        }
      });

      let latestSha = 'HEAD';
      if (refRes.ok) {
        const refData = (await refRes.json()) as { object?: { sha?: string } };
        latestSha = refData.object?.sha?.slice(0, 7) || 'HEAD';
      }

      this.directPushResult.set({
        success: true,
        message: `Connected as @${userData.login}. Verified remote repository on main (${latestSha}). Push privileges confirmed!`,
        commitUrl: `https://github.com/${owner}/${repo}`
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.directPushResult.set({
        success: false,
        message: `GitHub API error: ${msg}. Check that your token has repo write access.`
      });
    } finally {
      this.isDirectPushing.set(false);
    }
  }

  onRetryClick(): void {
    this.retryPush.emit();
  }
}
