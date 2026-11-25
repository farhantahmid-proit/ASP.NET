import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  SavedAuditHistoryRecord,
  UserSessionState
} from '../models/audit.model';
import { FirebaseAuthService } from './firebase-auth.service';

export const GOOGLE_PROFILE_CACHE_STORAGE_KEY = 'fresnel_google_profile_cache_v1';
export const GOOGLE_AUDIT_HISTORY_CACHE_STORAGE_KEY = 'fresnel_google_audit_history_cache_v1';

export interface CachedGoogleUserProfile {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  providerId: 'google.com';
  cachedAtIso: string;
}

function isSafePhotoUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed.slice(0, 500);
  }
  return null;
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
      return {
        uid: parsed.uid,
        displayName: parsed.displayName,
        email: typeof parsed.email === 'string' ? parsed.email : null,
        photoURL: isSafePhotoUrl(parsed.photoURL),
        providerId: 'google.com',
        cachedAtIso:
          typeof parsed.cachedAtIso === 'string'
            ? parsed.cachedAtIso
            : new Date().toISOString()
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

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly fbAuth = inject(FirebaseAuthService);

  readonly isAccountMenuOpen = signal<boolean>(false);
  readonly cachedGoogleProfile = signal<CachedGoogleUserProfile | null>(readCachedGoogleProfile());
  readonly cachedGoogleAuditHistory = signal<SavedAuditHistoryRecord[]>(
    readCachedGoogleAuditHistory()
  );

  readonly userSession = computed<UserSessionState>(() => {
    const live = this.fbAuth.userSession();
    if (live.isAuthenticated) {
      return live;
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
  readonly isAuthReady = computed<boolean>(() => this.fbAuth.isAuthReady());
  readonly isSigningIn = computed<boolean>(() => this.fbAuth.isSigningIn());
  readonly authError = computed<string | null>(() => this.fbAuth.authError());

  readonly activeProvider = computed<'github.com' | 'google.com' | null>(
    () => this.userSession().providerId
  );

  readonly providerLabel = computed<string>(() => {
    const provider = this.activeProvider();
    if (provider === 'github.com') return 'GitHub';
    if (provider === 'google.com') return 'Google';
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
   * Unified authenticated audit history: returns live Firestore audits when available,
   * seamlessly falling back to the LocalStorage-cached Google audit history while offline
   * or during initial Firebase session hydration.
   */
  readonly syncedAccountAudits = computed<SavedAuditHistoryRecord[]>(() => {
    const live = this.fbAuth.savedAudits();
    if (live.length > 0) {
      return live;
    }
    if (this.activeProvider() === 'google.com') {
      return this.cachedGoogleAuditHistory();
    }
    return live;
  });

  constructor() {
    // Automatically cache Google user profile data & synced audit history in LocalStorage
    effect(() => {
      const user = this.fbAuth.currentUser();
      const session = this.fbAuth.userSession();
      const liveAudits = this.fbAuth.savedAudits();

      if (user && session.isAuthenticated && session.providerId === 'google.com') {
        const profile: CachedGoogleUserProfile = {
          uid: session.uid || user.uid,
          displayName: session.displayName || user.displayName || user.email?.split('@')[0] || 'Google User',
          email: user.email || null,
          photoURL: isSafePhotoUrl(user.photoURL),
          providerId: 'google.com',
          cachedAtIso: new Date().toISOString()
        };
        this.persistGoogleProfile(profile);

        if (liveAudits.length > 0) {
          this.persistGoogleAuditHistory(liveAudits);
        }
      }
    });
  }

  private persistGoogleProfile(profile: CachedGoogleUserProfile): void {
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
    this.closeAccountMenu();
    await this.fbAuth.signInWithGitHub();
  }

  async loginWithGoogle(): Promise<void> {
    this.closeAccountMenu();
    await this.fbAuth.signInWithGoogle();
  }

  async logout(): Promise<void> {
    this.closeAccountMenu();
    this.clearGoogleLocalCache();
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
