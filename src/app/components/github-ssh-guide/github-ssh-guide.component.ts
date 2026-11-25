import { HttpClient, HttpHeaders } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GitHubSshDiagnosticStatus } from '../../models/audit.model';

export interface SshSetupStep {
  number: number;
  id: string;
  title: string;
  description: string;
  command: string;
  note?: string;
  externalUrl?: string;
  externalLabel?: string;
}

export function sanitizeSshEmail(rawEmail: string | null | undefined): string {
  const cleaned = String(rawEmail ?? '')
    .trim()
    .replace(/["'`$\\;\n\r|&<>(){}]/g, '')
    .slice(0, 120);
  if (!cleaned || !cleaned.includes('@')) {
    return 'you@example.com';
  }
  return cleaned;
}

export function sanitizeGitRepoPath(rawFullName: string | null | undefined): string {
  const cleaned = String(rawFullName ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._/-]/g, '');
  if (!cleaned || !cleaned.includes('/') || cleaned.includes('..')) {
    return 'owner/repository';
  }
  return cleaned;
}

export function sanitizePushBranch(rawBranch: string | null | undefined): string {
  const cleaned = String(rawBranch ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._/-]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');
  return cleaned || 'fresnel/oss-audit';
}

export function classifyPushErrorText(rawError: string | null | undefined): {
  isMissingSshKey: boolean;
  headline: string;
  explanation: string;
} {
  const text = String(rawError ?? '').trim().toLowerCase();
  if (!text) {
    return {
      isMissingSshKey: false,
      headline: 'Paste a git push error to diagnose',
      explanation: 'Example: "git@github.com: Permission denied (publickey)."'
    };
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
        'GitHub rejected the push because no matching SSH private/public key pair was offered by ssh-agent or linked to your GitHub account. Complete steps 1–5 below.'
    };
  }
  if (text.includes('host key verification failed')) {
    return {
      isMissingSshKey: true,
      headline: 'GitHub SSH known_hosts entry missing or mismatched',
      explanation:
        'Run ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts and re-test ssh -T git@github.com.'
    };
  }
  if (text.includes('repository not found') || text.includes('403') || text.includes('authentication failed')) {
    return {
      isMissingSshKey: true,
      headline: 'Repository authentication or permission error detected',
      explanation:
        'Ensure your SSH key is added to the GitHub account with write access to this repository, or switch origin to SSH with git remote set-url.'
    };
  }
  return {
    isMissingSshKey: false,
    headline: 'Error does not look SSH-specific, but you can verify SSH readiness below',
    explanation:
      'Run ssh -T git@github.com to confirm your local SSH identity works before pushing.'
  };
}

export function buildSshCliSteps(options: {
  email: string;
  algorithm: 'ed25519' | 'rsa';
  os: 'mac' | 'linux' | 'windows';
  repoFullName: string;
  headBranch: string;
}): SshSetupStep[] {
  const safeEmail = sanitizeSshEmail(options.email);
  const safeRepo = sanitizeGitRepoPath(options.repoFullName);
  const safeBranch = sanitizePushBranch(options.headBranch);
  const keyName = options.algorithm === 'rsa' ? 'id_rsa' : 'id_ed25519';

  const keygenCmd =
    options.algorithm === 'rsa'
      ? `ssh-keygen -t rsa -b 4096 -C "${safeEmail}"`
      : `ssh-keygen -t ed25519 -C "${safeEmail}"`;

  const agentCmd =
    options.os === 'mac'
      ? `eval "$(ssh-agent -s)"\nssh-add --apple-use-keychain ~/.ssh/${keyName}`
      : `eval "$(ssh-agent -s)"\nssh-add ~/.ssh/${keyName}`;

  const copyPubCmd =
    options.os === 'mac'
      ? `pbcopy < ~/.ssh/${keyName}.pub`
      : options.os === 'windows'
        ? `clip < ~/.ssh/${keyName}.pub`
        : `cat ~/.ssh/${keyName}.pub`;

  const configCmd = [
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh`,
    `cat << 'EOF' >> ~/.ssh/config`,
    `Host github.com`,
    `  HostName github.com`,
    `  User git`,
    `  AddKeysToAgent yes`,
    `  IdentityFile ~/.ssh/${keyName}`,
    `EOF`,
    `chmod 600 ~/.ssh/config`
  ].join('\n');

  const verifyPushCmd = [
    `ssh -T git@github.com`,
    `git remote set-url origin git@github.com:${safeRepo}.git`,
    `git push -u origin ${safeBranch}`
  ].join('\n');

  return [
    {
      number: 1,
      id: 'check-existing',
      title: 'Check for existing SSH keys',
      description: 'Verify if ~/.ssh already has an id_ed25519.pub or id_rsa.pub key pair.',
      command: 'ls -al ~/.ssh',
      note: 'If id_ed25519.pub already appears, skip Step 2 and load it in Step 3.'
    },
    {
      number: 2,
      id: 'generate-key',
      title: `Generate a new ${options.algorithm === 'rsa' ? 'RSA 4096' : 'Ed25519'} SSH key`,
      description: 'Press Enter at the file prompt to save to the default path, then choose a passphrase.',
      command: keygenCmd
    },
    {
      number: 3,
      id: 'add-to-agent',
      title: 'Start ssh-agent & register your private key',
      description: 'Loads your private key into the active SSH authentication agent.',
      command: agentCmd,
      note: 'Optional: configure ~/.ssh/config so git selects this key automatically:\n' + configCmd
    },
    {
      number: 4,
      id: 'add-to-github',
      title: 'Copy public key & add it to your GitHub account',
      description:
        'Copy only the .pub file contents, open GitHub SSH Settings, choose Authentication Key, and paste it.',
      command: copyPubCmd,
      externalUrl: 'https://github.com/settings/ssh/new',
      externalLabel: 'Open GitHub → New SSH Key ↗'
    },
    {
      number: 5,
      id: 'test-and-push',
      title: 'Verify GitHub SSH handshake & push your branch',
      description:
        'Confirms GitHub recognizes your account, sets the SSH remote URL, and pushes the audit branch.',
      command: verifyPushCmd,
      note: 'Expected output: "Hi <username>! You\'ve successfully authenticated, but GitHub does not provide shell access."'
    }
  ];
}

@Component({
  selector: 'app-github-ssh-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="ssh-guide-card"
      [class.is-missing]="isMissingKeyFlagged()"
      aria-labelledby="ssh-guide-title"
    >
      <div class="ssh-guide-card__head">
        <div class="ssh-guide-card__title-block">
          <div class="ssh-guide-status-row">
            @if (isChecking()) {
              <span class="ssh-status-badge ssh-status-badge--checking">
                Checking SSH readiness...
              </span>
            } @else if (isMissingKeyFlagged()) {
              <span class="ssh-status-badge ssh-status-badge--warn">
                <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path d="M9 2.5L16.2 15H1.8L9 2.5z" stroke-linejoin="round" />
                  <path d="M9 7.2v3.6M9 12.8h.01" stroke-linecap="round" />
                </svg>
                <span>GitHub SSH Key Missing</span>
              </span>
            } @else if (diagnostic()?.status === 'agent_unloaded') {
              <span class="ssh-status-badge ssh-status-badge--warn">
                <span>SSH Key Found · Not Loaded in Agent</span>
              </span>
            } @else {
              <span class="ssh-status-badge ssh-status-badge--ok">
                <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M4.2 9.4l3.1 3.1 6.5-6.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span>SSH Key Detected</span>
              </span>
            }

            @if (diagnostic(); as diag) {
              <span class="ssh-guide-meta-text">
                @if (diag.detectedPublicKeys.length > 0) {
                  Keys: {{ diag.detectedPublicKeys.join(', ') }}
                } @else {
                  No keys in ~/.ssh
                }
                @if (diag.agentLoadedCount !== null) {
                  <span aria-hidden="true">·</span>
                  <span>Agent identities: {{ diag.agentLoadedCount }}</span>
                }
                @if (diag.githubAccountKeysCount !== null) {
                  <span aria-hidden="true">·</span>
                  <span>GitHub account keys: {{ diag.githubAccountKeysCount }}</span>
                }
              </span>
            }
          </div>

          <h2 id="ssh-guide-title" class="ssh-guide-card__title">
            {{
              isMissingKeyFlagged()
                ? 'Missing GitHub SSH key — fix repository push failures'
                : 'GitHub SSH key readiness & push troubleshooting'
            }}
          </h2>
          <p class="ssh-guide-card__desc">
            @if (errorDiagnostic().isMissingSshKey) {
              {{ errorDiagnostic().explanation }}
            } @else if (isMissingKeyFlagged()) {
              Running <code>git push</code> over SSH fails with <code>Permission denied (publickey)</code> unless your machine has an SSH key registered with GitHub. Follow these 5 CLI steps in your local terminal.
            } @else {
              If pushing from your local terminal returns <code>Permission denied (publickey)</code>, verify your local <code>~/.ssh</code> key or follow the setup commands below.
            }
          </p>
        </div>

        <div class="ssh-guide-card__actions">
          <button
            type="button"
            id="ssh-recheck-status-btn"
            class="dashboard-inline-btn"
            [disabled]="isChecking()"
            (click)="checkSshStatus(false)"
          >
            {{ isChecking() ? 'Checking...' : 'Re-check SSH' }}
          </button>
          <button
            type="button"
            id="ssh-probe-github-btn"
            class="dashboard-inline-btn"
            [disabled]="isChecking()"
            (click)="checkSshStatus(true)"
            title="Run read-only ssh -T git@github.com handshake check"
          >
            Test ssh -T github.com
          </button>
          <button
            type="button"
            id="ssh-toggle-guide-btn"
            class="dashboard-inline-btn dashboard-inline-btn--primary"
            [attr.aria-expanded]="isExpanded()"
            (click)="isExpanded.set(!isExpanded())"
          >
            {{ isExpanded() ? 'Hide CLI Guide' : 'Show Step-by-Step Guide' }}
          </button>
        </div>
      </div>

      @if (diagnostic()?.probeMessage; as probeMsg) {
        <p class="ssh-probe-output" role="status" aria-live="polite">
          <strong>SSH Probe:</strong> {{ probeMsg }}
        </p>
      }

      @if (isExpanded()) {
        <div class="ssh-guide-body">
          <!-- Push Error Diagnostic Input (Helps users pushing from local machine) -->
          <div class="ssh-error-matcher">
            <label for="ssh-push-error-input" class="ssh-field-label">
              Diagnose a terminal <code>git push</code> error (optional):
            </label>
            <div class="ssh-error-matcher__row">
              <input
                id="ssh-push-error-input"
                type="text"
                class="ssh-text-input"
                placeholder="Paste error e.g. git@github.com: Permission denied (publickey)."
                [value]="pushErrorInput()"
                (input)="onPushErrorInput($event)"
                autocomplete="off"
                spellcheck="false"
              />
              <button
                type="button"
                class="dashboard-inline-btn"
                (click)="pushErrorInput.set('git@github.com: Permission denied (publickey).')"
              >
                Sample publickey error
              </button>
              @if (pushErrorInput()) {
                <button
                  type="button"
                  class="text-action-btn"
                  (click)="pushErrorInput.set('')"
                >
                  Clear
                </button>
              }
            </div>
            @if (pushErrorInput()) {
              <p class="ssh-error-matcher__result" role="status">
                <strong>{{ errorDiagnostic().headline }}:</strong> {{ errorDiagnostic().explanation }}
              </p>
            }
          </div>

          <!-- Personalization Controls -->
          <div class="ssh-guide-toolbar">
            <div class="ssh-toolbar-field">
              <label for="ssh-email-input" class="ssh-field-label">GitHub account email</label>
              <input
                id="ssh-email-input"
                type="email"
                class="ssh-text-input"
                placeholder="you@example.com"
                [value]="emailInput()"
                (input)="onEmailInput($event)"
                autocomplete="email"
                spellcheck="false"
              />
            </div>

            <div class="ssh-toolbar-field">
              <span class="ssh-field-label">Key algorithm</span>
              <div class="dashboard-segmented" role="group" aria-label="SSH key algorithm">
                <button
                  type="button"
                  class="dashboard-segmented__btn"
                  [class.is-active]="algorithm() === 'ed25519'"
                  (click)="algorithm.set('ed25519')"
                >
                  Ed25519
                </button>
                <button
                  type="button"
                  class="dashboard-segmented__btn"
                  [class.is-active]="algorithm() === 'rsa'"
                  (click)="algorithm.set('rsa')"
                >
                  RSA 4096
                </button>
              </div>
            </div>

            <div class="ssh-toolbar-field">
              <span class="ssh-field-label">Operating system</span>
              <div class="dashboard-segmented" role="group" aria-label="Operating system">
                <button
                  type="button"
                  class="dashboard-segmented__btn"
                  [class.is-active]="osTarget() === 'mac'"
                  (click)="osTarget.set('mac')"
                >
                  macOS
                </button>
                <button
                  type="button"
                  class="dashboard-segmented__btn"
                  [class.is-active]="osTarget() === 'linux'"
                  (click)="osTarget.set('linux')"
                >
                  Linux
                </button>
                <button
                  type="button"
                  class="dashboard-segmented__btn"
                  [class.is-active]="osTarget() === 'windows'"
                  (click)="osTarget.set('windows')"
                >
                  Windows Bash
                </button>
              </div>
            </div>
          </div>

          <!-- Progress Counter -->
          <div class="ssh-steps-progress">
            <span>{{ completedStepIds().size }} of {{ steps().length }} setup steps checked</span>
            <a
              class="ssh-github-settings-link"
              href="https://github.com/settings/ssh/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub SSH Key Settings ↗
            </a>
          </div>

          <!-- Step-by-Step CLI Cards -->
          <ol class="ssh-steps-list">
            @for (step of steps(); track step.id) {
              <li
                class="ssh-step-item"
                [class.is-completed]="completedStepIds().has(step.id)"
              >
                <div class="ssh-step-item__head">
                  <label class="ssh-step-item__check">
                    <input
                      type="checkbox"
                      [checked]="completedStepIds().has(step.id)"
                      (change)="toggleStepCompleted(step.id)"
                    />
                    <span class="ssh-step-item__num">Step {{ step.number }}</span>
                    <span class="ssh-step-item__title">{{ step.title }}</span>
                  </label>

                  <div class="ssh-step-item__actions">
                    @if (step.externalUrl) {
                      <a
                        class="dashboard-inline-btn dashboard-inline-btn--primary"
                        [href]="step.externalUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {{ step.externalLabel }}
                      </a>
                    }
                    <button
                      type="button"
                      class="copy-btn"
                      (click)="copyStepCommand(step.id, step.command)"
                    >
                      {{ copiedStepId() === step.id ? 'Copied!' : 'Copy CLI' }}
                    </button>
                  </div>
                </div>

                <p class="ssh-step-item__desc">{{ step.description }}</p>
                <pre class="ssh-step-item__pre"><code>{{ step.command }}</code></pre>
                @if (step.note) {
                  <p class="ssh-step-item__note">{{ step.note }}</p>
                }
              </li>
            }
          </ol>

          <p class="ssh-https-fallback">
            <strong>Prefer HTTPS instead of SSH?</strong> Authenticate GitHub CLI with
            <code>gh auth login</code> (HTTPS protocol) and set
            <code>git remote set-url origin {{ repoUrl() }}.git</code> before pushing.
          </p>
        </div>
      }
    </section>
  `
})
export class GithubSshGuideComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly repoFullName = input<string>('owner/repository');
  readonly repoUrl = input<string>('https://github.com/owner/repository');
  readonly headBranch = input<string>('fresnel/oss-audit');
  readonly defaultEmail = input<string>('');
  readonly githubAccessToken = input<string | null>(null);

  readonly diagnostic = signal<GitHubSshDiagnosticStatus | null>(null);
  readonly isChecking = signal<boolean>(false);
  readonly isExpanded = signal<boolean>(false);
  readonly emailInput = signal<string>('');
  readonly pushErrorInput = signal<string>('');
  readonly algorithm = signal<'ed25519' | 'rsa'>('ed25519');
  readonly osTarget = signal<'mac' | 'linux' | 'windows'>('mac');
  readonly copiedStepId = signal<string | null>(null);
  readonly completedStepIds = signal<Set<string>>(new Set());

  readonly errorDiagnostic = computed(() =>
    classifyPushErrorText(this.pushErrorInput())
  );

  readonly isMissingKeyFlagged = computed<boolean>(() => {
    if (this.errorDiagnostic().isMissingSshKey) return true;
    const diag = this.diagnostic();
    return Boolean(diag?.missingSshKey);
  });

  readonly steps = computed<SshSetupStep[]>(() =>
    buildSshCliSteps({
      email: this.emailInput() || this.defaultEmail() || 'you@example.com',
      algorithm: this.algorithm(),
      os: this.osTarget(),
      repoFullName: this.repoFullName(),
      headBranch: this.headBranch()
    })
  );

  ngOnInit(): void {
    if (typeof navigator !== 'undefined') {
      const ua = (navigator.userAgent || '').toLowerCase();
      if (ua.includes('win')) {
        this.osTarget.set('windows');
      } else if (ua.includes('linux')) {
        this.osTarget.set('linux');
      } else {
        this.osTarget.set('mac');
      }
    }
    if (this.defaultEmail() && !this.emailInput()) {
      this.emailInput.set(this.defaultEmail());
    }
    void this.checkSshStatus(false);
  }

  async checkSshStatus(probeRemote: boolean): Promise<void> {
    this.isChecking.set(true);
    try {
      const token = this.githubAccessToken();
      const headers = token
        ? new HttpHeaders({ Authorization: `Bearer ${token}` })
        : undefined;
      const url = probeRemote ? '/api/git/ssh-status?probe=1' : '/api/git/ssh-status';
      const resp = await firstValueFrom(
        this.http.get<GitHubSshDiagnosticStatus>(url, { headers })
      );
      this.diagnostic.set(resp);
      if (resp.missingSshKey || resp.status === 'agent_unloaded') {
        this.isExpanded.set(true);
      }
    } catch {
      // Keep last known diagnostic if backend check is unreachable
    } finally {
      this.isChecking.set(false);
    }
  }

  onEmailInput(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    this.emailInput.set(el?.value ?? '');
  }

  onPushErrorInput(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    const val = el?.value ?? '';
    this.pushErrorInput.set(val);
    if (classifyPushErrorText(val).isMissingSshKey) {
      this.isExpanded.set(true);
    }
  }

  toggleStepCompleted(stepId: string): void {
    const next = new Set(this.completedStepIds());
    if (next.has(stepId)) {
      next.delete(stepId);
    } else {
      next.add(stepId);
    }
    this.completedStepIds.set(next);
  }

  copyStepCommand(stepId: string, command: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(command);
      this.copiedStepId.set(stepId);
      setTimeout(() => {
        if (this.copiedStepId() === stepId) {
          this.copiedStepId.set(null);
        }
      }, 1600);
    }
  }
}
