import { ReactiveStore } from './reactive-state';
import type {
  AuditImpactMetrics,
  AuditRunPhase,
  AuditSession,
  CachedRepositoryAuditEntry,
  LighthouseCategory,
  LocalSavedAuditRecord
} from '@/types/audit';

export const AUDIT_RESULT_CACHE_STORAGE_KEY = 'fresnel_recent_audit_cache_v1';
export const AUDIT_RESULT_CACHE_MAX_ITEMS = 5;

export function buildAuditCacheKey(repoFullName: string, runPhase: AuditRunPhase): string {
  const normalizedRepo = (repoFullName || 'unknown/repository').trim().toLowerCase();
  return `${normalizedRepo}::${runPhase || 'static'}`;
}

function compactSessionForCache(session: AuditSession, maxDiffChars = 16000): AuditSession {
  const commits = Array.isArray(session.commits)
    ? session.commits.map((c) => ({
        ...c,
        diff:
          typeof c.diff === 'string' && c.diff.length > maxDiffChars
            ? `${c.diff.slice(0, maxDiffChars)}\n... [truncated for browser cache]`
            : c.diff
      }))
    : [];

  return {
    ...session,
    status: 'completed',
    progressPercent: 100,
    steps: Array.isArray(session.steps) ? session.steps.slice(-6) : [],
    commits,
    totalCommits: commits.length,
    pr: null
  };
}

function isValidCachedEntry(item: unknown): item is CachedRepositoryAuditEntry {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Partial<CachedRepositoryAuditEntry>;
  return (
    typeof candidate.cacheKey === 'string' &&
    candidate.cacheKey.length > 0 &&
    typeof candidate.repoFullName === 'string' &&
    candidate.repoFullName.length > 0 &&
    typeof candidate.cachedAtIso === 'string' &&
    Boolean(candidate.session) &&
    typeof candidate.session === 'object' &&
    Array.isArray(candidate.session?.commits) &&
    candidate.session.commits.length > 0
  );
}

export interface AuditResultCacheSnapshot {
  cachedAudits: CachedRepositoryAuditEntry[];
  activeCacheKey: string | null;
  cacheCount: number;
  latestCachedAudit: CachedRepositoryAuditEntry | null;
}

export class AuditResultCacheService extends ReactiveStore<AuditResultCacheSnapshot> {
  readonly cachedAudits = this.signal<CachedRepositoryAuditEntry[]>(this.readFromLocalStorage());
  readonly activeCacheKey = this.signal<string | null>(null);

  readonly cacheCount = this.computed<number>(() => this.cachedAudits().length);
  readonly latestCachedAudit = this.computed<CachedRepositoryAuditEntry | null>(
    () => this.cachedAudits()[0] ?? null
  );

  protected override buildSnapshot(): AuditResultCacheSnapshot {
    return {
      cachedAudits: this.cachedAudits(),
      activeCacheKey: this.activeCacheKey(),
      cacheCount: this.cacheCount(),
      latestCachedAudit: this.latestCachedAudit(),
    };
  }

  private readFromLocalStorage(): CachedRepositoryAuditEntry[] {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return [];
    }
    try {
      const raw = window.localStorage.getItem(AUDIT_RESULT_CACHE_STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is CachedRepositoryAuditEntry => isValidCachedEntry(item))
        .slice(0, AUDIT_RESULT_CACHE_MAX_ITEMS);
    } catch {
      return [];
    }
  }

  private persistToLocalStorage(entries: CachedRepositoryAuditEntry[]): CachedRepositoryAuditEntry[] {
    const bounded = entries.slice(0, AUDIT_RESULT_CACHE_MAX_ITEMS);
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return bounded;
    }

    try {
      window.localStorage.setItem(AUDIT_RESULT_CACHE_STORAGE_KEY, JSON.stringify(bounded));
      return bounded;
    } catch {
      // QuotaExceededError fallback: shrink diff payloads first
      const compacted = bounded.map((entry, idx) => ({
        ...entry,
        session: compactSessionForCache(entry.session, idx === 0 ? 6000 : 2500)
      }));
      try {
        window.localStorage.setItem(AUDIT_RESULT_CACHE_STORAGE_KEY, JSON.stringify(compacted));
        return compacted;
      } catch {
        // Final fallback: progressively drop oldest entries until localStorage accepts it
        for (let len = compacted.length - 1; len >= 1; len--) {
          const subset = compacted.slice(0, len);
          try {
            window.localStorage.setItem(AUDIT_RESULT_CACHE_STORAGE_KEY, JSON.stringify(subset));
            return subset;
          } catch {
            // keep shrinking
          }
        }
        return bounded;
      }
    }
  }

  cacheAuditResult(
    session: AuditSession,
    metrics: AuditImpactMetrics,
    selectedCommitIds: Iterable<string>,
    categoryFilter: LighthouseCategory = 'all'
  ): CachedRepositoryAuditEntry | null {
    if (!session || !Array.isArray(session.commits) || session.commits.length === 0) {
      return null;
    }

    const repoFullName = session.repo?.fullName || 'fresnel-sandbox/lumina-web-app';
    const repoUrl = session.repo?.url || `https://github.com/${repoFullName}`;
    const runPhase: AuditRunPhase = session.runPhase || 'static';
    const cacheKey = buildAuditCacheKey(repoFullName, runPhase);
    const selectedIds = Array.from(selectedCommitIds);
    const effectiveSelectedIds =
      selectedIds.length > 0 ? selectedIds : session.commits.map((c) => c.id);

    const entry: CachedRepositoryAuditEntry = {
      cacheKey,
      auditId: session.id || `cache-${Date.now()}`,
      repoFullName,
      repoUrl,
      branch: session.branch || 'main',
      mode: session.mode || 'live',
      runPhase,
      cachedAtIso: new Date().toISOString(),
      totalCommitsCount: session.commits.length,
      selectedCommitIds: effectiveSelectedIds,
      categoryFilter,
      performanceBefore: Math.round(metrics.performanceBefore),
      performanceAfter: Math.round(metrics.performanceAfter),
      accessibilityBefore: Math.round(metrics.accessibilityBefore),
      accessibilityAfter: Math.round(metrics.accessibilityAfter),
      bestPracticesBefore: Math.round(metrics.bestPracticesBefore),
      bestPracticesAfter: Math.round(metrics.bestPracticesAfter),
      seoBefore: Math.round(metrics.seoBefore),
      seoAfter: Math.round(metrics.seoAfter),
      securityBefore: Math.round(metrics.securityBefore),
      securityAfter: Math.round(metrics.securityAfter),
      session: compactSessionForCache(session)
    };

    const next = [entry, ...this.cachedAudits().filter((item) => item.cacheKey !== cacheKey)].slice(
      0,
      AUDIT_RESULT_CACHE_MAX_ITEMS
    );
    const persisted = this.persistToLocalStorage(next);
    this.cachedAudits.set(persisted);
    this.activeCacheKey.set(cacheKey);
    return entry;
  }

  cacheFromSavedRecord(record: LocalSavedAuditRecord): CachedRepositoryAuditEntry | null {
    const snap = record.snapshotSession;
    if (!snap || !Array.isArray(snap.commits) || snap.commits.length === 0) {
      return null;
    }
    const repoFullName = record.repoFullName || snap.repo?.fullName || 'local/repository';
    const runPhase: AuditRunPhase = record.runPhase || snap.runPhase || 'static';
    const cacheKey = buildAuditCacheKey(repoFullName, runPhase);

    let selectedIds = snap.commits.map((c) => c.id);
    if (record.commitTitles && record.commitTitles.length > 0) {
      const titleSet = new Set(record.commitTitles.map((t) => t.trim().toLowerCase()));
      const matched = snap.commits
        .filter((c) => titleSet.has(c.title.trim().toLowerCase()))
        .map((c) => c.id);
      if (matched.length > 0) {
        selectedIds = matched;
      }
    }

    const entry: CachedRepositoryAuditEntry = {
      cacheKey,
      auditId: record.auditId || snap.id || `cache-${Date.now()}`,
      repoFullName,
      repoUrl: record.repoUrl || snap.repo?.url || `https://github.com/${repoFullName}`,
      branch: record.branch || snap.branch || 'main',
      mode: record.mode || snap.mode || 'live',
      runPhase,
      cachedAtIso: new Date().toISOString(),
      totalCommitsCount: snap.commits.length,
      selectedCommitIds: selectedIds,
      categoryFilter: 'all',
      performanceBefore: Math.round(record.performanceBefore),
      performanceAfter: Math.round(record.performanceAfter),
      accessibilityBefore: Math.round(record.accessibilityBefore),
      accessibilityAfter: Math.round(record.accessibilityAfter),
      bestPracticesBefore: Math.round(record.bestPracticesBefore),
      bestPracticesAfter: Math.round(record.bestPracticesAfter),
      seoBefore: Math.round(record.seoBefore),
      seoAfter: Math.round(record.seoAfter),
      securityBefore: Math.round(record.securityBefore),
      securityAfter: Math.round(record.securityAfter),
      session: compactSessionForCache(snap)
    };

    const next = [entry, ...this.cachedAudits().filter((item) => item.cacheKey !== cacheKey)].slice(
      0,
      AUDIT_RESULT_CACHE_MAX_ITEMS
    );
    const persisted = this.persistToLocalStorage(next);
    this.cachedAudits.set(persisted);
    this.activeCacheKey.set(cacheKey);
    return entry;
  }

  updateSelectionInCache(
    cacheKey: string,
    selectedCommitIds: Iterable<string>,
    categoryFilter?: LighthouseCategory
  ): void {
    const existing = this.cachedAudits();
    const idx = existing.findIndex((item) => item.cacheKey === cacheKey);
    if (idx === -1) return;

    const updatedEntry: CachedRepositoryAuditEntry = {
      ...existing[idx],
      selectedCommitIds: Array.from(selectedCommitIds),
      categoryFilter: categoryFilter ?? existing[idx].categoryFilter
    };
    const next = existing.map((item, i) => (i === idx ? updatedEntry : item));
    const persisted = this.persistToLocalStorage(next);
    this.cachedAudits.set(persisted);
  }

  markActiveCacheKey(cacheKey: string | null): void {
    this.activeCacheKey.set(cacheKey);
  }

  removeCachedAudit(cacheKey: string): void {
    const next = this.cachedAudits().filter((item) => item.cacheKey !== cacheKey);
    const persisted = this.persistToLocalStorage(next);
    this.cachedAudits.set(persisted);
    if (this.activeCacheKey() === cacheKey) {
      this.activeCacheKey.set(null);
    }
  }

  clearCache(): void {
    this.cachedAudits.set([]);
    this.activeCacheKey.set(null);
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      try {
        window.localStorage.removeItem(AUDIT_RESULT_CACHE_STORAGE_KEY);
      } catch {
        // ignore storage errors
      }
    }
  }
}

export const auditResultCache = new AuditResultCacheService();
