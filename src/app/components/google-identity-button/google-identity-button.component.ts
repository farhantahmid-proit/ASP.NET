import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { AuditService } from '../../services/audit.service';

interface GisCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GisRenderButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
}

interface GoogleIdentityAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: GisCredentialResponse) => void;
    auto_select?: boolean;
    ux_mode?: 'popup' | 'redirect';
    context?: 'signin' | 'signup' | 'use';
  }) => void;
  renderButton: (parent: HTMLElement, options: GisRenderButtonOptions) => void;
  cancel?: () => void;
}

interface GoogleIdentityWindow {
  google?: {
    accounts?: {
      id?: GoogleIdentityAccountsId;
    };
  };
}

/**
 * Client-side Google Identity Services (GIS) login button component positioned as
 * the topbar sibling of `#github-login-btn`.
 *
 * When a GIS OAuth Client ID is available and `https://accounts.google.com/gsi/client`
 * loads, it initializes `google.accounts.id` and renders the official GIS pill button,
 * decoding the returned JWT credential into `AuthService` profile state and syncing
 * audit history to `LocalStorage`. When no custom client ID is configured or the GIS
 * script is blocked/offline, it renders a matching accessible Google Sign-In button
 * backed by client-side Google OAuth popup + LocalStorage sync.
 */
@Component({
  selector: 'app-google-identity-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gis-login-slot">
      <div
        #gisHost
        id="gis-rendered-btn-host"
        class="gis-rendered-btn-host"
        [style.display]="isNativeGisRendered() ? 'inline-flex' : 'none'"
      ></div>

      @if (!isNativeGisRendered()) {
        <button
          type="button"
          id="google-login-btn"
          class="auth-pill-btn auth-pill-btn--google"
          [disabled]="authService.isSigningIn()"
          (click)="onFallbackGoogleLogin()"
          title="Sign in with Google Identity Services to save your profile state and sync audit history with LocalStorage"
          aria-label="Sign in with Google"
        >
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33C2.44 15.88 5.48 18 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9.01 9.01 0 0 0 0 8.08l3-2.33z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.12.96 5.96l3 2.33c.71-2.13 2.7-3.71 5.04-3.71z"
            />
          </svg>
          <span>{{ authService.isSigningIn() ? 'Signing in…' : 'Google Login' }}</span>
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
      }

      .gis-login-slot {
        display: inline-flex;
        align-items: center;
      }

      .gis-rendered-btn-host {
        align-items: center;
        min-height: 36px;
      }
    `
  ]
})
export class GoogleIdentityButtonComponent {
  readonly authService = inject(AuthService);
  private readonly audit = inject(AuditService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly gisHost = viewChild<ElementRef<HTMLDivElement>>('gisHost');
  readonly isNativeGisRendered = signal<boolean>(false);

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private initializedClientId: string | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearPollTimer();
    });

    effect(() => {
      const hostEl = this.gisHost()?.nativeElement;
      const theme = this.audit.theme();
      if (!hostEl || typeof window === 'undefined') {
        return;
      }
      this.tryInitializeGisButton(hostEl, theme === 'dark');
    });
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private tryInitializeGisButton(hostEl: HTMLDivElement, isDark: boolean): void {
    const clientId = this.authService.resolveGoogleClientId();
    if (!clientId) {
      this.isNativeGisRendered.set(false);
      return;
    }

    const attemptRender = (): boolean => {
      const gsiId = (window as unknown as GoogleIdentityWindow).google?.accounts?.id;
      if (!gsiId) {
        return false;
      }

      try {
        if (this.initializedClientId !== clientId) {
          gsiId.initialize({
            client_id: clientId,
            callback: (resp: GisCredentialResponse) => {
              if (resp?.credential) {
                void this.authService.signInWithGisCredential(resp.credential);
              }
            },
            auto_select: false,
            ux_mode: 'popup',
            context: 'signin'
          });
          this.initializedClientId = clientId;
        }

        hostEl.replaceChildren();
        gsiId.renderButton(hostEl, {
          type: 'standard',
          theme: isDark ? 'filled_black' : 'outline',
          size: 'medium',
          text: 'signin_with',
          shape: 'pill',
          logo_alignment: 'left'
        });

        this.isNativeGisRendered.set(hostEl.childElementCount > 0);
        return true;
      } catch {
        this.isNativeGisRendered.set(false);
        return true;
      }
    };

    if (attemptRender()) {
      this.clearPollTimer();
      return;
    }

    // Poll briefly while async https://accounts.google.com/gsi/client finishes loading
    this.clearPollTimer();
    let attempts = 0;
    this.pollTimer = setInterval(() => {
      attempts += 1;
      if (attemptRender() || attempts >= 20) {
        this.clearPollTimer();
      }
    }, 250);
  }

  async onFallbackGoogleLogin(): Promise<void> {
    await this.authService.loginWithGoogle();
  }
}
