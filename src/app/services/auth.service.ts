import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord,
  UserSessionState
} from '../models/audit.model';
import { FirebaseAuthService } from './firebase-auth.service';
import { LocalAuditStorageService } from './local-audit-storage.service';

export const GOOGLE_PROFILE_CACHE_STORAGE_KEY = 'fresnel_google_profile_cache_v1';
export const GOOGLE_AUDIT_HISTORY_CACHE_STORAGE_KEY = 'fresnel_google_audit_history_cache_v1';
export const GOOGLE_CLIENT_ID_STORAGE_KEY = 'fresnel_google_client_id';

export interface CachedGoogleUserProfile {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  providerId: 'google.com';
  authMode: 'gis' | 'firebase';
  cachedAtIso: string;
  expiresAtMs?: number | null;
}

export interface DecodedGisJwtClaims {
  sub: string;
  name?: string;
  given_name?: string;
  email?: string;
  picture?: string;
  exp?: number;
}

interface GisGlobalWindow {
  __FRESNEL_GOOGLE_CLIENT_ID__?: string;
  google?: {
    accounts?: {
      id?: {
        disableAutoSelect?: () => void;
      };
    };
  };
}

function isSafePhotoUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed.slice(0, 500);
  }
  return null;
}

/**
 * Safely decodes a Google Identity Services Base64URL-encoded JWT ID token payload
 * entirely on the client to extract user profile claims (sub, name, email, picture, exp).
 */
export function decodeGisJwtPayload(credential: string): DecodedGisJwtClaims | null {
  if (!credential || typeof credential !== 'string') return null;
  const parts = credential.split('.');
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLen);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const jsonText = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(jsonText) as Partial<DecodedGisJwtClaims>;

    if (!parsed || typeof parsed.sub !== 'string' || !parsed.sub.trim()) {
      return null;
    }

    if (typeof parsed.exp === 'number' && parsed.exp * 1000 < Date.now() - 30_000) {
      return null;
    }

    return {
      sub: parsed.sub.trim().slice(0, 128),
      name: typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 160) : undefined,
      given_name:
        typeof parsed.given_name === 'string' ? parsed.given_name.trim().slice(0, 80) : undefined,
      email: typeof parsed.email === 'string' ? parsed.email.trim().slice(0, 200) : undefined,
      picture: isSafePhotoUrl(parsed.picture) ?? undefined,
      exp: typeof parsed.exp === 'number' ? parsed.exp : undefined
    };
  } catch {
    return null;
  }
}

function readCachedGoogleProfile(): CachedGoogleUserProfile | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(GOOGLE_PROFILE_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedGoogleUserProfile>;
    if (
      typeof parsed?.uid === 'string' &&
      parsed.uid.length > 0 &&
      typeof parsed?.displayName === 'string' &&
      parsed.providerId === 'google.com'
    ) {
      if (
        typeof parsed.expiresAtMs === 'number' &&
        parsed.expiresAtMs > 0 &&
        parsed.expiresAtMs < Date.now()
      ) {
        return null;
      }
      return {
        uid: parsed.uid,
        displayName: parsed.displayName,
        email: typeof parsed.email === 'string' ? parsed.email : null,
        photoURL: isSafePhotoUrl(parsed.photoURL),
        providerId: 'google.com',
        authMode: parsed.authMode === 'gis' ? 'gis' : 'firebase',
        cachedAtIso:
          typeof parsed.cachedAtIso === 'string'
            ? parsed.cachedAtIso
            : new Date().toISOString(),
        expiresAtMs: typeof parsed.expiresAtMs === 'number' ? parsed.expiresAtMs : null
      };
    }
    return null;
  } catch {
    return null;
  }
}

function readCachedGoogleAuditHistory(): SavedAuditHistoryRecord[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(GOOGLE_AUDIT_HISTORY_CACHE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SavedAuditHistoryRecord =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as Partial<SavedAuditHistoryRecord>).auditId === 'string' &&
          typeof (item as Partial<SavedAuditHistoryRecord>).repoFullName === 'string'
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}

function stripToHistoryRecord(
  rec: SavedAuditHistoryRecord | LocalSavedAuditRecord,
  ownerId: string
): SavedAuditHistoryRecord {
  return {
    auditId: rec.auditId,
    ownerId: rec.ownerId && rec.ownerId !== 'local' ? rec.ownerId : ownerId,
    repoFullName: rec.repoFullName,
    repoUrl: rec.repoUrl,
    branch: rec.branch || 'main',
    runPhase: rec.runPhase === 'lhr' ? 'lhr' : 'static',
    mode: rec.mode === 'demo' ? 'demo' : 'live',
    totalCommitsCount: rec.totalCommitsCount,
    selectedCommitsCount: rec.selectedCommitsCount,
    performanceBefore: rec.performanceBefore,
    performanceAfter: rec.performanceAfter,
    accessibilityBefore: rec.accessibilityBefore,
    accessibilityAfter: rec.accessibilityAfter,
    bestPracticesBefore: rec.bestPracticesBefore,
    bestPracticesAfter: rec.bestPracticesAfter,
    seoBefore: rec.seoBefore,
    seoAfter: rec.seoAfter,
    securityBefore: rec.securityBefore,
    securityAfter: rec.securityAfter,
    summaryNotes: rec.summaryNotes,
    commitTitles: Array.isArray(rec.commitTitles) ? rec.commitTitles.slice(0, 25) : [],
    createdAtIso: rec.createdAtIso,
    updatedAtIso: rec.updatedAtIso
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly fbAuth = inject(FirebaseAuthService);
  private readonly localAuditStorage = inject(LocalAuditStorageService);

  readonly isAccountMenuOpen = signal<boolean>(false);
  readonly cachedGoogleProfile = signal<CachedGoogleUserProfile | null>(readCachedGoogleProfile());
  readonly cachedGoogleAuditHistory = signal<SavedAuditHistoryRecord[]>(
    readCachedGoogleAuditHistory()
  );
  readonly gisError = signal<string | null>(null);
  readonly isProcessingGis = signal<boolean>(false);
  readonly lastHistorySyncIso = signal<string | null>(null);

  /**
   * Active client-side GIS session profile restored from LocalStorage or a fresh
   * Google Identity Services ID token response.
   */
  private readonly activeGisProfile = computed<CachedGoogleUserProfile | null>(() => {
    const cached = this.cachedGoogleProfile();
    if (!cached || cached.authMode !== 'gis') {
      return null;
    }
    if (cached.expiresAtMs && cached.expiresAtMs < Date.now()) {
      return null;
    }
    return cached;
  });

  readonly userSession = computed<UserSessionState>(() => {
    const live = this.fbAuth.userSession();
    if (live.isAuthenticated) {
      return live;
    }

    // Active client-side Google Identity Services session (persists across reloads until Logout)
    const gisProfile = this.activeGisProfile();
    if (gisProfile) {
      return {
        ...live,
        isAuthenticated: true,
        isAuthReady: true,
        uid: gisProfile.uid,
        displayName: gisProfile.displayName,
        photoURL: gisProfile.photoURL,
        providerId: 'google.com',
        profilePath: `users/${gisProfile.uid}`,
        savedAuditsCount: this.cachedGoogleAuditHistory().length
      };
    }

    // While Firebase Auth is still initializing on page refresh, hydrate cached Google profile smoothly
    const cached = this.cachedGoogleProfile();
    if (!live.isAuthReady && cached) {
      return {
        ...live,
        isAuthenticated: true,
        uid: cached.uid,
        displayName: cached.displayName,
        photoURL: cached.photoURL,
        providerId: 'google.com',
        profilePath: `users/${cached.uid}`,
        savedAuditsCount: this.cachedGoogleAuditHistory().length
      };
    }
    return live;
  });

  readonly isAuthenticated = computed<boolean>(() => this.userSession().isAuthenticated);
  readonly isAuthReady = computed<boolean>(
    () => this.fbAuth.isAuthReady() || this.activeGisProfile() !== null
  );
  readonly isSigningIn = computed<boolean>(
    () => this.fbAuth.isSigningIn() || this.isProcessingGis()
  );
  readonly authError = computed<string | null>(
    () => this.gisError() ?? this.fbAuth.authError()
  );

  readonly activeProvider = computed<'github.com' | 'google.com' | null>(
    () => this.userSession().providerId
  );

  readonly providerLabel = computed<string>(() => {
    const provider = this.activeProvider();
    if (provider === 'github.com') return 'GitHub';
    if (provider === 'google.com') {
      return this.activeGisProfile() ? 'Google Identity' : 'Google';
    }
    return '';
  });

  readonly displayName = computed<string>(() => {
    return this.userSession().displayName || this.cachedGoogleProfile()?.displayName || 'Account';
  });

  readonly userEmail = computed<string | null>(() => {
    return this.fbAuth.currentUser()?.email ?? this.cachedGoogleProfile()?.email ?? null;
  });

  readonly photoURL = computed<string | null>(() => {
    return isSafePhotoUrl(this.userSession().photoURL ?? this.cachedGoogleProfile()?.photoURL);
  });

  readonly hasGoogleLocalCache = computed<boolean>(() => this.cachedGoogleProfile() !== null);

  /**
   * Unified authenticated audit history: merges live Firestore audits with the
   * LocalStorage-synced Google audit history so offline and GIS sessions stay in sync.
   */
  readonly syncedAccountAudits = computed<SavedAuditHistoryRecord[]>(() => {
    const live = this.fbAuth.savedAudits();
    if (this.activeProvider() !== 'google.com') {
      return live;
    }

    const cached = this.cachedGoogleAuditHistory();
    if (live.length === 0) {
      return cached;
    }

    const merged = new Map<string, SavedAuditHistoryRecord>();
    for (const rec of cached) {
      merged.set(rec.auditId, rec);
    }
    for (const rec of live) {
      merged.set(rec.auditId, rec);
    }
    return Array.from(merged.values()).sort((a, b) => {
      const tA = new Date(a.updatedAtIso || a.createdAtIso || 0).getTime();
      const tB = new Date(b.updatedAtIso || b.createdAtIso || 0).getTime();
      return (Number.isFinite(tB) ? tB : 0) - (Number.isFinite(tA) ? tA : 0);
    });
  });

  constructor() {
    // Sync Firebase Google user profile & combined audit history into LocalStorage
    effect(() => {
      const user = this.fbAuth.currentUser();
      const session = this.fbAuth.userSession();
      const liveAudits = this.fbAuth.savedAudits();
      const localAudits = this.localAuditStorage.localAudits();
      const gisProfile = this.activeGisProfile();

      if (user && session.isAuthenticated && session.providerId === 'google.com') {
        const uid = session.uid || user.uid;
        const profile: CachedGoogleUserProfile = {
          uid,
          displayName:
            session.displayName || user.displayName || user.email?.split('@')[0] || 'Google User',
          email: user.email || null,
          photoURL: isSafePhotoUrl(user.photoURL),
          providerId: 'google.com',
          authMode: gisProfile ? 'gis' : 'firebase',
          cachedAtIso: new Date().toISOString(),
          expiresAtMs: gisProfile?.expiresAtMs ?? null
        };
        this.persistGoogleProfile(profile);
        this.syncAuditHistoryToLocalStorage([...liveAudits, ...localAudits], uid);
      } else if (gisProfile) {
        this.syncAuditHistoryToLocalStorage(
          [...this.cachedGoogleAuditHistory(), ...localAudits],
          gisProfile.uid
        );
      }
    });
  }

  /**
   * Resolves a configured Google Identity Services OAuth Client ID from runtime globals,
   * document meta tag (`google-signin-client_id`), or LocalStorage (never hardcoded).
   */
  resolveGoogleClientId(): string | null {
    if (typeof window === 'undefined') return null;
    const gsiWin = window as unknown as GisGlobalWindow;
    const fromGlobal = gsiWin.__FRESNEL_GOOGLE_CLIENT_ID__?.trim();
    if (fromGlobal) return fromGlobal;

    if (typeof document !== 'undefined') {
      const meta = document.querySelector<HTMLMetaElement>(
        'meta[name="google-signin-client_id"]'
      );
      const fromMeta = meta?.content?.trim();
      if (fromMeta) return fromMeta;
    }

    try {
      const fromStorage = window.localStorage.getItem(GOOGLE_CLIENT_ID_STORAGE_KEY)?.trim();
      if (fromStorage) return fromStorage;
    } catch {
      // ignore storage errors
    }

    return null;
  }

  /**
   * Handles a client-side Google Identity Services credential callback:
   * decodes the JWT profile claims, updates reactive user profile state,
   * syncs audit history with LocalStorage, and links to Firebase Auth if available.
   */
  async signInWithGisCredential(credential: string): Promise<boolean> {
    this.gisError.set(null);
    const claims = decodeGisJwtPayload(credential);
    if (!claims) {
      this.gisError.set('Google Identity Services returned an invalid or expired credential.');
      return false;
    }

    this.isProcessingGis.set(true);
    try {
      const uid = `gis_${claims.sub.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const displayName =
        claims.name ||
        claims.given_name ||
        claims.email?.split('@')[0] ||
        'Google User';

      const profile: CachedGoogleUserProfile = {
        uid,
        displayName,
        email: claims.email ?? null,
        photoURL: isSafePhotoUrl(claims.picture),
        providerId: 'google.com',
        authMode: 'gis',
        cachedAtIso: new Date().toISOString(),
        expiresAtMs: claims.exp ? claims.exp * 1000 : Date.now() + 1000 * 60 * 60 * 12
      };

      this.persistGoogleProfile(profile);
      this.syncAuditHistoryToLocalStorage(
        [...this.cachedGoogleAuditHistory(), ...this.localAuditStorage.localAudits()],
        uid
      );

      // Link into Firebase Auth when supported; client-side GIS session remains active even if offline
      await this.fbAuth.signInWithGoogleIdToken(credential);
      return true;
    } finally {
      this.isProcessingGis.set(false);
    }
  }

  /**
   * Deduplicates, normalizes, and persists the authenticated Google user's audit history
   * to LocalStorage (`fresnel_google_audit_history_cache_v1`).
   */
  syncAuditHistoryToLocalStorage(
    records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
    ownerId?: string
  ): void {
    const resolvedOwner =
      ownerId || this.userSession().uid || this.cachedGoogleProfile()?.uid || 'google_user';

    const byId = new Map<string, SavedAuditHistoryRecord>();
    for (const rec of records) {
      if (!rec?.auditId || !rec?.repoFullName) continue;
      const existing = byId.get(rec.auditId);
      const normalized = stripToHistoryRecord(rec, resolvedOwner);
      if (!existing) {
        byId.set(rec.auditId, normalized);
      } else {
        const tNew = new Date(normalized.updatedAtIso || normalized.createdAtIso || 0).getTime();
        const tOld = new Date(existing.updatedAtIso || existing.createdAtIso || 0).getTime();
        if (tNew >= tOld) {
          byId.set(rec.auditId, normalized);
        }
      }
    }

    const sorted = Array.from(byId.values())
      .sort((a, b) => {
        const tA = new Date(a.updatedAtIso || a.createdAtIso || 0).getTime();
        const tB = new Date(b.updatedAtIso || b.createdAtIso || 0).getTime();
        return (Number.isFinite(tB) ? tB : 0) - (Number.isFinite(tA) ? tA : 0);
      })
      .slice(0, 50);

    const prev = this.cachedGoogleAuditHistory();
    const unchanged =
      prev.length === sorted.length &&
      prev.every(
        (item, idx) =>
          item.auditId === sorted[idx].auditId &&
          item.updatedAtIso === sorted[idx].updatedAtIso &&
          item.selectedCommitsCount === sorted[idx].selectedCommitsCount
      );

    if (unchanged && prev.length > 0) {
      return;
    }

    this.persistGoogleAuditHistory(sorted);
  }

  private persistGoogleProfile(profile: CachedGoogleUserProfile): void {
    const prev = this.cachedGoogleProfile();
    if (
      prev &&
      prev.uid === profile.uid &&
      prev.displayName === profile.displayName &&
      prev.email === profile.email &&
      prev.photoURL === profile.photoURL &&
      prev.authMode === profile.authMode
    ) {
      return;
    }

    this.cachedGoogleProfile.set(profile);
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(GOOGLE_PROFILE_CACHE_STORAGE_KEY, JSON.stringify(profile));
    } catch {
      // ignore storage quota errors
    }
  }

  private persistGoogleAuditHistory(records: SavedAuditHistoryRecord[]): void {
    const bounded = records.slice(0, 50);
    this.cachedGoogleAuditHistory.set(bounded);
    this.lastHistorySyncIso.set(new Date().toISOString());
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(GOOGLE_AUDIT_HISTORY_CACHE_STORAGE_KEY, JSON.stringify(bounded));
    } catch {
      try {
        window.localStorage.setItem(
          GOOGLE_AUDIT_HISTORY_CACHE_STORAGE_KEY,
          JSON.stringify(bounded.slice(0, 15))
        );
      } catch {
        // ignore storage quota errors
      }
    }
  }

  clearGoogleLocalCache(): void {
    this.cachedGoogleProfile.set(null);
    this.cachedGoogleAuditHistory.set([]);
    this.lastHistorySyncIso.set(null);
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }
    try {
      window.localStorage.removeItem(GOOGLE_PROFILE_CACHE_STORAGE_KEY);
      window.localStorage.removeItem(GOOGLE_AUDIT_HISTORY_CACHE_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }

  async loginWithGitHub(): Promise<void> {
    this.gisError.set(null);
    this.closeAccountMenu();
    await this.fbAuth.signInWithGitHub();
  }

  async loginWithGoogle(): Promise<void> {
    this.gisError.set(null);
    this.closeAccountMenu();
    await this.fbAuth.signInWithGoogle();
  }

  async logout(): Promise<void> {
    this.gisError.set(null);
    this.closeAccountMenu();
    this.clearGoogleLocalCache();

    if (typeof window !== 'undefined') {
      const gsiWin = window as unknown as GisGlobalWindow;
      try {
        gsiWin.google?.accounts?.id?.disableAutoSelect?.();
      } catch {
        // ignore GIS disableAutoSelect error
      }
    }

    await this.fbAuth.signOutUser();
  }

  toggleAccountMenu(): void {
    this.isAccountMenuOpen.update((open) => !open);
  }

  openAccountMenu(): void {
    this.isAccountMenuOpen.set(true);
  }

  closeAccountMenu(): void {
    this.isAccountMenuOpen.set(false);
  }
}
