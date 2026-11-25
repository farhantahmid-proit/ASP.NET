import { Injectable, computed, signal } from '@angular/core';
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  Timestamp,
  Unsubscribe,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_FIRESTORE_DATABASE_ID,
  FIREBASE_PROJECT_ID,
  OperationType,
  auth,
  createGithubOAuthProvider,
  createGoogleOAuthProvider,
  db,
  handleFirestoreError,
} from '../firebase.config';
import {
  AuditCommit,
  AuditImpactMetrics,
  AuditMode,
  AuditRunPhase,
  AuditSession,
  SavedAuditHistoryRecord,
  UserSessionState,
} from '../models/audit.model';

@Injectable({ providedIn: 'root' })
export class FirebaseAuthService {
  readonly currentUser = signal<User | null>(null);
  readonly isAuthReady = signal<boolean>(false);
  readonly isSigningIn = signal<boolean>(false);
  readonly githubAccessToken = signal<string | null>(null);
  readonly authError = signal<string | null>(null);
  readonly showGithubSetupModal = signal<boolean>(false);
  readonly isHistoryDrawerOpen = signal<boolean>(false);
  readonly isHistoryModalOpen = signal<boolean>(false);
  readonly view4SubView = signal<'pr' | 'history'>('pr');
  readonly isLoadingHistory = signal<boolean>(false);
  readonly isSavingAudit = signal<boolean>(false);
  readonly saveSuccessBanner = signal<string | null>(null);
  readonly savedAudits = signal<SavedAuditHistoryRecord[]>([]);

  readonly projectId = FIREBASE_PROJECT_ID;
  readonly authDomain = FIREBASE_AUTH_DOMAIN;
  readonly firestoreDatabaseId = FIREBASE_FIRESTORE_DATABASE_ID;
  readonly firebaseProvidersConsoleUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`;
  readonly githubCallbackUrl = `https://${FIREBASE_AUTH_DOMAIN}/__/auth/handler`;

  readonly isAuthenticated = computed<boolean>(() => this.currentUser() !== null);

  readonly userDisplayLabel = computed<string>(() => {
    const u = this.currentUser();
    if (!u) return '';
    return u.displayName || u.email || 'GitHub Developer';
  });

  readonly userProviderBadge = computed<string>(() => {
    const u = this.currentUser();
    if (!u) return '';
    const isGithub = u.providerData?.some((p) => p.providerId === 'github.com');
    return isGithub ? 'GitHub' : 'Google';
  });

  /**
   * Reactive user session state derived from Firebase Authentication (GitHub OAuth)
   * and linked to the authenticated user's Firestore profile (/users/{uid}).
   */
  readonly userSession = computed<UserSessionState>(() => {
    const u = this.currentUser();
    const isGithub = u?.providerData?.some((p) => p.providerId === 'github.com') ?? false;
    const providerId: 'github.com' | 'google.com' | null = u
      ? isGithub
        ? 'github.com'
        : 'google.com'
      : null;
    const sanitizedUid = u ? this.sanitizeId(u.uid) : null;

    return {
      isAuthenticated: u !== null,
      isAuthReady: this.isAuthReady(),
      uid: sanitizedUid,
      displayName: u ? u.displayName || u.email?.split('@')[0] || 'GitHub Developer' : null,
      githubUsername: u && isGithub ? u.displayName || u.email?.split('@')[0] || null : null,
      photoURL: u?.photoURL ?? null,
      providerId,
      githubAccessToken: this.githubAccessToken(),
      projectId: this.projectId,
      authDomain: this.authDomain,
      firestoreDatabaseId: this.firestoreDatabaseId,
      profilePath: sanitizedUid ? `users/${sanitizedUid}` : null,
      savedAuditsCount: this.savedAudits().length,
    };
  });

  private profileAuditsUnsubscribe: Unsubscribe | null = null;
  private topLevelAuditsUnsubscribe: Unsubscribe | null = null;
  private profileAuditMap = new Map<string, SavedAuditHistoryRecord>();
  private topLevelAuditMap = new Map<string, SavedAuditHistoryRecord>();

  constructor() {
    if (typeof window !== 'undefined') {
      onAuthStateChanged(auth, async (user) => {
        this.currentUser.set(user);
        this.isAuthReady.set(true);
        if (user) {
          try {
            await this.ensureUserProfileDocument(user);
          } catch {
            // Handled by handleFirestoreError
          }
          this.subscribeToUserAudits(user.uid);
        } else {
          this.githubAccessToken.set(null);
          this.unsubscribeFromUserAudits();
          this.savedAudits.set([]);
        }
      });
    }
  }

  private sanitizeId(raw: string): string {
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    return cleaned || 'audit_record_1';
  }

  private truncate(str: string | undefined | null, maxLen: number, fallback = ''): string {
    const val = (str ?? '').trim() || fallback;
    return val.slice(0, maxLen);
  }

  private clampMetric(val: number): number {
    if (!Number.isFinite(val)) return 0;
    return Math.max(0, Math.min(100, Math.round(val)));
  }

  async signInWithGitHub(): Promise<void> {
    this.isSigningIn.set(true);
    this.authError.set(null);
    try {
      const provider = createGithubOAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const credential = GithubAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        this.githubAccessToken.set(credential.accessToken);
      }
      this.showGithubSetupModal.set(false);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      const msg = err instanceof Error ? err.message : String(err);

      if (
        code === 'auth/operation-not-allowed' ||
        code === 'auth/configuration-not-found' ||
        msg.includes('operation-not-allowed')
      ) {
        this.showGithubSetupModal.set(true);
        this.authError.set(
          'GitHub OAuth provider is not enabled yet in your Firebase Console. Follow the setup guide below or continue with Google Sign-In.'
        );
      } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        this.authError.set(`GitHub sign-in error: ${msg}`);
      }
    } finally {
      this.isSigningIn.set(false);
    }
  }

  async signInWithGoogle(): Promise<void> {
    this.isSigningIn.set(true);
    this.authError.set(null);
    try {
      // Check if Google Identity Services (GIS) client library is loaded with an explicit client ID
      const gsiWin = window as unknown as {
        google?: {
          accounts?: {
            id?: {
              initialize: (cfg: {
                client_id: string;
                callback: (resp: { credential?: string }) => void;
                auto_select?: boolean;
              }) => void;
              prompt: (cb?: (n: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean }) => void) => void;
            };
          };
        };
        __FRESNEL_GOOGLE_CLIENT_ID__?: string;
      };

      const gsiClientId = gsiWin.__FRESNEL_GOOGLE_CLIENT_ID__;
      if (gsiClientId && gsiWin.google?.accounts?.id) {
        const idToken = await new Promise<string | null>((resolve) => {
          let settled = false;
          const finish = (token: string | null) => {
            if (!settled) {
              settled = true;
              resolve(token);
            }
          };

          gsiWin.google!.accounts!.id!.initialize({
            client_id: gsiClientId,
            callback: (resp) => finish(resp?.credential ?? null),
            auto_select: false
          });

          gsiWin.google!.accounts!.id!.prompt((notification) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
              finish(null);
            }
          });

          setTimeout(() => finish(null), 4000);
        });

        if (idToken) {
          const credential = GoogleAuthProvider.credential(idToken);
          await signInWithCredential(auth, credential);
          this.showGithubSetupModal.set(false);
          return;
        }
      }

      // Standard client-side Google OAuth popup via Firebase Auth
      const provider = createGoogleOAuthProvider();
      await signInWithPopup(auth, provider);
      this.showGithubSetupModal.set(false);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      const msg = err instanceof Error ? err.message : String(err);
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        this.authError.set(`Sign-in error: ${msg}`);
      }
    } finally {
      this.isSigningIn.set(false);
    }
  }

  async signOutUser(): Promise<void> {
    this.unsubscribeFromUserAudits();
    await signOut(auth);
    this.githubAccessToken.set(null);
    this.savedAudits.set([]);
    this.isHistoryDrawerOpen.set(false);
  }

  toggleHistoryDrawer(): void {
    const next = !this.isHistoryDrawerOpen();
    this.isHistoryDrawerOpen.set(next);
    if (next && this.currentUser()) {
      void this.fetchSavedAuditsFromFirestore();
    }
  }

  openHistoryModal(): void {
    this.isHistoryModalOpen.set(true);
    if (this.currentUser()) {
      void this.fetchSavedAuditsFromFirestore();
    }
  }

  closeHistoryModal(): void {
    this.isHistoryModalOpen.set(false);
  }

  setView4SubView(subView: 'pr' | 'history'): void {
    this.view4SubView.set(subView);
    if (subView === 'history' && this.currentUser()) {
      void this.fetchSavedAuditsFromFirestore();
    }
  }

  /**
   * Explicitly fetches the authenticated user's saved audit history from Firestore
   * (/users/{uid}/audits and /audits where ownerId == uid) and updates savedAudits.
   */
  async fetchSavedAuditsFromFirestore(): Promise<SavedAuditHistoryRecord[]> {
    const user = this.currentUser();
    if (!user) return [];
    const sanitizedUid = this.sanitizeId(user.uid);
    this.isLoadingHistory.set(true);

    const profileAuditsPath = `users/${sanitizedUid}/audits`;
    try {
      const profileSnap = await getDocs(
        query(collection(db, 'users', sanitizedUid, 'audits'), where('ownerId', '==', sanitizedUid))
      );
      this.profileAuditMap.clear();
      profileSnap.forEach((docSnap) => {
        const rec = this.parseAuditSnapshotDoc(docSnap.id, docSnap.data(), sanitizedUid);
        this.profileAuditMap.set(rec.auditId, rec);
      });
    } catch (error) {
      this.isLoadingHistory.set(false);
      handleFirestoreError(error, OperationType.LIST, profileAuditsPath);
    }

    try {
      const topSnap = await getDocs(
        query(collection(db, 'audits'), where('ownerId', '==', sanitizedUid))
      );
      this.topLevelAuditMap.clear();
      topSnap.forEach((docSnap) => {
        const rec = this.parseAuditSnapshotDoc(docSnap.id, docSnap.data(), sanitizedUid);
        this.topLevelAuditMap.set(rec.auditId, rec);
      });
    } catch (error) {
      this.isLoadingHistory.set(false);
      handleFirestoreError(error, OperationType.LIST, 'audits');
    }

    this.syncCombinedAudits();
    this.isLoadingHistory.set(false);
    return this.savedAudits();
  }

  /**
   * Header GitHub Login / Profile History action:
   * Checks current Firebase auth state; if authenticated, opens/toggles the user's
   * profile saved audit history drawer. If unauthenticated, initiates GitHub OAuth sign-in.
   */
  async handleGithubAuthOrProfileHistory(): Promise<void> {
    const session = this.userSession();
    if (session.isAuthenticated && this.currentUser()) {
      this.toggleHistoryDrawer();
      return;
    }
    await this.signInWithGitHub();
  }

  openGithubSetupGuide(): void {
    this.showGithubSetupModal.set(true);
  }

  closeGithubSetupGuide(): void {
    this.showGithubSetupModal.set(false);
  }

  private async ensureUserProfileDocument(user: User): Promise<void> {
    const uid = this.sanitizeId(user.uid);
    const userPath = `users/${uid}`;
    const userRef = doc(db, 'users', uid);

    const isGithub = user.providerData?.some((p) => p.providerId === 'github.com');
    const providerId: 'github.com' | 'google.com' = isGithub ? 'github.com' : 'google.com';
    const displayName = this.truncate(
      user.displayName || user.email?.split('@')[0] || 'Developer',
      120,
      'Developer'
    );
    const githubUsername = this.truncate(
      isGithub ? user.displayName || user.email?.split('@')[0] || '' : '',
      100,
      ''
    );
    const photoURL = this.truncate(user.photoURL || '', 500, '');

    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid,
          displayName,
          githubUsername,
          photoURL,
          providerId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(userRef, {
          displayName,
          githubUsername,
          photoURL,
          providerId,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }

    // Store PII (email) in isolated /users/{uid}/private/info document
    const privatePath = `users/${uid}/private/info`;
    const privateRef = doc(db, 'users', uid, 'private', 'info');
    const email = this.truncate(user.email || '', 254, '');

    try {
      const privSnap = await getDoc(privateRef);
      if (!privSnap.exists()) {
        await setDoc(privateRef, {
          uid,
          email,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
  }

  private parseAuditSnapshotDoc(
    docId: string,
    data: Record<string, unknown>,
    sanitizedUid: string
  ): SavedAuditHistoryRecord {
    const createdTs = data['createdAt'] as Timestamp | null | undefined;
    const updatedTs = data['updatedAt'] as Timestamp | null | undefined;
    return {
      auditId: String(data['auditId'] || docId),
      ownerId: String(data['ownerId'] || sanitizedUid),
      repoFullName: String(data['repoFullName'] || 'owner/repository'),
      repoUrl: String(data['repoUrl'] || 'https://github.com/owner/repository'),
      runPhase: (data['runPhase'] === 'lhr' ? 'lhr' : 'static') as AuditRunPhase,
      mode: (data['mode'] === 'demo' ? 'demo' : 'live') as AuditMode,
      totalCommitsCount: Number(data['totalCommitsCount'] ?? 0),
      selectedCommitsCount: Number(data['selectedCommitsCount'] ?? 0),
      performanceBefore: Number(data['performanceBefore'] ?? 64),
      performanceAfter: Number(data['performanceAfter'] ?? 92),
      accessibilityBefore: Number(data['accessibilityBefore'] ?? 70),
      accessibilityAfter: Number(data['accessibilityAfter'] ?? 95),
      bestPracticesBefore: Number(data['bestPracticesBefore'] ?? 76),
      bestPracticesAfter: Number(data['bestPracticesAfter'] ?? 94),
      seoBefore: Number(data['seoBefore'] ?? 80),
      seoAfter: Number(data['seoAfter'] ?? 96),
      securityBefore: Number(data['securityBefore'] ?? 72),
      securityAfter: Number(data['securityAfter'] ?? 92),
      summaryNotes: String(data['summaryNotes'] || ''),
      commitTitles: Array.isArray(data['commitTitles'])
        ? (data['commitTitles'] as unknown[]).map((c) => String(c))
        : [],
      createdAtIso: createdTs?.toDate ? createdTs.toDate().toISOString() : new Date().toISOString(),
      updatedAtIso: updatedTs?.toDate ? updatedTs.toDate().toISOString() : new Date().toISOString(),
    };
  }

  private syncCombinedAudits(): void {
    const merged = new Map<string, SavedAuditHistoryRecord>();
    for (const [id, rec] of this.topLevelAuditMap.entries()) {
      merged.set(id, rec);
    }
    for (const [id, rec] of this.profileAuditMap.entries()) {
      merged.set(id, rec);
    }
    const items = Array.from(merged.values());
    items.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
    this.savedAudits.set(items);
  }

  private subscribeToUserAudits(uid: string): void {
    this.unsubscribeFromUserAudits();
    const sanitizedUid = this.sanitizeId(uid);

    // 1. Subscribe to the user's Firestore profile subcollection (/users/{uid}/audits)
    const profileAuditsPath = `users/${sanitizedUid}/audits`;
    const profileAuditsQuery = query(
      collection(db, 'users', sanitizedUid, 'audits'),
      where('ownerId', '==', sanitizedUid)
    );

    this.profileAuditsUnsubscribe = onSnapshot(
      profileAuditsQuery,
      (snapshot) => {
        this.profileAuditMap.clear();
        snapshot.forEach((docSnap) => {
          const rec = this.parseAuditSnapshotDoc(docSnap.id, docSnap.data(), sanitizedUid);
          this.profileAuditMap.set(rec.auditId, rec);
        });
        this.syncCombinedAudits();
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, profileAuditsPath);
      }
    );

    // 2. Also subscribe to top-level /audits filtered by ownerId
    const auditsQuery = query(collection(db, 'audits'), where('ownerId', '==', sanitizedUid));
    this.topLevelAuditsUnsubscribe = onSnapshot(
      auditsQuery,
      (snapshot) => {
        this.topLevelAuditMap.clear();
        snapshot.forEach((docSnap) => {
          const rec = this.parseAuditSnapshotDoc(docSnap.id, docSnap.data(), sanitizedUid);
          this.topLevelAuditMap.set(rec.auditId, rec);
        });
        this.syncCombinedAudits();
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'audits');
      }
    );
  }

  private unsubscribeFromUserAudits(): void {
    if (this.profileAuditsUnsubscribe) {
      this.profileAuditsUnsubscribe();
      this.profileAuditsUnsubscribe = null;
    }
    if (this.topLevelAuditsUnsubscribe) {
      this.topLevelAuditsUnsubscribe();
      this.topLevelAuditsUnsubscribe = null;
    }
    this.profileAuditMap.clear();
    this.topLevelAuditMap.clear();
  }

  async saveAuditToAccount(
    session: AuditSession,
    impact: AuditImpactMetrics,
    selectedCommits: AuditCommit[]
  ): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      await this.signInWithGitHub();
      return;
    }

    this.isSavingAudit.set(true);
    this.saveSuccessBanner.set(null);

    const ownerId = this.sanitizeId(user.uid);
    const auditId = this.sanitizeId(`${ownerId}_${session.id}_${session.runPhase}`);
    const profileAuditPath = `users/${ownerId}/audits/${auditId}`;
    const topLevelAuditPath = `audits/${auditId}`;

    const profileAuditRef = doc(db, 'users', ownerId, 'audits', auditId);
    const topLevelAuditRef = doc(db, 'audits', auditId);

    const commitTitles = selectedCommits
      .slice(0, 25)
      .map((c) => this.truncate(c.title, 240, 'Atomic audit commit'));

    const perfGain =
      this.clampMetric(impact.performanceAfter) - this.clampMetric(impact.performanceBefore);
    const a11yGain =
      this.clampMetric(impact.accessibilityAfter) - this.clampMetric(impact.accessibilityBefore);

    const summaryNotes = this.truncate(
      `${session.repo.fullName} (${session.runPhase === 'lhr' ? 'Run 2 LHR JSON' : 'Run 1 Static Audit'}): ${selectedCommits.length} of ${session.commits.length} commits selected. Performance +${Math.max(0, perfGain)} pts, Accessibility +${Math.max(0, a11yGain)} pts.`,
      1000,
      'Saved code audit snapshot'
    );

    const createPayload = {
      auditId,
      ownerId,
      repoFullName: this.truncate(session.repo.fullName, 200, 'owner/repository'),
      repoUrl: this.truncate(
        session.repo.url || `https://github.com/${session.repo.fullName}`,
        500,
        'https://github.com/owner/repository'
      ),
      runPhase: session.runPhase === 'lhr' ? 'lhr' : 'static',
      mode: session.mode === 'demo' ? 'demo' : 'live',
      totalCommitsCount: Math.max(0, Math.min(100, session.commits.length)),
      selectedCommitsCount: Math.max(0, Math.min(100, selectedCommits.length)),
      performanceBefore: this.clampMetric(impact.performanceBefore),
      performanceAfter: this.clampMetric(impact.performanceAfter),
      accessibilityBefore: this.clampMetric(impact.accessibilityBefore),
      accessibilityAfter: this.clampMetric(impact.accessibilityAfter),
      bestPracticesBefore: this.clampMetric(impact.bestPracticesBefore),
      bestPracticesAfter: this.clampMetric(impact.bestPracticesAfter),
      seoBefore: this.clampMetric(impact.seoBefore),
      seoAfter: this.clampMetric(impact.seoAfter),
      securityBefore: this.clampMetric(impact.securityBefore),
      securityAfter: this.clampMetric(impact.securityAfter),
      summaryNotes,
      commitTitles,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const updatePayload = {
      selectedCommitsCount: Math.max(0, Math.min(100, selectedCommits.length)),
      performanceAfter: this.clampMetric(impact.performanceAfter),
      accessibilityAfter: this.clampMetric(impact.accessibilityAfter),
      bestPracticesAfter: this.clampMetric(impact.bestPracticesAfter),
      seoAfter: this.clampMetric(impact.seoAfter),
      securityAfter: this.clampMetric(impact.securityAfter),
      summaryNotes,
      commitTitles,
      updatedAt: serverTimestamp(),
    };

    try {
      await this.ensureUserProfileDocument(user);

      // Save to authenticated user's Firestore profile subcollection (/users/{uid}/audits/{auditId})
      const existingProfileSnap = await getDoc(profileAuditRef);
      if (!existingProfileSnap.exists()) {
        await setDoc(profileAuditRef, createPayload);
      } else {
        await updateDoc(profileAuditRef, updatePayload);
      }

      // Synchronize with top-level /audits/{auditId}
      const existingTopSnap = await getDoc(topLevelAuditRef);
      if (!existingTopSnap.exists()) {
        await setDoc(topLevelAuditRef, createPayload);
      } else {
        await updateDoc(topLevelAuditRef, updatePayload);
      }

      this.saveSuccessBanner.set(
        `Saved ${session.repo.fullName} to your Firestore profile (${this.userDisplayLabel()})`
      );
      setTimeout(() => {
        this.saveSuccessBanner.set(null);
      }, 3200);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `${profileAuditPath} | ${topLevelAuditPath}`);
    } finally {
      this.isSavingAudit.set(false);
    }
  }

  async deleteSavedAudit(auditId: string): Promise<void> {
    const user = this.currentUser();
    const cleanId = this.sanitizeId(auditId);
    const topPath = `audits/${cleanId}`;
    try {
      if (user) {
        const ownerId = this.sanitizeId(user.uid);
        await deleteDoc(doc(db, 'users', ownerId, 'audits', cleanId));
      }
      await deleteDoc(doc(db, 'audits', cleanId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, topPath);
    }
  }
}
