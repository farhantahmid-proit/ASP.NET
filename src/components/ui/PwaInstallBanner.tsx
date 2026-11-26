import { useState, useSyncExternalStore } from 'react'
import { pwaOfflineService } from '@/lib/services/pwa-offline'

export interface PwaInstallButtonProps {
  className?: string
}

export function PwaInstallButton({ className = '' }: PwaInstallButtonProps) {
  const state = useSyncExternalStore(
    pwaOfflineService.subscribe,
    pwaOfflineService.getSnapshot,
    pwaOfflineService.getSnapshot,
  )
  const [showIosGuide, setShowIosGuide] = useState(false)

  if (state.isInstalled) return null

  return (
    <>
      {state.isInstallable ? (
        <button
          type="button"
          id="pwa-install-app-btn"
          className={`fr-icon-btn ${className}`.trim()}
          onClick={() => void pwaOfflineService.installApp()}
          title="Install Fresnel as an offline-capable Progressive Web App"
        >
          Install App
        </button>
      ) : state.isIOS ? (
        <button
          type="button"
          id="pwa-install-ios-btn"
          className={`fr-icon-btn ${className}`.trim()}
          onClick={() => setShowIosGuide(true)}
          title="Install Fresnel on iPhone or iPad for offline saved audit access"
        >
          Install on iOS
        </button>
      ) : null}

      {showIosGuide && (
        <div
          className="fr-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-ios-install-title"
          onClick={() => setShowIosGuide(false)}
        >
          <div className="fr-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="fr-section-head">
              <h2 id="pwa-ios-install-title" className="fr-section-title">
                Install Fresnel on iPhone / iPad
              </h2>
              <button
                type="button"
                className="fr-icon-btn"
                aria-label="Close iOS install instructions"
                onClick={() => setShowIosGuide(false)}
              >
                ×
              </button>
            </div>
            <ol className="fr-steps-list">
              <li>Tap the <strong>Share</strong> button in Safari&apos;s toolbar.</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              <li>Launch Fresnel anytime to browse your cached Saved Audits offline.</li>
            </ol>
            <div className="fr-actions">
              <button
                type="button"
                className="fr-btn-primary"
                onClick={() => setShowIosGuide(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export interface PwaInstallBannerProps {
  onOpenSavedAudits: () => void
}

export function PwaInstallBanner({ onOpenSavedAudits }: PwaInstallBannerProps) {
  const state = useSyncExternalStore(
    pwaOfflineService.subscribe,
    pwaOfflineService.getSnapshot,
    pwaOfflineService.getSnapshot,
  )

  if (!state.isOnline) {
    return (
      <div
        id="pwa-offline-status-banner"
        className="fr-pwa-banner fr-pwa-banner--offline"
        role="status"
        aria-live="polite"
      >
        <div>
          <strong>Offline Mode</strong> · Viewing cached Saved Audits ({state.cachedAuditsCount}{' '}
          reports available via Workbox offline cache).
        </div>
        <button type="button" className="fr-btn-secondary" onClick={onOpenSavedAudits}>
          Open Saved Audits
        </button>
      </div>
    )
  }

  if (state.swStatus === 'update-ready') {
    return (
      <div
        id="pwa-update-ready-banner"
        className="fr-pwa-banner fr-pwa-banner--update"
        role="status"
        aria-live="polite"
      >
        <div>
          <strong>Offline cache update ready</strong> · A newer version of Fresnel&apos;s offline
          service worker is ready.
        </div>
        <button
          type="button"
          className="fr-btn-primary"
          onClick={() => pwaOfflineService.applyPendingUpdate()}
        >
          Reload to Update
        </button>
      </div>
    )
  }

  return null
}
