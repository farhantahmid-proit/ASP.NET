import { Injectable, computed, signal } from '@angular/core';
import { Workbox } from 'workbox-window';
import {
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord
} from '../models/audit.model';
import {
  serializeConsolidatedAuditHistoryJson,
  toNormalizedLocalRecord
} from './local-audit-storage.service';

export type ServiceWorkerStatus =
  | 'unsupported'
  | 'registering'
  | 'active'
  | 'update-ready'
  | 'error';

export const OFFLINE_AUDITS_CACHE_NAME = 'fresnel-saved-audits-offline-v1';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * Manages the Workbox service worker lifecycle (`workbox-window`), Cache Storage
 * mirroring of saved audit reports for zero-network offline viewing, browser
 * connectivity detection, and PWA install prompt state.
 */
@Injectable({
  providedIn: 'root'
})
export class PwaOfflineService {
  private workbox: Workbox | null = null;
  private deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  private initialized = false;

  readonly isOnline = signal<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  readonly swStatus = signal<ServiceWorkerStatus>('registering');
  readonly cachedAuditsCount = signal<number>(0);
  readonly lastOfflineSyncIso = signal<string | null>(null);
  readonly isInstallable = signal<boolean>(false);
  readonly isInstalled = signal<boolean>(false);
  readonly isIOS = signal<boolean>(false);

  readonly isOfflineReady = computed<boolean>(
    () => this.swStatus() === 'active' || this.swStatus() === 'update-ready'
  );

  constructor() {
    if (typeof window !== 'undefined') {
      this.initialize();
    }
  }

  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.detectInstallPlatform();
    this.bindConnectivityEvents();
    this.bindInstallPromptEvents();
    void this.registerWorkboxServiceWorker();
  }

  private detectInstallPlatform(): void {
    try {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      this.isInstalled.set(isStandalone);

      const ua = (window.navigator.userAgent || '').toLowerCase();
      this.isIOS.set(/iphone|ipad|ipod/.test(ua));
    } catch {
      // Ignore in restricted browser contexts
    }
  }

  private bindConnectivityEvents(): void {
    window.addEventListener('online', () => {
      this.isOnline.set(true);
    });
    window.addEventListener('offline', () => {
      this.isOnline.set(false);
    });
  }

  private bindInstallPromptEvents(): void {
    window.addEventListener('beforeinstallprompt', (event: Event) => {
      event.preventDefault();
      this.deferredInstallPrompt = event as BeforeInstallPromptEvent;
      this.isInstallable.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.isInstalled.set(true);
      this.isInstallable.set(false);
      this.deferredInstallPrompt = null;
    });
  }

  async registerWorkboxServiceWorker(): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      this.swStatus.set('unsupported');
      return;
    }

    try {
      this.swStatus.set('registering');
      const wb = new Workbox('/sw.js', { scope: '/' });
      this.workbox = wb;

      wb.addEventListener('installed', (event) => {
        if (event.isUpdate) {
          this.swStatus.set('update-ready');
        } else {
          this.swStatus.set('active');
        }
      });

      wb.addEventListener('activated', () => {
        this.swStatus.set('active');
      });

      wb.addEventListener('waiting', () => {
        this.swStatus.set('update-ready');
      });

      wb.addEventListener('controlling', () => {
        this.swStatus.set('active');
      });

      await wb.register();
      if (this.swStatus() === 'registering') {
        this.swStatus.set('active');
      }
    } catch {
      this.swStatus.set('error');
    }
  }

  async applyPendingUpdate(): Promise<void> {
    if (!this.workbox) return;
    this.workbox.addEventListener('controlling', () => {
      window.location.reload();
    });
    this.workbox.messageSkipWaiting();
  }

  async installApp(): Promise<boolean> {
    if (!this.deferredInstallPrompt) return false;
    await this.deferredInstallPrompt.prompt();
    const { outcome } = await this.deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      this.isInstalled.set(true);
      this.isInstallable.set(false);
      this.deferredInstallPrompt = null;
      return true;
    }
    return false;
  }

  /**
   * Mirrors the current Saved Audits list into Cache Storage (`fresnel-saved-audits-offline-v1`)
   * so Workbox's CacheFirst route for `/offline-audits/*` can serve saved audit reports
   * even when the user opens Fresnel with zero internet connectivity.
   */
  async cacheSavedAuditsForOffline(
    records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
  ): Promise<number> {
    if (typeof caches === 'undefined') {
      return 0;
    }
    try {
      const cache = await caches.open(OFFLINE_AUDITS_CACHE_NAME);
      const normalized = records.map((r) => toNormalizedLocalRecord(r));

      // Store consolidated manifest index for instant offline hydration
      const indexJson = serializeConsolidatedAuditHistoryJson(normalized);
      await cache.put(
        new Request('/offline-audits/index.json'),
        new Response(indexJson, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Fresnel-Offline-Cache': 'workbox'
          }
        })
      );

      // Store individual audit snapshots under /offline-audits/<auditId>.json
      const activeKeys = new Set<string>(['/offline-audits/index.json']);
      for (const rec of normalized) {
        const safeId = encodeURIComponent(rec.auditId);
        const pathKey = `/offline-audits/${safeId}.json`;
        activeKeys.add(pathKey);
        await cache.put(
          new Request(pathKey),
          new Response(JSON.stringify(rec), {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'X-Fresnel-Offline-Cache': 'workbox'
            }
          })
        );
      }

      // Evict stale deleted audit entries from the offline cache bucket
      const existingRequests = await cache.keys();
      for (const req of existingRequests) {
        const reqPath = new URL(req.url).pathname;
        if (reqPath.startsWith('/offline-audits/') && !activeKeys.has(reqPath)) {
          await cache.delete(req);
        }
      }

      this.cachedAuditsCount.set(normalized.length);
      this.lastOfflineSyncIso.set(new Date().toISOString());
      return normalized.length;
    } catch {
      return 0;
    }
  }

  /**
   * Reads the consolidated Saved Audits snapshot back from Cache Storage if the
   * user launches offline with an empty LocalStorage/IndexedDB state.
   */
  async readCachedAuditsFromOfflineCache(): Promise<LocalSavedAuditRecord[]> {
    if (typeof caches === 'undefined') return [];
    try {
      const cache = await caches.open(OFFLINE_AUDITS_CACHE_NAME);
      const response = await cache.match('/offline-audits/index.json');
      if (!response) return [];
      const parsed = (await response.json()) as { records?: LocalSavedAuditRecord[] };
      return Array.isArray(parsed.records) ? parsed.records : [];
    } catch {
      return [];
    }
  }
}
