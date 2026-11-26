import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal
} from '@angular/core';
import {
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord
} from '../../models/audit.model';

export interface DiffComparableAuditSession {
  auditId: string;
  repoFullName: string;
  branch: string;
  runPhase: 'static' | 'lhr';
  timestampMs: number;
  timestampIso: string;
  isLiveCurrentSession: boolean;
  performanceBefore: number;
  performanceAfter: number;
  accessibilityBefore: number;
  accessibilityAfter: number;
  bestPracticesBefore: number;
  bestPracticesAfter: number;
  seoBefore: number;
  seoAfter: number;
  securityBefore: number;
  securityAfter: number;
  selectedCommitsCount: number;
  totalCommitsCount: number;
  summaryNotes: string;
  commitTitles: string[];
  sourceRecord: SavedAuditHistoryRecord | LocalSavedAuditRecord;
}

export interface DiffCategoryRow {
  id: 'performance' | 'accessibility' | 'bestPractices' | 'seo' | 'security';
  label: string;
  prevBefore: number;
  prevAfter: number;
  currBefore: number;
  currAfter: number;
  afterDelta: number;
  direction: 'improved' | 'unchanged' | 'regressed';
}

export interface RepositoryAuditDiffResult {
  repoFullName: string;
  previousRun: DiffComparableAuditSession;
  currentRun: DiffComparableAuditSession;
  prevAvgAfter: number;
  currAvgAfter: number;
  overallAfterDelta: number;
  categories: DiffCategoryRow[];
  improvedCategoriesCount: number;
  addedCommits: string[];
  sharedCommits: string[];
  removedCommits: string[];
}

function parseTimestampMs(iso: string | undefined): number {
  const ms = new Date(iso || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function clampPct(raw: number | undefined): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function listComparableDiffRepositories(
  savedAudits: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  currentSessionRecord: LocalSavedAuditRecord | null = null
): Array<{ repoFullName: string; sessionCount: number; hasCurrentLive: boolean }> {
  const map = new Map<
    string,
    { repoFullName: string; ids: Set<string>; hasCurrentLive: boolean }
  >();

  const register = (
    rec: SavedAuditHistoryRecord | LocalSavedAuditRecord,
    isLive: boolean
  ): void => {
    const repoName = (rec.repoFullName || '').trim();
    if (!repoName) return;
    const key = repoName.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        repoFullName: repoName,
        ids: new Set([rec.auditId]),
        hasCurrentLive: isLive
      });
    } else {
      existing.ids.add(rec.auditId);
      if (isLive) existing.hasCurrentLive = true;
    }
  };

  if (currentSessionRecord) {
    register(currentSessionRecord, true);
  }
  for (const rec of savedAudits) {
    register(rec, false);
  }

  return Array.from(map.values())
    .filter((entry) => entry.ids.size >= 2)
    .map((entry) => ({
      repoFullName: entry.repoFullName,
      sessionCount: entry.ids.size,
      hasCurrentLive: entry.hasCurrentLive
    }))
    .sort((a, b) => {
      if (a.hasCurrentLive !== b.hasCurrentLive) {
        return a.hasCurrentLive ? -1 : 1;
      }
      return b.sessionCount - a.sessionCount;
    });
}

export function buildComparableRepositorySessions(
  savedAudits: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  currentSessionRecord: LocalSavedAuditRecord | null,
  repoFullName: string
): DiffComparableAuditSession[] {
  const target = (repoFullName || '').trim().toLowerCase();
  if (!target) return [];

  const byId = new Map<string, DiffComparableAuditSession>();

  const addRecord = (
    rec: SavedAuditHistoryRecord | LocalSavedAuditRecord,
    isLiveCurrentSession: boolean
  ): void => {
    if ((rec.repoFullName || '').trim().toLowerCase() !== target) return;
    const tsIso = rec.updatedAtIso || rec.createdAtIso || new Date().toISOString();
    const sessionItem: DiffComparableAuditSession = {
      auditId: rec.auditId,
      repoFullName: rec.repoFullName,
      branch: rec.branch || 'main',
      runPhase: rec.runPhase === 'lhr' ? 'lhr' : 'static',
      timestampMs: isLiveCurrentSession
        ? Math.max(Date.now(), parseTimestampMs(tsIso))
        : parseTimestampMs(tsIso),
      timestampIso: tsIso,
      isLiveCurrentSession,
      performanceBefore: clampPct(rec.performanceBefore),
      performanceAfter: clampPct(rec.performanceAfter),
      accessibilityBefore: clampPct(rec.accessibilityBefore),
      accessibilityAfter: clampPct(rec.accessibilityAfter),
      bestPracticesBefore: clampPct(rec.bestPracticesBefore),
      bestPracticesAfter: clampPct(rec.bestPracticesAfter),
      seoBefore: clampPct(rec.seoBefore),
      seoAfter: clampPct(rec.seoAfter),
      securityBefore: clampPct(rec.securityBefore),
      securityAfter: clampPct(rec.securityAfter),
      selectedCommitsCount: Math.max(0, rec.selectedCommitsCount || 0),
      totalCommitsCount: Math.max(0, rec.totalCommitsCount || 0),
      summaryNotes: rec.summaryNotes || '',
      commitTitles: Array.isArray(rec.commitTitles) ? rec.commitTitles : [],
      sourceRecord: rec
    };
    byId.set(rec.auditId, sessionItem);
  };

  for (const rec of savedAudits) {
    addRecord(rec, false);
  }
  if (currentSessionRecord) {
    addRecord(currentSessionRecord, true);
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.isLiveCurrentSession !== b.isLiveCurrentSession) {
      return a.isLiveCurrentSession ? -1 : 1;
    }
    return b.timestampMs - a.timestampMs;
  });
}

export function pickDefaultDiffPair(
  sessions: readonly DiffComparableAuditSession[],
  preferredCurrentAuditId?: string | null
): {
  previousRun: DiffComparableAuditSession | null;
  currentRun: DiffComparableAuditSession | null;
} {
  if (sessions.length === 0) {
    return { previousRun: null, currentRun: null };
  }
  if (sessions.length === 1) {
    return { previousRun: null, currentRun: sessions[0] };
  }

  const preferred = preferredCurrentAuditId
    ? sessions.find((s) => s.auditId === preferredCurrentAuditId) ?? null
    : null;

  const currentRun = preferred ?? sessions[0];
  const remaining = sessions.filter((s) => s.auditId !== currentRun.auditId);

  // Prefer the most recent session strictly older than currentRun, or fallback to next item
  const olderRun = remaining.find((s) => s.timestampMs <= currentRun.timestampMs);
  const previousRun = olderRun ?? remaining[0] ?? null;

  return { previousRun, currentRun };
}

function averageScoreAfter(session: DiffComparableAuditSession): number {
  return Math.round(
    (session.performanceAfter +
      session.accessibilityAfter +
      session.bestPracticesAfter +
      session.seoAfter +
      session.securityAfter) /
      5
  );
}

export function computeRepositoryAuditDiff(
  previousRun: DiffComparableAuditSession,
  currentRun: DiffComparableAuditSession
): RepositoryAuditDiffResult {
  const categoryDefs: Array<{
    id: DiffCategoryRow['id'];
    label: string;
    prevBefore: number;
    prevAfter: number;
    currBefore: number;
    currAfter: number;
  }> = [
    {
      id: 'performance',
      label: 'Performance',
      prevBefore: previousRun.performanceBefore,
      prevAfter: previousRun.performanceAfter,
      currBefore: currentRun.performanceBefore,
      currAfter: currentRun.performanceAfter
    },
    {
      id: 'accessibility',
      label: 'Accessibility',
      prevBefore: previousRun.accessibilityBefore,
      prevAfter: previousRun.accessibilityAfter,
      currBefore: currentRun.accessibilityBefore,
      currAfter: currentRun.accessibilityAfter
    },
    {
      id: 'bestPractices',
      label: 'Best Practices',
      prevBefore: previousRun.bestPracticesBefore,
      prevAfter: previousRun.bestPracticesAfter,
      currBefore: currentRun.bestPracticesBefore,
      currAfter: currentRun.bestPracticesAfter
    },
    {
      id: 'seo',
      label: 'SEO',
      prevBefore: previousRun.seoBefore,
      prevAfter: previousRun.seoAfter,
      currBefore: currentRun.seoBefore,
      currAfter: currentRun.seoAfter
    },
    {
      id: 'security',
      label: 'Security',
      prevBefore: previousRun.securityBefore,
      prevAfter: previousRun.securityAfter,
      currBefore: currentRun.securityBefore,
      currAfter: currentRun.securityAfter
    }
  ];

  const categories: DiffCategoryRow[] = categoryDefs.map((def) => {
    const afterDelta = def.currAfter - def.prevAfter;
    const direction: DiffCategoryRow['direction'] =
      afterDelta > 0 ? 'improved' : afterDelta < 0 ? 'regressed' : 'unchanged';
    return {
      ...def,
      afterDelta,
      direction
    };
  });

  const prevAvgAfter = averageScoreAfter(previousRun);
  const currAvgAfter = averageScoreAfter(currentRun);

  const prevTitleKeys = new Set(
    previousRun.commitTitles.map((t) => t.trim().toLowerCase()).filter(Boolean)
  );
  const currTitleKeys = new Set(
    currentRun.commitTitles.map((t) => t.trim().toLowerCase()).filter(Boolean)
  );

  const addedCommits = currentRun.commitTitles.filter(
    (t) => !prevTitleKeys.has(t.trim().toLowerCase())
  );
  const sharedCommits = currentRun.commitTitles.filter((t) =>
    prevTitleKeys.has(t.trim().toLowerCase())
  );
  const removedCommits = previousRun.commitTitles.filter(
    (t) => !currTitleKeys.has(t.trim().toLowerCase())
  );

  return {
    repoFullName: currentRun.repoFullName || previousRun.repoFullName,
    previousRun,
    currentRun,
    prevAvgAfter,
    currAvgAfter,
    overallAfterDelta: currAvgAfter - prevAvgAfter,
    categories,
    improvedCategoriesCount: categories.filter((c) => c.afterDelta > 0).length,
    addedCommits,
    sharedCommits,
    removedCommits
  };
}

@Component({
  selector: 'app-saved-audit-diff-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="saved-audit-diff-view"
      class="saved-diff-panel"
      aria-labelledby="saved-diff-title"
    >
      <div class="saved-diff-panel__header">
        <div class="saved-diff-panel__heading">
          <p class="saved-diff-panel__kicker">
            <span>Side-by-Side Diff View</span>
            <span aria-hidden="true">·</span>
            <span>{{ activeRepoName() }}</span>
            @if (sessionsForRepo().length >= 2) {
              <span aria-hidden="true">·</span>
              <span>{{ sessionsForRepo().length }} sessions available</span>
            }
          </p>
          <h3 id="saved-diff-title" class="saved-diff-panel__title">
            Repository Audit Session Comparison
          </h3>
        </div>

        <div class="saved-diff-panel__header-actions">
          @if (comparableRepos().length > 1) {
            <label for="diff-repo-select" class="sr-only">Select repository for Diff View</label>
            <select
              id="diff-repo-select"
              class="saved-audits-sort-select"
              [value]="activeRepoName()"
              (change)="onRepoSelectChange($event)"
            >
              @for (repoOpt of comparableRepos(); track repoOpt.repoFullName) {
                <option [value]="repoOpt.repoFullName">
                  {{ repoOpt.repoFullName }} ({{ repoOpt.sessionCount }})
                </option>
              }
            </select>
          }

          @if (diffResult()) {
            <button
              type="button"
              id="diff-swap-runs-btn"
              class="dashboard-inline-btn"
              (click)="swapRuns()"
              title="Swap Previous and Current audit sessions"
            >
              Swap Sides
            </button>
          }

          <button
            type="button"
            id="diff-close-btn"
            class="dashboard-inline-btn"
            (click)="closeDiff.emit()"
          >
            Close Diff
          </button>
        </div>
      </div>

      @if (!diffResult()) {
        <div class="saved-diff-empty" role="status">
          <p class="saved-diff-empty__title">
            Need at least two audit sessions for {{ activeRepoName() || 'this repository' }}
          </p>
          <p class="saved-diff-empty__desc">
            Run another audit on this repository or pick a repository with multiple saved runs to compare improvements side-by-side.
          </p>
          @if (comparableRepos().length > 0) {
            <div class="saved-diff-empty__actions">
              @for (repoOpt of comparableRepos().slice(0, 3); track repoOpt.repoFullName) {
                <button
                  type="button"
                  class="dashboard-inline-btn dashboard-inline-btn--primary"
                  (click)="selectRepo.emit(repoOpt.repoFullName)"
                >
                  Compare {{ repoOpt.repoFullName }} ({{ repoOpt.sessionCount }})
                </button>
              }
            </div>
          }
        </div>
      } @else {
        @let diff = diffResult()!;

        <div class="saved-diff-banner" role="status" aria-live="polite">
          <div class="saved-diff-banner__summary">
            <span class="saved-diff-banner__label">Net Composite Score Change</span>
            <strong
              class="saved-diff-banner__delta"
              [class.is-improved]="diff.overallAfterDelta > 0"
              [class.is-regressed]="diff.overallAfterDelta < 0"
            >
              {{ formatSignedDelta(diff.overallAfterDelta) }} pts
            </strong>
            <span class="saved-diff-banner__meta">
              {{ diff.prevAvgAfter }}/100 → {{ diff.currAvgAfter }}/100 avg across 5 categories
              <span aria-hidden="true">·</span>
              {{ diff.improvedCategoriesCount }} of 5 categories improved
              <span aria-hidden="true">·</span>
              {{ diff.addedCommits.length }} new fixes
            </span>
          </div>
        </div>

        <!-- Side-by-Side Session Cards -->
        <div class="saved-diff-columns">
          <article class="saved-diff-col saved-diff-col--prev" aria-label="Previous audit session">
            <div class="saved-diff-col__head">
              <span class="saved-diff-col__role">Previous Session (Baseline)</span>
              <span class="saved-diff-col__score">{{ diff.prevAvgAfter }}/100 avg</span>
            </div>

            <label for="diff-prev-run-select" class="sr-only">Select previous audit session</label>
            <select
              id="diff-prev-run-select"
              class="saved-diff-col__select"
              [value]="diff.previousRun.auditId"
              (change)="onPrevSelectChange($event)"
            >
              @for (item of sessionsForRepo(); track item.auditId) {
                <option [value]="item.auditId" [disabled]="item.auditId === diff.currentRun.auditId">
                  {{ formatSessionOption(item) }}
                </option>
              }
            </select>

            <p class="saved-diff-col__meta">
              <span>{{ formatShortDate(diff.previousRun.timestampIso) }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ diff.previousRun.branch }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ diff.previousRun.runPhase === 'lhr' ? 'LHR JSON' : 'Static AST' }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ diff.previousRun.selectedCommitsCount }}/{{ diff.previousRun.totalCommitsCount }} fixes</span>
            </p>
            @if (diff.previousRun.summaryNotes) {
              <p class="saved-diff-col__notes">{{ diff.previousRun.summaryNotes }}</p>
            }
          </article>

          <article class="saved-diff-col saved-diff-col--curr" aria-label="Current repository audit session">
            <div class="saved-diff-col__head">
              <span class="saved-diff-col__role">
                {{ diff.currentRun.isLiveCurrentSession ? 'Current Active Audit' : 'Current / Target Session' }}
              </span>
              <span class="saved-diff-col__score saved-diff-col__score--curr">
                {{ diff.currAvgAfter }}/100 avg
              </span>
            </div>

            <label for="diff-curr-run-select" class="sr-only">Select current audit session</label>
            <select
              id="diff-curr-run-select"
              class="saved-diff-col__select"
              [value]="diff.currentRun.auditId"
              (change)="onCurrSelectChange($event)"
            >
              @for (item of sessionsForRepo(); track item.auditId) {
                <option [value]="item.auditId" [disabled]="item.auditId === diff.previousRun.auditId">
                  {{ formatSessionOption(item) }}
                </option>
              }
            </select>

            <p class="saved-diff-col__meta">
              <span>{{ formatShortDate(diff.currentRun.timestampIso) }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ diff.currentRun.branch }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ diff.currentRun.runPhase === 'lhr' ? 'LHR JSON' : 'Static AST' }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ diff.currentRun.selectedCommitsCount }}/{{ diff.currentRun.totalCommitsCount }} fixes</span>
            </p>
            @if (diff.currentRun.summaryNotes) {
              <p class="saved-diff-col__notes">{{ diff.currentRun.summaryNotes }}</p>
            }
          </article>
        </div>

        <!-- Side-by-Side Category Score Comparison Table -->
        <div class="saved-diff-table-wrap">
          <table class="saved-diff-table" aria-label="Side-by-side category score diff">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" class="is-num">Previous</th>
                <th scope="col" class="is-num">Current</th>
                <th scope="col" class="is-right">Improvement</th>
              </tr>
            </thead>
            <tbody>
              @for (row of diff.categories; track row.id) {
                <tr>
                  <td class="saved-diff-table__cat">
                    <span>{{ row.label }}</span>
                    <div class="saved-diff-bars" aria-hidden="true">
                      <span class="saved-diff-bar saved-diff-bar--prev" [style.width.%]="row.prevAfter"></span>
                      <span class="saved-diff-bar saved-diff-bar--curr" [style.width.%]="row.currAfter"></span>
                    </div>
                  </td>
                  <td class="is-num saved-diff-table__num">
                    <span class="saved-diff-score-sub">{{ row.prevBefore }}→</span>
                    <strong>{{ row.prevAfter }}</strong>
                  </td>
                  <td class="is-num saved-diff-table__num">
                    <span class="saved-diff-score-sub">{{ row.currBefore }}→</span>
                    <strong>{{ row.currAfter }}</strong>
                  </td>
                  <td class="is-right saved-diff-table__num">
                    <span
                      class="saved-diff-delta"
                      [class.is-improved]="row.direction === 'improved'"
                      [class.is-regressed]="row.direction === 'regressed'"
                    >
                      {{ formatSignedDelta(row.afterDelta) }} pts · {{ directionLabel(row.direction) }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Side-by-Side Remediation Commits Diff -->
        <div class="saved-diff-commits-grid" aria-label="Side-by-side remediation commits diff">
          <div class="saved-diff-commits-col">
            <h4 class="saved-diff-commits-col__title">
              Previous Session Fixes ({{ diff.previousRun.commitTitles.length }})
            </h4>
            @if (diff.previousRun.commitTitles.length === 0) {
              <p class="saved-diff-commits-empty">No commit titles recorded for this baseline.</p>
            } @else {
              <ul class="saved-diff-commit-list">
                @for (title of diff.removedCommits; track $index) {
                  <li class="saved-diff-commit-item is-removed">
                    <span class="saved-diff-commit-marker" aria-label="Only in previous">−</span>
                    <span>{{ title }}</span>
                  </li>
                }
                @for (title of diff.sharedCommits; track $index) {
                  <li class="saved-diff-commit-item is-shared">
                    <span class="saved-diff-commit-marker" aria-label="Retained">=</span>
                    <span>{{ title }}</span>
                  </li>
                }
              </ul>
            }
          </div>

          <div class="saved-diff-commits-col">
            <h4 class="saved-diff-commits-col__title">
              Current Session Improvements ({{ diff.currentRun.commitTitles.length }})
            </h4>
            @if (diff.currentRun.commitTitles.length === 0) {
              <p class="saved-diff-commits-empty">No commit titles recorded for this session.</p>
            } @else {
              <ul class="saved-diff-commit-list">
                @for (title of diff.addedCommits; track $index) {
                  <li class="saved-diff-commit-item is-added">
                    <span class="saved-diff-commit-marker" aria-label="New improvement">+</span>
                    <span>{{ title }}</span>
                  </li>
                }
                @for (title of diff.sharedCommits; track $index) {
                  <li class="saved-diff-commit-item is-shared">
                    <span class="saved-diff-commit-marker" aria-label="Retained">=</span>
                    <span>{{ title }}</span>
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      }
    </section>
  `
})
export class SavedAuditDiffViewComponent {
  readonly savedAudits = input.required<(SavedAuditHistoryRecord | LocalSavedAuditRecord)[]>();
  readonly currentSessionRecord = input<LocalSavedAuditRecord | null>(null);
  readonly targetRepoFullName = input<string | null>(null);
  readonly targetAuditId = input<string | null>(null);

  readonly closeDiff = output<void>();
  readonly selectRepo = output<string>();

  readonly selectedPrevId = signal<string | null>(null);
  readonly selectedCurrId = signal<string | null>(null);

  readonly comparableRepos = computed(() =>
    listComparableDiffRepositories(this.savedAudits(), this.currentSessionRecord())
  );

  readonly activeRepoName = computed<string>(() => {
    const explicit = (this.targetRepoFullName() || '').trim();
    if (explicit) return explicit;
    const liveRepo = (this.currentSessionRecord()?.repoFullName || '').trim();
    if (liveRepo) return liveRepo;
    const firstComparable = this.comparableRepos()[0]?.repoFullName;
    if (firstComparable) return firstComparable;
    return this.savedAudits()[0]?.repoFullName || '';
  });

  readonly sessionsForRepo = computed<DiffComparableAuditSession[]>(() =>
    buildComparableRepositorySessions(
      this.savedAudits(),
      this.currentSessionRecord(),
      this.activeRepoName()
    )
  );

  constructor() {
    effect(() => {
      const sessions = this.sessionsForRepo();
      const targetId = this.targetAuditId();
      if (sessions.length < 2) {
        this.selectedPrevId.set(null);
        this.selectedCurrId.set(sessions[0]?.auditId ?? null);
        return;
      }

      const validIds = new Set(sessions.map((s) => s.auditId));
      const curr = this.selectedCurrId();
      const prev = this.selectedPrevId();

      // Re-pick pair if repo changed, targetAuditId changed, or selection is invalid
      if (
        !curr ||
        !prev ||
        curr === prev ||
        !validIds.has(curr) ||
        !validIds.has(prev) ||
        (targetId && validIds.has(targetId) && curr !== targetId)
      ) {
        const pair = pickDefaultDiffPair(sessions, targetId);
        this.selectedCurrId.set(pair.currentRun?.auditId ?? null);
        this.selectedPrevId.set(pair.previousRun?.auditId ?? null);
      }
    });
  }

  readonly diffResult = computed<RepositoryAuditDiffResult | null>(() => {
    const sessions = this.sessionsForRepo();
    if (sessions.length < 2) return null;

    const prevId = this.selectedPrevId();
    const currId = this.selectedCurrId();
    const fallback = pickDefaultDiffPair(sessions, this.targetAuditId());

    const currentRun =
      (currId ? sessions.find((s) => s.auditId === currId) : null) ?? fallback.currentRun;
    const previousRun =
      (prevId ? sessions.find((s) => s.auditId === prevId) : null) ?? fallback.previousRun;

    if (!currentRun || !previousRun || currentRun.auditId === previousRun.auditId) {
      return null;
    }

    return computeRepositoryAuditDiff(previousRun, currentRun);
  });

  onRepoSelectChange(event: Event): void {
    const selectEl = event.target as HTMLSelectElement | null;
    const repo = selectEl?.value?.trim();
    if (repo) {
      this.selectedPrevId.set(null);
      this.selectedCurrId.set(null);
      this.selectRepo.emit(repo);
    }
  }

  onPrevSelectChange(event: Event): void {
    const selectEl = event.target as HTMLSelectElement | null;
    const id = selectEl?.value;
    if (id && id !== this.selectedCurrId()) {
      this.selectedPrevId.set(id);
    }
  }

  onCurrSelectChange(event: Event): void {
    const selectEl = event.target as HTMLSelectElement | null;
    const id = selectEl?.value;
    if (id && id !== this.selectedPrevId()) {
      this.selectedCurrId.set(id);
    }
  }

  swapRuns(): void {
    const prev = this.selectedPrevId();
    const curr = this.selectedCurrId();
    if (prev && curr && prev !== curr) {
      this.selectedPrevId.set(curr);
      this.selectedCurrId.set(prev);
    }
  }

  formatSignedDelta(delta: number): string {
    if (delta > 0) return `+${delta}`;
    return `${delta}`;
  }

  directionLabel(direction: DiffCategoryRow['direction']): string {
    if (direction === 'improved') return 'Improved';
    if (direction === 'regressed') return 'Regressed';
    return 'No change';
  }

  formatShortDate(iso: string): string {
    if (!iso) return 'Recently';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Recently';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatSessionOption(item: DiffComparableAuditSession): string {
    const tag = item.isLiveCurrentSession ? 'Active Run · ' : '';
    const phase = item.runPhase === 'lhr' ? 'LHR JSON' : 'Static AST';
    return `${tag}${this.formatShortDate(item.timestampIso)} · ${item.branch} (${phase}) · Perf ${item.performanceAfter}`;
  }
}
