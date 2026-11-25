import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal
} from '@angular/core';
import {
  LocalAuditFormat,
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord,
  UserSessionState
} from '../../models/audit.model';

export type SavedAuditSortOption = 'date-desc' | 'date-asc' | 'repo-asc' | 'repo-desc';
export type SavedAuditSourceFilter = 'all' | 'local' | 'firestore';

function getRecordTimestampMs(rec: SavedAuditHistoryRecord | LocalSavedAuditRecord): number {
  const t = new Date(rec.updatedAtIso || rec.createdAtIso || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function isLocalSavedAuditRecord(
  rec: SavedAuditHistoryRecord | LocalSavedAuditRecord
): boolean {
  return (
    'storageSource' in rec &&
    (rec.storageSource === 'local' || rec.storageSource === 'imported')
  );
}

export function filterSavedAuditRecords(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  rawQuery: string,
  phaseFilter: 'all' | 'static' | 'lhr',
  sortBy: SavedAuditSortOption = 'date-desc',
  sourceFilter: SavedAuditSourceFilter = 'all'
): (SavedAuditHistoryRecord | LocalSavedAuditRecord)[] {
  const q = (rawQuery || '').trim().toLowerCase();
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
    if (!q) return true;
    const sourceLabel = 'storageSource' in rec ? rec.storageSource : 'firestore';
    const formatLabel = 'savedFormat' in rec ? rec.savedFormat : '';
    const haystack = [
      rec.repoFullName,
      rec.branch || '',
      rec.summaryNotes || '',
      sourceLabel,
      formatLabel,
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
      role="dialog"
      aria-modal="true"
      aria-labelledby="saved-audits-drawer-title"
      [attr.aria-hidden]="!isOpen()"
    >
      <div class="saved-audits-drawer__header">
        <div class="saved-audits-drawer__heading">
          <p class="saved-audits-drawer__kicker">
            <span>Local JSON · TOON · Markdown</span>
            @if (userSession().isAuthenticated) {
              <span aria-hidden="true">·</span>
              <span>Firestore Synced</span>
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
            title="Import a saved audit file (.json, .toon, or .md)"
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
          <label for="drawer-audit-search" class="sr-only">Search saved repository audits</label>
          <input
            id="drawer-audit-search"
            type="search"
            class="saved-audits-drawer__search"
            placeholder="Filter by repository, branch, or format..."
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            autocomplete="off"
            spellcheck="false"
          />
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
        } @else if (filteredAudits().length === 0) {
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
  readonly signInGithub = output<void>();
  readonly signInGoogle = output<void>();

  readonly searchQuery = signal<string>('');
  readonly phaseFilter = signal<'all' | 'static' | 'lhr'>('all');
  readonly sortBy = signal<SavedAuditSortOption>('date-desc');
  readonly sourceFilter = signal<SavedAuditSourceFilter>('all');
  readonly importError = signal<string | null>(null);

  readonly localCount = computed<number>(
    () => this.savedAudits().filter((rec) => isLocalSavedAuditRecord(rec)).length
  );

  readonly firestoreCount = computed<number>(
    () => this.savedAudits().filter((rec) => !isLocalSavedAuditRecord(rec)).length
  );

  readonly filteredAudits = computed<(SavedAuditHistoryRecord | LocalSavedAuditRecord)[]>(() =>
    filterSavedAuditRecords(
      this.savedAudits(),
      this.searchQuery(),
      this.phaseFilter(),
      this.sortBy(),
      this.sourceFilter()
    )
  );

  onEscapeKey(): void {
    if (this.isOpen()) {
      this.closeDrawer.emit();
    }
  }

  onSearchInput(event: Event): void {
    const inputEl = event.target as HTMLInputElement | null;
    this.searchQuery.set(inputEl?.value ?? '');
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

  resetFilters(): void {
    this.searchQuery.set('');
    this.phaseFilter.set('all');
    this.sourceFilter.set('all');
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
