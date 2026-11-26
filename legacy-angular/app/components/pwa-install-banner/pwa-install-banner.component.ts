import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal
} from '@angular/core';
import { PwaOfflineService } from '../../services/pwa-offline.service';

@Component({
  selector: 'app-pwa-install-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!pwa.isInstalled()) {
      @if (pwa.isInstallable()) {
        <button
          type="button"
          id="pwa-install-app-btn"
          class="auth-pill-btn"
          (click)="pwa.installApp()"
          title="Install Fresnel as an offline-capable Progressive Web App"
        >
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M9 3v8.5M5.8 8.4L9 11.6l3.2-3.2M3.2 13.8h11.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Install App</span>
        </button>
      } @else if (pwa.isIOS()) {
        <button
          type="button"
          id="pwa-install-ios-btn"
          class="auth-pill-btn"
          (click)="showIosGuide.set(true)"
          title="Install Fresnel on iPhone or iPad for offline saved audit access"
        >
          <span>Install on iOS</span>
        </button>
      }
    }

    @if (showIosGuide()) {
      <div
        class="oauth-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-ios-install-title"
        (click)="showIosGuide.set(false)"
      >
        <div class="oauth-modal-card pwa-ios-modal" (click)="$event.stopPropagation()">
          <div class="oauth-modal-card__head">
            <h2 id="pwa-ios-install-title" class="oauth-modal-card__title">
              Install Fresnel on iPhone / iPad
            </h2>
            <button
              type="button"
              class="icon-pill-btn"
              aria-label="Close iOS install instructions"
              (click)="showIosGuide.set(false)"
            >
              ✕
            </button>
          </div>
          <ol class="oauth-setup-steps">
            <li>Tap the <strong>Share</strong> button in Safari&apos;s toolbar.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Launch Fresnel anytime to browse your cached Saved Audits offline.</li>
          </ol>
          <div class="oauth-modal-card__actions">
            <button
              type="button"
              class="primary-flow-btn"
              (click)="showIosGuide.set(false)"
            >
              <span>Got it</span>
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class PwaInstallButtonComponent {
  readonly pwa = inject(PwaOfflineService);
  readonly showIosGuide = signal<boolean>(false);
}

@Component({
  selector: 'app-pwa-offline-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!pwa.isOnline()) {
      <div
        id="pwa-offline-status-banner"
        class="pwa-status-banner pwa-status-banner--offline"
        role="status"
        aria-live="polite"
      >
        <div class="pwa-status-banner__copy">
          <strong>Offline Mode</strong>
          <span aria-hidden="true">·</span>
          <span>
            Viewing cached Saved Audits ({{ pwa.cachedAuditsCount() }} reports available via Workbox offline cache).
          </span>
        </div>
        <button
          type="button"
          class="dashboard-inline-btn"
          (click)="openSavedAudits.emit()"
        >
          Open Saved Audits
        </button>
      </div>
    } @else if (pwa.swStatus() === 'update-ready') {
      <div
        id="pwa-update-ready-banner"
        class="pwa-status-banner pwa-status-banner--update"
        role="status"
        aria-live="polite"
      >
        <div class="pwa-status-banner__copy">
          <strong>Offline cache update ready</strong>
          <span aria-hidden="true">·</span>
          <span>A newer version of Fresnel&apos;s offline service worker is ready.</span>
        </div>
        <button
          type="button"
          class="dashboard-inline-btn dashboard-inline-btn--primary"
          (click)="pwa.applyPendingUpdate()"
        >
          Reload to Update
        </button>
      </div>
    }
  `
})
export class PwaOfflineBannerComponent {
  readonly pwa = inject(PwaOfflineService);
  readonly openSavedAudits = output<void>();
}
