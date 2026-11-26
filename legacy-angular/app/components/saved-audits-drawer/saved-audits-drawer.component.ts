import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import {
  LocalAuditFormat,
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord,
  UserSessionState
} from '../../models/audit.model';
import { SavedAuditTrendChartComponent } from './saved-audit-trend-chart.component';
import {
  SavedAuditDiffViewComponent,
  listComparableDiffRepositories
} from './saved-audit-diff-view.component';

export type SavedAuditSortOption = 'date-desc' | 'date-asc' | 'repo-asc' | 'repo-desc';
export type SavedAuditSourceFilter = 'all' | 'local' | 'firestore';
export type SavedAuditDatePreset = 'all' | '24h' | '7d' | '30d' | 'custom';

export interface SavedAuditDateRangeFilter {
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;   // YYYY-MM-DD
  preset?: SavedAuditDatePreset;
  nowMs?: number;    // Optional deterministic clock override for testing
}

export interface SavedAuditOwnerOption {
  owner: string;
  count: number;
  repoCount: number;
}

export interface SavedAuditOwnerGroup {
  owner: string;
  count: number;
  repoCount: number;
  latestTimestampMs: number;
  records: (SavedAuditHistoryRecord | LocalSavedAuditRecord)[];
}

function getRecordTimestampMs(rec: SavedAuditHistoryRecord | LocalSavedAuditRecord): number {
  const t = new Date(rec.updatedAtIso || rec.createdAtIso || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function extractRepoOwner(
  rec: SavedAuditHistoryRecord | LocalSavedAuditRecord
): string {
  const fullName = (rec.repoFullName || '').trim();
  if (fullName.includes('/')) {
    const owner = fullName.split('/')[0].trim();
    if (owner) return owner;
  }
  const url = (rec.repoUrl || '').trim();
  if (url) {
    try {
      const parsed = new URL(url);
      const firstSeg = parsed.pathname.split('/').filter(Boolean)[0];
      if (firstSeg) return firstSeg;
      if (parsed.hostname) return parsed.hostname;
    } catch {
      // Fallback below
    }
  }
  return fullName || 'ungrouped';
}

export function listSavedAuditOwners(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
): SavedAuditOwnerOption[] {
  const map = new Map<string, { owner: string; count: number; repos: Set<string> }>();
  for (const rec of records) {
    const owner = extractRepoOwner(rec);
    const key = owner.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        owner,
        count: 1,
        repos: new Set([(rec.repoFullName || '').toLowerCase()])
      });
    } else {
      existing.count += 1;
      existing.repos.add((rec.repoFullName || '').toLowerCase());
    }
  }
  return Array.from(map.values())
    .map((entry) => ({
      owner: entry.owner,
      count: entry.count,
      repoCount: entry.repos.size
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.owner.localeCompare(b.owner, undefined, { sensitivity: 'base' });
    });
}

export function groupSavedAuditsByOwner(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  sortBy: SavedAuditSortOption = 'date-desc'
): SavedAuditOwnerGroup[] {
  const groups = new Map<
    string,
    {
      owner: string;
      repos: Set<string>;
      latestTimestampMs: number;
      records: (SavedAuditHistoryRecord | LocalSavedAuditRecord)[];
    }
  >();

  for (const rec of records) {
    const owner = extractRepoOwner(rec);
    const key = owner.toLowerCase();
    const ts = getRecordTimestampMs(rec);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        owner,
        repos: new Set([(rec.repoFullName || '').toLowerCase()]),
        latestTimestampMs: ts,
        records: [rec]
      });
    } else {
      existing.records.push(rec);
      existing.repos.add((rec.repoFullName || '').toLowerCase());
      if (ts > existing.latestTimestampMs) {
        existing.latestTimestampMs = ts;
      }
    }
  }

  return Array.from(groups.values())
    .map((g) => ({
      owner: g.owner,
      count: g.records.length,
      repoCount: g.repos.size,
      latestTimestampMs: g.latestTimestampMs,
      records: g.records
    }))
    .sort((a, b) => {
      if (sortBy === 'repo-asc') {
        return a.owner.localeCompare(b.owner, undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'repo-desc') {
        return b.owner.localeCompare(a.owner, undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'date-asc') {
        return a.latestTimestampMs - b.latestTimestampMs;
      }
      return b.latestTimestampMs - a.latestTimestampMs;
    });
}

export function isLocalSavedAuditRecord(
  rec: SavedAuditHistoryRecord | LocalSavedAuditRecord
): boolean {
  return (
    'storageSource' in rec &&
    (rec.storageSource === 'local' || rec.storageSource === 'imported')
  );
}

function parseIsoDayBoundMs(dateStr: string | undefined, endOfDay: boolean): number | null {
  const clean = (dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const [y, m, d] = clean.split('-').map((n) => Number(n));
  if (!y || !m || !d) return null;
  const dt = endOfDay
    ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
    : new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function parseSearchQueryDateTokens(rawQuery: string): {
  textQuery: string;
  fromMs: number | null;
  toMs: number | null;
} {
  let remaining = (rawQuery || '').trim();
  let fromMs: number | null = null;
  let toMs: number | null = null;

  // Match inline date ranges like "2026-10-01..2026-10-15" or "2026-10-01 to 2026-10-15"
  remaining = remaining.replace(
    /\b(\d{4}-\d{2}-\d{2})\s*(?:\.\.|to)\s*(\d{4}-\d{2}-\d{2})\b/gi,
    (_m, startStr: string, endStr: string) => {
      fromMs = parseIsoDayBoundMs(startStr, false);
      toMs = parseIsoDayBoundMs(endStr, true);
      return ' ';
    }
  );

  // Match inline "after:YYYY-MM-DD" / "from:YYYY-MM-DD"
  remaining = remaining.replace(
    /\b(?:after|from):(\d{4}-\d{2}-\d{2})\b/gi,
    (_m, startStr: string) => {
      fromMs = parseIsoDayBoundMs(startStr, false);
      return ' ';
    }
  );

  // Match inline "before:YYYY-MM-DD" / "to:YYYY-MM-DD"
  remaining = remaining.replace(
    /\b(?:before|to):(\d{4}-\d{2}-\d{2})\b/gi,
    (_m, endStr: string) => {
      toMs = parseIsoDayBoundMs(endStr, true);
      return ' ';
    }
  );

  return {
    textQuery: remaining.replace(/\s+/g, ' ').trim().toLowerCase(),
    fromMs,
    toMs
  };
}

export function filterSavedAuditRecords(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  rawQuery: string,
  phaseFilter: 'all' | 'static' | 'lhr',
  sortBy: SavedAuditSortOption = 'date-desc',
  sourceFilter: SavedAuditSourceFilter = 'all',
  ownerFilter = 'all',
  dateRange?: SavedAuditDateRangeFilter
): (SavedAuditHistoryRecord | LocalSavedAuditRecord)[] {
  const parsedQuery = parseSearchQueryDateTokens(rawQuery || '');
  const q = parsedQuery.textQuery;
  const normalizedOwner = (ownerFilter || 'all').trim().toLowerCase();

  let fromMs: number | null = parsedQuery.fromMs;
  let toMs: number | null = parsedQuery.toMs;

  if (dateRange) {
    const nowMs = dateRange.nowMs ?? Date.now();
    if (dateRange.preset === '24h') {
      const presetFrom = nowMs - 24 * 60 * 60 * 1000;
      fromMs = fromMs === null ? presetFrom : Math.max(fromMs, presetFrom);
    } else if (dateRange.preset === '7d') {
      const presetFrom = nowMs - 7 * 24 * 60 * 60 * 1000;
      fromMs = fromMs === null ? presetFrom : Math.max(fromMs, presetFrom);
    } else if (dateRange.preset === '30d') {
      const presetFrom = nowMs - 30 * 24 * 60 * 60 * 1000;
      fromMs = fromMs === null ? presetFrom : Math.max(fromMs, presetFrom);
    }
    const explicitFrom = parseIsoDayBoundMs(dateRange.fromDate, false);
    const explicitTo = parseIsoDayBoundMs(dateRange.toDate, true);
    if (explicitFrom !== null) {
      fromMs = fromMs === null ? explicitFrom : Math.max(fromMs, explicitFrom);
    }
    if (explicitTo !== null) {
      toMs = toMs === null ? explicitTo : Math.min(toMs, explicitTo);
    }
  }

  const filtered = records.filter((rec) => {
    if (phaseFilter !== 'all' && rec.runPhase !== phaseFilter) {
      return false;
    }
    const isLocal = isLocalSavedAuditRecord(rec);
    if (sourceFilter === 'local' && !isLocal) {
      return false;
    }
    if (sourceFilter === 'firestore' && isLocal) {
      return false;
    }
    if (
      normalizedOwner !== 'all' &&
      extractRepoOwner(rec).toLowerCase() !== normalizedOwner
    ) {
      return false;
    }

    const recTs = getRecordTimestampMs(rec);
    if (fromMs !== null && recTs < fromMs) {
      return false;
    }
    if (toMs !== null && recTs > toMs) {
      return false;
    }

    if (!q) return true;
    const sourceLabel = 'storageSource' in rec ? rec.storageSource : 'firestore';
    const formatLabel = 'savedFormat' in rec ? rec.savedFormat : '';
    const isoDate = (rec.updatedAtIso || rec.createdAtIso || '').slice(0, 10);
    const readableDate = recTs
      ? new Date(recTs).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
      : '';
    const owner = extractRepoOwner(rec);
    const haystack = [
      rec.repoFullName,
      rec.repoUrl || '',
      owner,
      `@${owner}`,
      `org:${owner}`,
      `owner:${owner}`,
      rec.branch || '',
      rec.summaryNotes || '',
      sourceLabel,
      formatLabel,
      isoDate,
      readableDate,
      ...(rec.commitTitles || [])
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  return [...filtered].sort((a, b) => {
    if (sortBy === 'date-asc') {
      return getRecordTimestampMs(a) - getRecordTimestampMs(b);
    }
    if (sortBy === 'repo-asc') {
      const cmp = (a.repoFullName || '').localeCompare(b.repoFullName || '', undefined, {
        sensitivity: 'base'
      });
      return cmp !== 0 ? cmp : getRecordTimestampMs(b) - getRecordTimestampMs(a);
    }
    if (sortBy === 'repo-desc') {
      const cmp = (b.repoFullName || '').localeCompare(a.repoFullName || '', undefined, {
        sensitivity: 'base'
      });
      return cmp !== 0 ? cmp : getRecordTimestampMs(b) - getRecordTimestampMs(a);
    }
    return getRecordTimestampMs(b) - getRecordTimestampMs(a);
  });
}

@Component({
  selector: 'app-saved-audits-drawer',
  imports: [SavedAuditTrendChartComponent, SavedAuditDiffViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscapeKey()'
  },
  template: `
    <div
      class="saved-audits-backdrop"
      [class.is-open]="isOpen()"
      [attr.aria-hidden]="!isOpen()"
      (click)="closeDrawer.emit()"
    ></div>

    <aside
      id="saved-audits-drawer"
      class="saved-audits-drawer"
      [class.is-open]="isOpen()"
      [class.is-diff-mode]="isDiffViewOpen()"
      role="dialog"
      aria-modal="true"
      aria-labelledby="saved-audits-drawer-title"
      [attr.aria-hidden]="!isOpen()"
    >
      <div class="saved-audits-drawer__header">
        <div class="saved-audits-drawer__heading">
          <p class="saved-audits-drawer__kicker">
            <span>{{ storageBackend() === 'indexeddb' ? 'IndexedDB' : 'Local' }} · JSON · TOON · Markdown</span>
            @if (userSession().isAuthenticated) {
              <span aria-hidden="true">·</span>
              <span>Firestore Synced</span>
            }
            @if (!isOnline()) {
              <span aria-hidden="true">·</span>
              <span>Offline Cache Active</span>
            } @else if (offlineReady()) {
              <span aria-hidden="true">·</span>
              <span>Workbox Offline Ready</span>
            }
          </p>
          <h2 id="saved-audits-drawer-title" class="saved-audits-drawer__title">
            Saved Audits
            <span class="saved-audits-drawer__count">{{ savedAudits().length }}</span>
          </h2>
        </div>

        <div class="saved-audits-drawer__header-actions">
          <label
            class="dashboard-inline-btn saved-audits-import-label"
            title="Import a saved audit file (.json, .toon, or .md) or consolidated JSON backup"
          >
            <input
              id="drawer-import-local-file"
              type="file"
              accept=".json,.toon,.md,.markdown,.txt"
              class="sr-only"
              (change)="onImportFileSelected($event)"
            />
            <span>Import File</span>
          </label>
          @if (savedAudits().length > 0) {
            <button
              type="button"
              id="drawer-export-all-json-btn"
              class="dashboard-inline-btn dashboard-inline-btn--primary"
              (click)="exportAllJson.emit()"
              title="Export all saved audits as a single consolidated JSON backup report for offline analysis"
            >
              Export All JSON
            </button>
            <button
              type="button"
              id="drawer-export-csv-btn"
              class="dashboard-inline-btn"
              (click)="exportAllCsv.emit()"
              title="Download historical audit score data as a CSV spreadsheet for Excel or Google Sheets"
            >
              Download as CSV
            </button>
          }
          @if (comparableDiffRepos().length > 0) {
            <button
              type="button"
              id="drawer-toggle-diff-btn"
              class="dashboard-inline-btn"
              [class.is-active]="isDiffViewOpen()"
              [attr.aria-pressed]="isDiffViewOpen()"
              (click)="toggleTopDiffView()"
              title="Compare current repository audit results side-by-side with a previous audit session"
            >
              {{ isDiffViewOpen() ? 'Hide Diff View' : 'Diff View' }}
            </button>
          }
          @if (userSession().isAuthenticated) {
            <button
              type="button"
              id="drawer-refresh-firestore-btn"
              class="dashboard-inline-btn"
              [disabled]="isLoadingHistory()"
              (click)="refreshFromFirestore.emit()"
              title="Refresh saved repository scans from Firestore"
            >
              {{ isLoadingHistory() ? 'Syncing...' : 'Sync' }}
            </button>
          }
          <button
            type="button"
            id="drawer-close-saved-audits-btn"
            class="icon-pill-btn"
            aria-label="Close Saved Audits drawer"
            (click)="closeDrawer.emit()"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div class="saved-audits-drawer__controls">
        @if (importError()) {
          <div class="saved-audits-drawer__alert" role="alert">
            <span>{{ importError() }}</span>
            <button
              type="button"
              class="text-action-btn"
              (click)="importError.set(null)"
            >
              Dismiss
            </button>
          </div>
        } @else if (localNotice()) {
          <div class="saved-audits-drawer__notice" role="status" aria-live="polite">
            {{ localNotice() }}
          </div>
        }

        <div class="saved-audits-format-row">
          <span class="saved-audits-format-label">Local save format:</span>
          <div class="saved-audits-drawer__filters" role="group" aria-label="Preferred local snapshot format">
            <button
              type="button"
              id="drawer-format-json-btn"
              class="saved-audits-filter-btn"
              [class.is-active]="preferredFormat() === 'json'"
              (click)="formatChange.emit('json')"
            >
              JSON
            </button>
            <button
              type="button"
              id="drawer-format-toon-btn"
              class="saved-audits-filter-btn"
              [class.is-active]="preferredFormat() === 'toon'"
              (click)="formatChange.emit('toon')"
            >
              TOON
            </button>
            <button
              type="button"
              id="drawer-format-md-btn"
              class="saved-audits-filter-btn"
              [class.is-active]="preferredFormat() === 'markdown'"
              (click)="formatChange.emit('markdown')"
            >
              Markdown
            </button>
          </div>
        </div>

        @if (savedAudits().length > 0) {
          <div class="saved-audits-search-wrap">
            <label for="drawer-audit-search" class="sr-only">
              Search saved audits by repository name, owner, organization, URL keyword, or date range
            </label>
            <svg
              class="saved-audits-search-wrap__icon"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="5.2" />
              <path d="M12.2 12.2L15.6 15.6" stroke-linecap="round" />
            </svg>
            <input
              id="drawer-audit-search"
              type="search"
              class="saved-audits-drawer__search saved-audits-drawer__search--with-icon"
              placeholder="Search repo name, owner/org, URL, or YYYY-MM-DD..YYYY-MM-DD..."
              [value]="searchQuery()"
              (input)="onSearchInput($event)"
              autocomplete="off"
              spellcheck="false"
            />
            @if (searchQuery().trim().length > 0) {
              <button
                type="button"
                id="drawer-search-clear-btn"
                class="saved-audits-search-wrap__clear"
                aria-label="Clear audit search query"
                (click)="searchQuery.set('')"
              >
                ✕
              </button>
            }
          </div>
        }
      </div>

      <div class="saved-audits-drawer__body">
        @if (isLoadingHistory() && savedAudits().length === 0) {
          <div class="saved-audits-drawer__skeletons" role="status" aria-live="polite">
            <span class="sr-only">Loading saved repository scans...</span>
            <div class="saved-audits-skeleton"></div>
            <div class="saved-audits-skeleton"></div>
            <div class="saved-audits-skeleton"></div>
          </div>
        } @else if (savedAudits().length === 0) {
          <div class="saved-audits-drawer__empty">
            <h3>No saved scans yet</h3>
            <p>
              Completed repository scans are saved locally in your browser and can be exported or re-imported anytime in
              <strong>JSON</strong>, <strong>TOON</strong>, or <strong>Markdown</strong> format.
            </p>
            <div class="saved-audits-drawer__auth-actions">
              @if (hasActiveSession()) {
                <button
                  type="button"
                  id="drawer-save-local-empty-btn"
                  class="primary-flow-btn"
                  (click)="saveCurrentLocal.emit(preferredFormat())"
                >
                  <span>Save Current Scan ({{ preferredFormat().toUpperCase() }})</span>
                </button>
              }
              @if (!userSession().isAuthenticated) {
                <button
                  type="button"
                  id="drawer-signin-github-btn"
                  class="secondary-flow-btn"
                  [disabled]="isSigningIn()"
                  (click)="signInGithub.emit()"
                >
                  <span>{{ isSigningIn() ? 'Signing in...' : 'Optional: Connect GitHub / Firestore Sync' }}</span>
                </button>
              }
            </div>
          </div>
        } @else {
          @if (isDiffViewOpen()) {
            <app-saved-audit-diff-view
              [savedAudits]="savedAudits()"
              [currentSessionRecord]="currentSessionRecord()"
              [targetRepoFullName]="diffTargetRepo()"
              [targetAuditId]="diffTargetAuditId()"
              (selectRepo)="onSelectDiffRepo($event)"
              (closeDiff)="closeDiffView()"
            />
          }

          @if (filteredAudits().length > 0) {
            <!-- D3.js Score Trend Line Chart across runs for a single repository -->
            <app-saved-audit-trend-chart
              [records]="filteredAudits()"
              [isVisible]="isOpen()"
              [focusedRepo]="focusedTrendRepo()"
            />
          }

          <div class="saved-audits-drawer__filter-panel">
            <div
              id="drawer-date-range-controls"
              class="saved-audits-date-row"
              role="group"
              aria-label="Filter saved audits by date range"
            >
              <div class="saved-audits-drawer__filters" role="group" aria-label="Quick date range presets">
                <button
                  type="button"
                  id="drawer-date-preset-all"
                  class="saved-audits-filter-btn"
                  [class.is-active]="datePreset() === 'all'"
                  (click)="selectDatePreset('all')"
                >
                  Any Date
                </button>
                <button
                  type="button"
                  id="drawer-date-preset-24h"
                  class="saved-audits-filter-btn"
                  [class.is-active]="datePreset() === '24h'"
                  (click)="selectDatePreset('24h')"
                >
                  24h
                </button>
                <button
                  type="button"
                  id="drawer-date-preset-7d"
                  class="saved-audits-filter-btn"
                  [class.is-active]="datePreset() === '7d'"
                  (click)="selectDatePreset('7d')"
                >
                  7d
                </button>
                <button
                  type="button"
                  id="drawer-date-preset-30d"
                  class="saved-audits-filter-btn"
                  [class.is-active]="datePreset() === '30d'"
                  (click)="selectDatePreset('30d')"
                >
                  30d
                </button>
              </div>

              <div class="saved-audits-date-inputs">
                <label for="drawer-date-from" class="sr-only">Audit date from</label>
                <input
                  id="drawer-date-from"
                  type="date"
                  class="saved-audits-date-input"
                  [value]="dateFrom()"
                  (change)="onDateFromChange($event)"
                  title="Filter audits on or after this date"
                />
                <span class="saved-audits-date-sep" aria-hidden="true">–</span>
                <label for="drawer-date-to" class="sr-only">Audit date to</label>
                <input
                  id="drawer-date-to"
                  type="date"
                  class="saved-audits-date-input"
                  [value]="dateTo()"
                  (change)="onDateToChange($event)"
                  title="Filter audits on or before this date"
                />
              </div>
            </div>

            <div class="saved-audits-sort-row">
              <div class="saved-audits-drawer__filters" role="group" aria-label="Filter saved scans by phase">
                <button
                  type="button"
                  class="saved-audits-filter-btn"
                  [class.is-active]="phaseFilter() === 'all'"
                  (click)="phaseFilter.set('all')"
                >
                  All ({{ savedAudits().length }})
                </button>
                <button
                  type="button"
                  class="saved-audits-filter-btn"
                  [class.is-active]="phaseFilter() === 'static'"
                  (click)="phaseFilter.set('static')"
                >
                  Static AST
                </button>
                <button
                  type="button"
                  class="saved-audits-filter-btn"
                  [class.is-active]="phaseFilter() === 'lhr'"
                  (click)="phaseFilter.set('lhr')"
                >
                  LHR JSON
                </button>
              </div>

              <div class="saved-audits-sort-field">
                <label for="drawer-audit-sort" class="saved-audits-sort-label">Sort</label>
                <select
                  id="drawer-audit-sort"
                  class="saved-audits-sort-select"
                  aria-label="Sort saved repository audits"
                  [value]="sortBy()"
                  (change)="onSortChange($event)"
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="repo-asc">Repository A–Z</option>
                  <option value="repo-desc">Repository Z–A</option>
                </select>
              </div>
            </div>

            <div class="saved-audits-source-row">
              <span class="saved-audits-format-label">Source:</span>
              <div class="saved-audits-drawer__filters" role="group" aria-label="Filter saved scans by storage source">
                <button
                  type="button"
                  id="drawer-source-all-btn"
                  class="saved-audits-filter-btn"
                  [class.is-active]="sourceFilter() === 'all'"
                  (click)="sourceFilter.set('all')"
                >
                  All
                </button>
                <button
                  type="button"
                  id="drawer-source-local-btn"
                  class="saved-audits-filter-btn"
                  [class.is-active]="sourceFilter() === 'local'"
                  (click)="sourceFilter.set('local')"
                >
                  Local ({{ localCount() }})
                </button>
                <button
                  type="button"
                  id="drawer-source-firestore-btn"
                  class="saved-audits-filter-btn"
                  [class.is-active]="sourceFilter() === 'firestore'"
                  (click)="sourceFilter.set('firestore')"
                >
                  Firestore ({{ firestoreCount() }})
                </button>
              </div>
            </div>

            <div class="saved-audits-owner-row">
              <div class="saved-audits-owner-field">
                <label for="drawer-owner-filter" class="saved-audits-sort-label">Org / Owner</label>
                <select
                  id="drawer-owner-filter"
                  class="saved-audits-sort-select saved-audits-owner-select"
                  aria-label="Filter saved audits by GitHub organization or repository owner"
                  [value]="ownerFilter()"
                  (change)="onOwnerFilterChange($event)"
                >
                  <option value="all">All orgs / owners ({{ ownerOptions().length }})</option>
                  @for (opt of ownerOptions(); track opt.owner) {
                    <option [value]="opt.owner">
                      &#64;{{ opt.owner }} ({{ opt.count }})
                    </option>
                  }
                </select>
              </div>

              <button
                type="button"
                id="drawer-group-by-owner-btn"
                class="saved-audits-filter-btn"
                [class.is-active]="groupByOwner()"
                [attr.aria-pressed]="groupByOwner()"
                (click)="toggleGroupByOwner()"
                title="Toggle grouping saved audits by GitHub organization or repository owner"
              >
                {{ groupByOwner() ? 'Grouped by Org' : 'Group by Org' }}
              </button>
            </div>

            @if (ownerOptions().length > 1) {
              <div
                id="drawer-owner-chips"
                class="saved-audits-owner-chips"
                role="group"
                aria-label="Quick filter by GitHub organization or repository owner"
              >
                <button
                  type="button"
                  class="saved-audits-owner-chip"
                  [class.is-active]="ownerFilter() === 'all'"
                  (click)="ownerFilter.set('all')"
                >
                  All Orgs ({{ savedAudits().length }})
                </button>
                @for (opt of ownerOptions(); track opt.owner) {
                  <button
                    type="button"
                    class="saved-audits-owner-chip"
                    [class.is-active]="ownerFilter().toLowerCase() === opt.owner.toLowerCase()"
                    (click)="onQuickSelectOwner(opt.owner)"
                  >
                    &#64;{{ opt.owner }} ({{ opt.count }})
                  </button>
                }
              </div>
            }
          </div>

          @if (filteredAudits().length === 0) {
            <div class="saved-audits-drawer__empty">
              <h3>No matching scans</h3>
              <p>No saved local or cloud records match your search or phase filter.</p>
              <button
                type="button"
                class="secondary-flow-btn"
                (click)="resetFilters()"
              >
                <span>Reset filters</span>
              </button>
            </div>
          } @else if (groupByOwner()) {
            <div class="saved-audit-owner-groups" aria-label="Saved audits grouped by GitHub organization or owner">
              @for (group of groupedAudits(); track group.owner) {
                <section class="saved-audit-owner-group" [attr.aria-label]="'Organization ' + group.owner">
                  <div class="saved-audit-owner-group__header">
                    <div class="saved-audit-owner-group__identity">
                      <span class="saved-audit-owner-group__owner">&#64;{{ group.owner }}</span>
                      <span class="saved-audit-owner-group__meta">
                        {{ group.count }} {{ group.count === 1 ? 'audit' : 'audits' }}
                        <span aria-hidden="true">·</span>
                        {{ group.repoCount }} {{ group.repoCount === 1 ? 'repo' : 'repos' }}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="text-action-btn saved-audit-owner-group__filter-btn"
                      (click)="onQuickSelectOwner(group.owner)"
                    >
                      {{ ownerFilter().toLowerCase() === group.owner.toLowerCase() ? 'Show all orgs' : 'Focus org' }}
                    </button>
                  </div>

                  <ul class="saved-audits-drawer__list" [attr.aria-label]="'Saved scans for ' + group.owner">
                    @for (rec of group.records; track rec.auditId) {
                      <li
                        class="saved-audit-card"
                        [class.is-loading]="loadingAuditId() === rec.auditId"
                      >
                        <div class="saved-audit-card__top">
                          <div class="saved-audit-card__identity">
                            <h3 class="saved-audit-card__repo" [title]="rec.repoFullName">
                              {{ rec.repoFullName }}
                            </h3>
                            <p class="saved-audit-card__meta">
                              <span class="saved-audit-card__source">{{ sourceLabelFor(rec) }}</span>
                              <span aria-hidden="true">·</span>
                              <span>{{ rec.runPhase === 'lhr' ? 'LHR JSON' : 'Static AST' }}</span>
                              <span aria-hidden="true">·</span>
                              <span>{{ rec.branch || 'main' }}</span>
                              @if (initialAuditId() === rec.auditId) {
                                <span aria-hidden="true">·</span>
                                <span class="saved-audit-card__tag">Initial</span>
                              } @else if (latestAuditId() === rec.auditId) {
                                <span aria-hidden="true">·</span>
                                <span class="saved-audit-card__tag">Latest</span>
                              }
                            </p>
                          </div>
                          <span class="saved-audit-card__date">{{ formatAuditDate(rec.updatedAtIso || rec.createdAtIso) }}</span>
                        </div>

                        <div class="saved-audit-card__scores">
                          <span>
                            Perf <strong>{{ rec.performanceBefore }}→{{ rec.performanceAfter }}</strong>
                            (+{{ Math.max(0, rec.performanceAfter - rec.performanceBefore) }})
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            A11y <strong>{{ rec.accessibilityBefore }}→{{ rec.accessibilityAfter }}</strong>
                            (+{{ Math.max(0, rec.accessibilityAfter - rec.accessibilityBefore) }})
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{{ rec.selectedCommitsCount }}/{{ rec.totalCommitsCount }} commits</span>
                        </div>

                        @if (rec.summaryNotes) {
                          <p class="saved-audit-card__notes">{{ rec.summaryNotes }}</p>
                        }

                        <div class="saved-audit-card__actions">
                          <button
                            type="button"
                            class="dashboard-inline-btn dashboard-inline-btn--primary"
                            [disabled]="loadingAuditId() !== null"
                            (click)="openSavedAudit.emit(rec)"
                          >
                            {{ loadingAuditId() === rec.auditId ? 'Loading scan...' : 'Load Scan Data' }}
                          </button>
                          <button
                            type="button"
                            class="dashboard-inline-btn"
                            [disabled]="loadingAuditId() !== null"
                            (click)="reAuditRepo.emit(rec.repoUrl)"
                          >
                            Re-run
                          </button>
                          <button
                            type="button"
                            class="dashboard-inline-btn"
                            (click)="focusRepoTrend(rec.repoFullName)"
                            title="Plot Performance and Accessibility trend line for this repository"
                          >
                            Trend
                          </button>
                          <button
                            type="button"
                            class="dashboard-inline-btn saved-audit-diff-trigger-btn"
                            [disabled]="!canDiffRepo(rec.repoFullName)"
                            (click)="openDiffForRecord(rec)"
                            [title]="
                              canDiffRepo(rec.repoFullName)
                                ? 'Compare this audit side-by-side against a previous session for ' + rec.repoFullName
                                : 'Save at least 2 audit sessions for ' + rec.repoFullName + ' to open Diff View'
                            "
                          >
                            Diff View
                          </button>
                          <div class="saved-audit-card__exports" role="group" aria-label="Download saved scan file">
                            <button
                              type="button"
                              class="saved-audit-export-chip"
                              (click)="exportRecord.emit({ record: rec, format: 'json' })"
                              title="Download scan as .json"
                            >
                              .json
                            </button>
                            <button
                              type="button"
                              class="saved-audit-export-chip"
                              (click)="exportRecord.emit({ record: rec, format: 'toon' })"
                              title="Download scan as Token-Oriented Object Notation (.toon)"
                            >
                              .toon
                            </button>
                            <button
                              type="button"
                              class="saved-audit-export-chip"
                              (click)="exportRecord.emit({ record: rec, format: 'markdown' })"
                              title="Download scan as Markdown (.md)"
                            >
                              .md
                            </button>
                            <button
                              type="button"
                              class="saved-audit-export-chip"
                              (click)="exportRecordCsv.emit(rec)"
                              title="Download scan scores as CSV (.csv)"
                            >
                              .csv
                            </button>
                          </div>
                          <button
                            type="button"
                            class="text-action-btn"
                            [disabled]="loadingAuditId() !== null"
                            (click)="deleteSavedAudit.emit(rec)"
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    }
                  </ul>
                </section>
              }
            </div>
          } @else {
            <ul class="saved-audits-drawer__list" aria-label="Saved repository scans">
              @for (rec of filteredAudits(); track rec.auditId) {
                <li
                  class="saved-audit-card"
                  [class.is-loading]="loadingAuditId() === rec.auditId"
                >
                  <div class="saved-audit-card__top">
                    <div class="saved-audit-card__identity">
                      <h3 class="saved-audit-card__repo" [title]="rec.repoFullName">
                        {{ rec.repoFullName }}
                      </h3>
                      <p class="saved-audit-card__meta">
                        <span class="saved-audit-card__source">{{ sourceLabelFor(rec) }}</span>
                        <span aria-hidden="true">·</span>
                        <span>{{ rec.runPhase === 'lhr' ? 'LHR JSON' : 'Static AST' }}</span>
                        <span aria-hidden="true">·</span>
                        <span>{{ rec.branch || 'main' }}</span>
                        @if (initialAuditId() === rec.auditId) {
                          <span aria-hidden="true">·</span>
                          <span class="saved-audit-card__tag">Initial</span>
                        } @else if (latestAuditId() === rec.auditId) {
                          <span aria-hidden="true">·</span>
                          <span class="saved-audit-card__tag">Latest</span>
                        }
                      </p>
                    </div>
                    <span class="saved-audit-card__date">{{ formatAuditDate(rec.updatedAtIso || rec.createdAtIso) }}</span>
                  </div>

                  <div class="saved-audit-card__scores">
                    <span>
                      Perf <strong>{{ rec.performanceBefore }}→{{ rec.performanceAfter }}</strong>
                      (+{{ Math.max(0, rec.performanceAfter - rec.performanceBefore) }})
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      A11y <strong>{{ rec.accessibilityBefore }}→{{ rec.accessibilityAfter }}</strong>
                      (+{{ Math.max(0, rec.accessibilityAfter - rec.accessibilityBefore) }})
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{{ rec.selectedCommitsCount }}/{{ rec.totalCommitsCount }} commits</span>
                  </div>

                  @if (rec.summaryNotes) {
                    <p class="saved-audit-card__notes">{{ rec.summaryNotes }}</p>
                  }

                  <div class="saved-audit-card__actions">
                    <button
                      type="button"
                      class="dashboard-inline-btn dashboard-inline-btn--primary"
                      [disabled]="loadingAuditId() !== null"
                      (click)="openSavedAudit.emit(rec)"
                    >
                      {{ loadingAuditId() === rec.auditId ? 'Loading scan...' : 'Load Scan Data' }}
                    </button>
                    <button
                      type="button"
                      class="dashboard-inline-btn"
                      [disabled]="loadingAuditId() !== null"
                      (click)="reAuditRepo.emit(rec.repoUrl)"
                    >
                      Re-run
                    </button>
                    <button
                      type="button"
                      class="dashboard-inline-btn"
                      (click)="focusRepoTrend(rec.repoFullName)"
                      title="Plot Performance and Accessibility trend line for this repository"
                    >
                      Trend
                    </button>
                    <button
                      type="button"
                      class="dashboard-inline-btn saved-audit-diff-trigger-btn"
                      [disabled]="!canDiffRepo(rec.repoFullName)"
                      (click)="openDiffForRecord(rec)"
                      [title]="
                        canDiffRepo(rec.repoFullName)
                          ? 'Compare this audit side-by-side against a previous session for ' + rec.repoFullName
                          : 'Save at least 2 audit sessions for ' + rec.repoFullName + ' to open Diff View'
                      "
                    >
                      Diff View
                    </button>
                    <div class="saved-audit-card__exports" role="group" aria-label="Download saved scan file">
                      <button
                        type="button"
                        class="saved-audit-export-chip"
                        (click)="exportRecord.emit({ record: rec, format: 'json' })"
                        title="Download scan as .json"
                      >
                        .json
                      </button>
                      <button
                        type="button"
                        class="saved-audit-export-chip"
                        (click)="exportRecord.emit({ record: rec, format: 'toon' })"
                        title="Download scan as Token-Oriented Object Notation (.toon)"
                      >
                        .toon
                      </button>
                      <button
                        type="button"
                        class="saved-audit-export-chip"
                        (click)="exportRecord.emit({ record: rec, format: 'markdown' })"
                        title="Download scan as Markdown (.md)"
                      >
                        .md
                      </button>
                      <button
                        type="button"
                        class="saved-audit-export-chip"
                        (click)="exportRecordCsv.emit(rec)"
                        title="Download scan scores as CSV (.csv)"
                      >
                        .csv
                      </button>
                    </div>
                    <button
                      type="button"
                      class="text-action-btn"
                      [disabled]="loadingAuditId() !== null"
                      (click)="deleteSavedAudit.emit(rec)"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              }
            </ul>
          }
        }
      </div>

      <div class="saved-audits-drawer__footer">
        @if (hasActiveSession()) {
          <button
            type="button"
            id="drawer-save-local-btn"
            class="dashboard-inline-btn dashboard-inline-btn--primary"
            (click)="saveCurrentLocal.emit(preferredFormat())"
          >
            Save Local ({{ preferredFormat() === 'markdown' ? 'MD' : preferredFormat().toUpperCase() }})
          </button>
          @if (userSession().isAuthenticated) {
            <button
              type="button"
              class="dashboard-inline-btn"
              [disabled]="isSavingAudit()"
              (click)="saveCurrentAudit.emit()"
            >
              {{ isSavingAudit() ? 'Syncing...' : 'Sync Cloud' }}
            </button>
          }
        }
        @if (savedAudits().length >= 1) {
          <button
            type="button"
            id="drawer-footer-export-all-json-btn"
            class="dashboard-inline-btn"
            (click)="exportAllJson.emit()"
            title="Download full Saved Audits history as one consolidated JSON report"
          >
            Export Full JSON ({{ savedAudits().length }})
          </button>
          <button
            type="button"
            id="drawer-footer-export-csv-btn"
            class="dashboard-inline-btn"
            (click)="exportAllCsv.emit()"
            title="Download historical audit score data as a CSV file for spreadsheet reporting"
          >
            Download as CSV
          </button>
          <button
            type="button"
            id="drawer-auto-compare-btn"
            class="dashboard-inline-btn"
            (click)="autoCompare.emit()"
          >
            Compare Initial vs. Latest
          </button>
        }
        @if (!userSession().isAuthenticated) {
          <button
            type="button"
            id="drawer-footer-google-btn"
            class="text-action-btn"
            [disabled]="isSigningIn()"
            (click)="signInGoogle.emit()"
          >
            {{ isSigningIn() ? 'Signing in...' : 'Google Login' }}
          </button>
          <span aria-hidden="true" style="color: var(--border-card);">·</span>
          <button
            type="button"
            id="drawer-footer-signin-btn"
            class="text-action-btn"
            [disabled]="isSigningIn()"
            (click)="signInGithub.emit()"
          >
            {{ isSigningIn() ? 'Signing in...' : 'GitHub Login' }}
          </button>
        } @else {
          <button
            type="button"
            class="dashboard-inline-btn"
            (click)="openFullModal.emit()"
          >
            Expand Modal
          </button>
        }
      </div>
    </aside>
  `
})
export class SavedAuditsDrawerComponent {
  protected readonly Math = Math;

  readonly isOpen = input.required<boolean>();
  readonly savedAudits = input.required<(SavedAuditHistoryRecord | LocalSavedAuditRecord)[]>();
  readonly userSession = input.required<UserSessionState>();
  readonly preferredFormat = input<LocalAuditFormat>('json');
  readonly localNotice = input<string | null>(null);
  readonly isLoadingHistory = input<boolean>(false);
  readonly isSigningIn = input<boolean>(false);
  readonly isSavingAudit = input<boolean>(false);
  readonly hasActiveSession = input<boolean>(false);
  readonly initialAuditId = input<string | null>(null);
  readonly latestAuditId = input<string | null>(null);
  readonly loadingAuditId = input<string | null>(null);
  readonly offlineReady = input<boolean>(false);
  readonly isOnline = input<boolean>(true);
  readonly storageBackend = input<'indexeddb' | 'localstorage'>('indexeddb');
  readonly currentSessionRecord = input<LocalSavedAuditRecord | null>(null);

  readonly closeDrawer = output<void>();
  readonly openSavedAudit = output<SavedAuditHistoryRecord | LocalSavedAuditRecord>();
  readonly reAuditRepo = output<string>();
  readonly deleteSavedAudit = output<SavedAuditHistoryRecord | LocalSavedAuditRecord>();
  readonly refreshFromFirestore = output<void>();
  readonly autoCompare = output<void>();
  readonly openFullModal = output<void>();
  readonly saveCurrentAudit = output<void>();
  readonly saveCurrentLocal = output<LocalAuditFormat>();
  readonly formatChange = output<LocalAuditFormat>();
  readonly importFile = output<{ filename: string; content: string }>();
  readonly exportRecord = output<{
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord;
    format: LocalAuditFormat;
  }>();
  readonly exportRecordCsv = output<SavedAuditHistoryRecord | LocalSavedAuditRecord>();
  readonly exportAllJson = output<void>();
  readonly exportAllCsv = output<void>();
  readonly signInGithub = output<void>();
  readonly signInGoogle = output<void>();

  private readonly trendChart = viewChild(SavedAuditTrendChartComponent);

  readonly searchQuery = signal<string>('');
  readonly datePreset = signal<SavedAuditDatePreset>('all');
  readonly dateFrom = signal<string>('');
  readonly dateTo = signal<string>('');
  readonly phaseFilter = signal<'all' | 'static' | 'lhr'>('all');
  readonly sortBy = signal<SavedAuditSortOption>('date-desc');
  readonly sourceFilter = signal<SavedAuditSourceFilter>('all');
  readonly ownerFilter = signal<string>('all');
  readonly groupByOwner = signal<boolean>(true);
  readonly focusedTrendRepo = signal<string | null>(null);
  readonly isDiffViewOpen = signal<boolean>(false);
  readonly diffTargetRepo = signal<string | null>(null);
  readonly diffTargetAuditId = signal<string | null>(null);
  readonly importError = signal<string | null>(null);

  readonly comparableDiffRepos = computed(() =>
    listComparableDiffRepositories(this.savedAudits(), this.currentSessionRecord())
  );

  readonly localCount = computed<number>(
    () => this.savedAudits().filter((rec) => isLocalSavedAuditRecord(rec)).length
  );

  readonly firestoreCount = computed<number>(
    () => this.savedAudits().filter((rec) => !isLocalSavedAuditRecord(rec)).length
  );

  readonly ownerOptions = computed<SavedAuditOwnerOption[]>(() =>
    listSavedAuditOwners(this.savedAudits())
  );

  readonly filteredAudits = computed<(SavedAuditHistoryRecord | LocalSavedAuditRecord)[]>(() =>
    filterSavedAuditRecords(
      this.savedAudits(),
      this.searchQuery(),
      this.phaseFilter(),
      this.sortBy(),
      this.sourceFilter(),
      this.ownerFilter(),
      {
        preset: this.datePreset(),
        fromDate: this.dateFrom(),
        toDate: this.dateTo()
      }
    )
  );

  readonly groupedAudits = computed<SavedAuditOwnerGroup[]>(() =>
    groupSavedAuditsByOwner(this.filteredAudits(), this.sortBy())
  );

  canDiffRepo(repoFullName: string): boolean {
    const key = (repoFullName || '').trim().toLowerCase();
    if (!key) return false;
    return this.comparableDiffRepos().some((r) => r.repoFullName.toLowerCase() === key);
  }

  toggleTopDiffView(): void {
    if (this.isDiffViewOpen()) {
      this.closeDiffView();
      return;
    }
    const currentRepo = this.currentSessionRecord()?.repoFullName;
    if (currentRepo && this.canDiffRepo(currentRepo)) {
      this.diffTargetRepo.set(currentRepo);
      this.diffTargetAuditId.set(this.currentSessionRecord()?.auditId ?? null);
    } else {
      const firstComparable = this.comparableDiffRepos()[0];
      this.diffTargetRepo.set(firstComparable?.repoFullName ?? null);
      this.diffTargetAuditId.set(null);
    }
    this.isDiffViewOpen.set(true);
  }

  openDiffForRecord(rec: SavedAuditHistoryRecord | LocalSavedAuditRecord): void {
    this.diffTargetRepo.set(rec.repoFullName);
    this.diffTargetAuditId.set(rec.auditId);
    this.isDiffViewOpen.set(true);
  }

  onSelectDiffRepo(repoFullName: string): void {
    this.diffTargetRepo.set(repoFullName);
    this.diffTargetAuditId.set(null);
  }

  closeDiffView(): void {
    this.isDiffViewOpen.set(false);
  }

  onEscapeKey(): void {
    if (this.isOpen()) {
      this.closeDrawer.emit();
    }
  }

  onSearchInput(event: Event): void {
    const inputEl = event.target as HTMLInputElement | null;
    this.searchQuery.set(inputEl?.value ?? '');
  }

  selectDatePreset(preset: SavedAuditDatePreset): void {
    this.datePreset.set(preset);
    if (preset !== 'custom') {
      this.dateFrom.set('');
      this.dateTo.set('');
    }
  }

  onDateFromChange(event: Event): void {
    const inputEl = event.target as HTMLInputElement | null;
    const val = inputEl?.value ?? '';
    this.dateFrom.set(val);
    this.datePreset.set(val || this.dateTo() ? 'custom' : 'all');
  }

  onDateToChange(event: Event): void {
    const inputEl = event.target as HTMLInputElement | null;
    const val = inputEl?.value ?? '';
    this.dateTo.set(val);
    this.datePreset.set(val || this.dateFrom() ? 'custom' : 'all');
  }

  onSortChange(event: Event): void {
    const selectEl = event.target as HTMLSelectElement | null;
    const value = selectEl?.value;
    if (
      value === 'date-desc' ||
      value === 'date-asc' ||
      value === 'repo-asc' ||
      value === 'repo-desc'
    ) {
      this.sortBy.set(value);
    }
  }

  onOwnerFilterChange(event: Event): void {
    const selectEl = event.target as HTMLSelectElement | null;
    this.ownerFilter.set(selectEl?.value || 'all');
  }

  toggleGroupByOwner(): void {
    this.groupByOwner.update((prev) => !prev);
  }

  onQuickSelectOwner(owner: string): void {
    if (this.ownerFilter().toLowerCase() === owner.toLowerCase()) {
      this.ownerFilter.set('all');
    } else {
      this.ownerFilter.set(owner);
    }
  }

  focusRepoTrend(repoFullName: string): void {
    this.focusedTrendRepo.set(repoFullName);
    this.trendChart()?.focusRepository(repoFullName);
  }

  resetFilters(): void {
    this.searchQuery.set('');
    this.datePreset.set('all');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.phaseFilter.set('all');
    this.sourceFilter.set('all');
    this.ownerFilter.set('all');
    this.focusedTrendRepo.set(null);
    this.sortBy.set('date-desc');
  }

  onImportFileSelected(event: Event): void {
    const inputEl = event.target as HTMLInputElement | null;
    const file = inputEl?.files?.[0];
    if (!file) return;
    this.importError.set(null);

    if (file.size > 2 * 1024 * 1024) {
      this.importError.set('Audit file exceeds 2 MB size limit.');
      inputEl.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.importFile.emit({ filename: file.name, content: reader.result });
      }
      inputEl.value = '';
    };
    reader.onerror = () => {
      this.importError.set('Unable to read the selected local audit file.');
      inputEl.value = '';
    };
    reader.readAsText(file);
  }

  sourceLabelFor(rec: SavedAuditHistoryRecord | LocalSavedAuditRecord): string {
    if (!('storageSource' in rec)) {
      return 'Firestore';
    }
    if (rec.storageSource === 'firestore') {
      return 'Firestore';
    }
    const fmt =
      rec.savedFormat === 'markdown' ? 'MD' : rec.savedFormat.toUpperCase();
    return rec.storageSource === 'imported' ? `Imported ${fmt}` : `Local ${fmt}`;
  }

  formatAuditDate(isoString: string): string {
    if (!isoString) return 'Recently';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return 'Recently';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
