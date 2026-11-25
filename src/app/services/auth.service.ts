import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord,
  UserSessionState
} from '../models/audit.model';
import { FirebaseAuthService } from './firebase-auth.service';
import { LocalAuditStorageService } from './local-audit-storage.service';

export const ACCOUNT_PROFILE_CACHE_STORAGE_KEY = 'fresnel_account_profile_cache_v1';
export const ACCOUNT_AUDIT_HISTORY_CACHE_STORAGE_KEY = 'fresnel_account_audit_history_cache_v1';
export const GOOGLE_PROFILE_CACHE_STORAGE_KEY = 'fresnel_google_profile_cache_v1';
export const GOOGLE_AUDIT_HISTORY_CACHE_STORAGE_KEY = 'fresnel_google_audit_history_cache_v1';
export const GOOGLE_CLIENT_ID_STORAGE_KEY = 'fresnel_google_client_id';

export type AuthProviderId = 'github.com' | 'google.com';

export interface CachedAccountProfile {
  uid: string;
  displayName: string;
  githubUsername: string | null;
  email: string | null;
  photoURL: string | null;
  providerId: AuthProviderId;
  authMode: 'gis' | 'firebase';
  cachedAtIso: string;
  expiresAtMs?: number | null;
}

export interface CachedGoogleUserProfile extends CachedAccountProfile {
  providerId: 'google.com';
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

function parseCachedProfileFromKey(storageKey: string): CachedAccountProfile | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedAccountProfile>;
    if (
      typeof parsed?.uid === 'string' &&
      parsed.uid.length > 0 &&
      typeof parsed?.displayName === 'string' &&
      (parsed.providerId === 'google.com' || parsed.providerId === 'github.com')
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
        githubUsername: typeof parsed.githubUsername === 'string' ? parsed.githubUsername : null,
        email: typeof parsed.email === 'string' ? parsed.email : null,
        photoURL: isSafePhotoUrl(parsed.photoURL),
        providerId: parsed.providerId,
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

function readCachedAccountProfile(): CachedAccountProfile | null {
  return (
    parseCachedProfileFromKey(ACCOUNT_PROFILE_CACHE_STORAGE_KEY) ??
    parseCachedProfileFromKey(GOOGLE_PROFILE_CACHE_STORAGE_KEY)
  );
}

function readCachedHistoryFromKey(storageKey: string): SavedAuditHistoryRecord[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
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

function readCachedAccountAuditHistory(): SavedAuditHistoryRecord[] {
  const unified = readCachedHistoryFromKey(ACCOUNT_AUDIT_HISTORY_CACHE_STORAGE_KEY);
  if (unified.length > 0) return unified;
  return readCachedHistoryFromKey(GOOGLE_AUDIT_HISTORY_CACHE_STORAGE_KEY);
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

/**
 * AuthService manages unified authentication state for both GitHub OAuth and
 * Google Identity Services (GIS) user profiles, powering the topbar 'Account'
 * dropdown with seamless LocalStorage synchronization for profiles and audit history.
 */
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly fbAuth = inject(FirebaseAuthService);
  private readonly localAuditStorage = inject(LocalAuditStorageService);

  readonly isAccountMenuOpen = signal<boolean>(false);
  readonly cachedAccountProfile = signal<CachedAccountProfile | null>(readCachedAccountProfile());
  readonly cachedAccountAuditHistory = signal<SavedAuditHistoryRecord[]>(
    readCachedAccountAuditHistory()
  );

  /** Backward-compatible Google-scoped computed views */
  readonly cachedGoogleProfile = computed<CachedGoogleUserProfile | null>(() => {
    const profile = this.cachedAccountProfile();
    return profile && profile.providerId === 'google.com'
      ? (profile as CachedGoogleUserProfile)
      : null;
  });

  readonly cachedGoogleAuditHistory = computed<SavedAuditHistoryRecord[]>(() =>
    this.cachedAccountProfile()?.providerId === 'google.com'
      ? this.cachedAccountAuditHistory()
      : []
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
        githubUsername: null,
        photoURL: gisProfile.photoURL,
        providerId: 'google.com',
        profilePath: `users/${gisProfile.uid}`,
        savedAuditsCount: this.cachedAccountAuditHistory().length
      };
    }

    // While Firebase Auth is still initializing on page refresh, hydrate cached GitHub or Google profile smoothly
    const cached = this.cachedAccountProfile();
    if (!live.isAuthReady && cached) {
      return {
        ...live,
        isAuthenticated: true,
        uid: cached.uid,
        displayName: cached.displayName,
        githubUsername: cached.githubUsername,
        photoURL: cached.photoURL,
        providerId: cached.providerId,
        profilePath: `users/${cached.uid}`,
        savedAuditsCount: this.cachedAccountAuditHistory().length
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

  readonly activeProvider = computed<AuthProviderId | null>(
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
    return this.userSession().displayName || this.cachedAccountProfile()?.displayName || 'Account';
  });

  readonly userEmail = computed<string | null>(() => {
    return this.fbAuth.currentUser()?.email ?? this.cachedAccountProfile()?.email ?? null;
  });

  readonly photoURL = computed<string | null>(() => {
    return isSafePhotoUrl(this.userSession().photoURL ?? this.cachedAccountProfile()?.photoURL);
  });

  readonly hasLocalProfileCache = computed<boolean>(() => this.cachedAccountProfile() !== null);
  readonly hasGoogleLocalCache = computed<boolean>(() => this.cachedGoogleProfile() !== null);

  /**
   * Unified authenticated audit history for BOTH GitHub and Google accounts:
   * merges live Firestore audits with the LocalStorage-synced account audit history.
   */
  readonly syncedAccountAudits = computed<SavedAuditHistoryRecord[]>(() => {
    const live = this.fbAuth.savedAudits();
    const provider = this.activeProvider();
    if (!provider) {
      return live;
    }

    const cached =
      this.cachedAccountProfile()?.providerId === provider
        ? this.cachedAccountAuditHistory()
        : [];
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
    // Seamlessly sync BOTH GitHub and Google user profiles & audit history with LocalStorage
    effect(() => {
      const user = this.fbAuth.currentUser();
      const session = this.fbAuth.userSession();
      const liveAudits = this.fbAuth.savedAudits();
      const localAudits = this.localAuditStorage.localAudits();
      const gisProfile = this.activeGisProfile();

      if (
        user &&
        session.isAuthenticated &&
        (session.providerId === 'google.com' || session.providerId === 'github.com')
      ) {
        const uid = session.uid || user.uid;
        const providerId: AuthProviderId = session.providerId;
        const profile: CachedAccountProfile = {
          uid,
          displayName:
            session.displayName ||
            user.displayName ||
            user.email?.split('@')[0] ||
            (providerId === 'github.com' ? 'GitHub Developer' : 'Google User'),
          githubUsername: providerId === 'github.com' ? session.githubUsername : null,
          email: user.email || null,
          photoURL: isSafePhotoUrl(user.photoURL),
          providerId,
          authMode: providerId === 'google.com' && gisProfile ? 'gis' : 'firebase',
          cachedAtIso: new Date().toISOString(),
          expiresAtMs: providerId === 'google.com' ? (gisProfile?.expiresAtMs ?? null) : null
        };
        this.persistAccountProfile(profile);
        this.syncAuditHistoryToLocalStorage([...liveAudits, ...localAudits], uid, providerId);
      } else if (gisProfile) {
        this.syncAuditHistoryToLocalStorage(
          [...this.cachedAccountAuditHistory(), ...localAudits],
          gisProfile.uid,
          'google.com'
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
        githubUsername: null,
        email: claims.email ?? null,
        photoURL: isSafePhotoUrl(claims.picture),
        providerId: 'google.com',
        authMode: 'gis',
        cachedAtIso: new Date().toISOString(),
        expiresAtMs: claims.exp ? claims.exp * 1000 : Date.now() + 1000 * 60 * 60 * 12
      };

      this.persistAccountProfile(profile);
      this.syncAuditHistoryToLocalStorage(
        [...this.cachedAccountAuditHistory(), ...this.localAuditStorage.localAudits()],
        uid,
        'google.com'
      );

      // Link into Firebase Auth when supported; client-side GIS session remains active even if offline
      await this.fbAuth.signInWithGoogleIdToken(credential);
      return true;
    } finally {
      this.isProcessingGis.set(false);
    }
  }

  /**
   * Deduplicates, normalizes, and persists the authenticated user's audit history
   * (GitHub or Google) to LocalStorage.
   */
  syncAuditHistoryToLocalStorage(
    records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
    ownerId?: string,
    providerId?: AuthProviderId
  ): void {
    const resolvedOwner =
      ownerId || this.userSession().uid || this.cachedAccountProfile()?.uid || 'account_user';
    const resolvedProvider =
      providerId || this.activeProvider() || this.cachedAccountProfile()?.providerId || 'google.com';

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

    const prev = this.cachedAccountAuditHistory();
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

    this.persistAccountAuditHistory(sorted, resolvedProvider);
  }

  private persistAccountProfile(profile: CachedAccountProfile): void {
    const prev = this.cachedAccountProfile();
    if (
      prev &&
      prev.uid === profile.uid &&
      prev.displayName === profile.displayName &&
      prev.githubUsername === profile.githubUsername &&
      prev.email === profile.email &&
      prev.photoURL === profile.photoURL &&
      prev.providerId === profile.providerId &&
      prev.authMode === profile.authMode
    ) {
      return;
    }

    this.cachedAccountProfile.set(profile);
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }
    try {
      const serialized = JSON.stringify(profile);
      window.localStorage.setItem(ACCOUNT_PROFILE_CACHE_STORAGE_KEY, serialized);
      if (profile.providerId === 'google.com') {
        window.localStorage.setItem(GOOGLE_PROFILE_CACHE_STORAGE_KEY, serialized);
      } else {
        window.localStorage.removeItem(GOOGLE_PROFILE_CACHE_STORAGE_KEY);
      }
    } catch {
      // ignore storage quota errors
    }
  }

  private persistAccountAuditHistory(
    records: SavedAuditHistoryRecord[],
    providerId: AuthProviderId
  ): void {
    const bounded = records.slice(0, 50);
    this.cachedAccountAuditHistory.set(bounded);
    this.lastHistorySyncIso.set(new Date().toISOString());
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }
    const writeKey = (key: string, items: SavedAuditHistoryRecord[]) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(items));
      } catch {
        try {
          window.localStorage.setItem(key, JSON.stringify(items.slice(0, 15)));
        } catch {
          // ignore storage quota errors
        }
      }
    };

    writeKey(ACCOUNT_AUDIT_HISTORY_CACHE_STORAGE_KEY, bounded);
    if (providerId === 'google.com') {
      writeKey(GOOGLE_AUDIT_HISTORY_CACHE_STORAGE_KEY, bounded);
    }
  }

  clearAccountLocalCache(): void {
    this.cachedAccountProfile.set(null);
    this.cachedAccountAuditHistory.set([]);
    this.lastHistorySyncIso.set(null);
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return;
    }
    try {
      window.localStorage.removeItem(ACCOUNT_PROFILE_CACHE_STORAGE_KEY);
      window.localStorage.removeItem(ACCOUNT_AUDIT_HISTORY_CACHE_STORAGE_KEY);
      window.localStorage.removeItem(GOOGLE_PROFILE_CACHE_STORAGE_KEY);
      window.localStorage.removeItem(GOOGLE_AUDIT_HISTORY_CACHE_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }

  clearGoogleLocalCache(): void {
    this.clearAccountLocalCache();
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
    this.clearAccountLocalCache();

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
