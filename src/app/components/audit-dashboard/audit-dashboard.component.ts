import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import * as d3 from 'd3';
import {
  AuditRunPhase,
  CachedRepositoryAuditEntry,
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord,
  UserSessionState
} from '../../models/audit.model';
import { AuditResultCacheService } from '../../services/audit-result-cache.service';
import { FileSystemAuditDataService } from '../../services/file-system-audit-data.service';
import { StorageService } from '../../services/storage.service';
import { BusinessUrlAuditComponent } from '../business-url-audit/business-url-audit.component';
import { AstWorkerScannerComponent } from '../ast-worker-scanner/ast-worker-scanner.component';

export type AuditCategoryKey =
  | 'performance'
  | 'accessibility'
  | 'best-practices'
  | 'seo'
  | 'security';

export type DashboardChartMode = 'bars' | 'donut';

export interface CategoryFindingDatum {
  category: AuditCategoryKey;
  label: string;
  shortLabel: string;
  count: number;
  sharePercent: number;
  avgLift: number;
  colorCssVar: string;
}

interface CategoryDescriptor {
  category: AuditCategoryKey;
  label: string;
  shortLabel: string;
  colorCssVar: string;
  readDelta: (rec: SavedAuditHistoryRecord) => number;
}

const CATEGORY_DESCRIPTORS: readonly CategoryDescriptor[] = [
  {
    category: 'performance',
    label: 'Performance',
    shortLabel: 'Perf',
    colorCssVar: 'var(--cat-perf)',
    readDelta: (r) => Math.max(0, (r.performanceAfter || 0) - (r.performanceBefore || 0))
  },
  {
    category: 'accessibility',
    label: 'Accessibility',
    shortLabel: 'A11y',
    colorCssVar: 'var(--cat-a11y)',
    readDelta: (r) => Math.max(0, (r.accessibilityAfter || 0) - (r.accessibilityBefore || 0))
  },
  {
    category: 'best-practices',
    label: 'Best Practices',
    shortLabel: 'Best Prac.',
    colorCssVar: 'var(--cat-bp)',
    readDelta: (r) => Math.max(0, (r.bestPracticesAfter || 0) - (r.bestPracticesBefore || 0))
  },
  {
    category: 'seo',
    label: 'SEO',
    shortLabel: 'SEO',
    colorCssVar: 'var(--cat-seo)',
    readDelta: (r) => Math.max(0, (r.seoAfter || 0) - (r.seoBefore || 0))
  },
  {
    category: 'security',
    label: 'Security',
    shortLabel: 'Security',
    colorCssVar: 'var(--cat-sec)',
    readDelta: (r) => Math.max(0, (r.securityAfter || 0) - (r.securityBefore || 0))
  }
];

export function classifyCommitTitleCategory(title: string): AuditCategoryKey {
  const lower = (title || '').toLowerCase();
  if (/\b(a11y|aria|contrast|accessibility|focus|button-name|alt|label|skip[- ]link|landmark|tabindex)\b/i.test(lower)) {
    return 'accessibility';
  }
  if (/\b(seo|meta|canonical|sitemap|robots|structured|og:|opengraph)\b/i.test(lower)) {
    return 'seo';
  }
  if (/\b(security|xss|csp|sanitize|secret|token|csrf|eval|innerhtml|redirect|noopener)\b/i.test(lower)) {
    return 'security';
  }
  if (/\b(eslint|best[- ]practice|lint|doctype|console|deprecated|strict)\b/i.test(lower)) {
    return 'best-practices';
  }
  return 'performance';
}

export function computeCategoryFindingsDistribution(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
): CategoryFindingDatum[] {
  const counts: Record<AuditCategoryKey, number> = {
    performance: 0,
    accessibility: 0,
    'best-practices': 0,
    seo: 0,
    security: 0
  };
  const liftSums: Record<AuditCategoryKey, number> = {
    performance: 0,
    accessibility: 0,
    'best-practices': 0,
    seo: 0,
    security: 0
  };

  for (const rec of records) {
    for (const desc of CATEGORY_DESCRIPTORS) {
      liftSums[desc.category] += desc.readDelta(rec);
    }

    const localCommits =
      'snapshotSession' in rec && rec.snapshotSession?.commits?.length
        ? rec.snapshotSession.commits
        : null;

    if (localCommits) {
      for (const commit of localCommits) {
        if (commit.category in counts) {
          counts[commit.category] += 1;
        }
      }
      continue;
    }

    const titles = rec.commitTitles || [];
    for (const title of titles) {
      const cat = classifyCommitTitleCategory(title);
      counts[cat] += 1;
    }

    const targetFindings = Math.max(
      titles.length,
      rec.selectedCommitsCount || rec.totalCommitsCount || 0
    );
    let remaining = targetFindings - titles.length;

    if (remaining > 0) {
      const eligible = CATEGORY_DESCRIPTORS.filter((d) =>
        rec.runPhase === 'lhr' ? d.category !== 'security' : true
      );
      const deltas = eligible.map((d) => ({
        category: d.category,
        delta: d.readDelta(rec)
      }));
      const totalDelta = deltas.reduce((s, item) => s + item.delta, 0);

      if (totalDelta > 0) {
        const allocated: { category: AuditCategoryKey; exact: number; whole: number; rem: number }[] = deltas.map((d) => {
          const exact = (remaining * d.delta) / totalDelta;
          const whole = Math.floor(exact);
          return { category: d.category, exact, whole, rem: exact - whole };
        });
        let used = 0;
        for (const item of allocated) {
          counts[item.category] += item.whole;
          used += item.whole;
        }
        let leftover = remaining - used;
        allocated.sort((a, b) => b.rem - a.rem);
        let idx = 0;
        while (leftover > 0 && allocated.length > 0) {
          counts[allocated[idx % allocated.length].category] += 1;
          leftover -= 1;
          idx += 1;
        }
      } else {
        counts.performance += remaining;
      }
    }
  }

  const totalFindings = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const runCount = records.length;

  return CATEGORY_DESCRIPTORS.map((desc) => {
    const count = counts[desc.category];
    return {
      category: desc.category,
      label: desc.label,
      shortLabel: desc.shortLabel,
      count,
      sharePercent: totalFindings > 0 ? Math.round((count / totalFindings) * 100) : 0,
      avgLift: runCount > 0 ? Math.round(liftSums[desc.category] / runCount) : 0,
      colorCssVar: desc.colorCssVar
    };
  });
}

export interface DashboardSummaryMetrics {
  totalRuns: number;
  uniqueRepositoriesCount: number;
  latestAuditDateIso: string | null;
  avgPerfLift: number;
  avgA11yLift: number;
  totalCommitsSelected: number;
}

export interface RecentRepositorySummary {
  repoFullName: string;
  repoUrl: string;
  latestBranch: string;
  latestAuditDateIso: string;
  latestRunPhase: AuditRunPhase;
  runCount: number;
  latestPerfBefore: number;
  latestPerfAfter: number;
  latestA11yBefore: number;
  latestA11yAfter: number;
  latestRecord: SavedAuditHistoryRecord;
}

export function sortSavedAuditsByDateDesc(
  records: readonly SavedAuditHistoryRecord[]
): SavedAuditHistoryRecord[] {
  return [...records].sort((a, b) => {
    const tA = new Date(a.updatedAtIso || a.createdAtIso || 0).getTime();
    const tB = new Date(b.updatedAtIso || b.createdAtIso || 0).getTime();
    return (Number.isFinite(tB) ? tB : 0) - (Number.isFinite(tA) ? tA : 0);
  });
}

export function computeDashboardSummary(
  records: readonly SavedAuditHistoryRecord[]
): DashboardSummaryMetrics {
  const sorted = sortSavedAuditsByDateDesc(records);
  if (sorted.length === 0) {
    return {
      totalRuns: 0,
      uniqueRepositoriesCount: 0,
      latestAuditDateIso: null,
      avgPerfLift: 0,
      avgA11yLift: 0,
      totalCommitsSelected: 0
    };
  }

  const uniqueRepos = new Set(
    sorted.map((r) => (r.repoFullName || '').trim().toLowerCase()).filter(Boolean)
  );
  const perfLiftSum = sorted.reduce(
    (sum, r) => sum + Math.max(0, (r.performanceAfter || 0) - (r.performanceBefore || 0)),
    0
  );
  const a11yLiftSum = sorted.reduce(
    (sum, r) => sum + Math.max(0, (r.accessibilityAfter || 0) - (r.accessibilityBefore || 0)),
    0
  );
  const totalCommitsSelected = sorted.reduce(
    (sum, r) => sum + Math.max(0, r.selectedCommitsCount || 0),
    0
  );

  return {
    totalRuns: sorted.length,
    uniqueRepositoriesCount: uniqueRepos.size,
    latestAuditDateIso: sorted[0].updatedAtIso || sorted[0].createdAtIso || null,
    avgPerfLift: Math.round(perfLiftSum / sorted.length),
    avgA11yLift: Math.round(a11yLiftSum / sorted.length),
    totalCommitsSelected
  };
}

export function summarizeRecentRepositories(
  records: readonly SavedAuditHistoryRecord[],
  limit = 6
): RecentRepositorySummary[] {
  const sorted = sortSavedAuditsByDateDesc(records);
  const byRepo = new Map<string, RecentRepositorySummary>();

  for (const rec of sorted) {
    const key = (rec.repoFullName || 'owner/repository').trim().toLowerCase();
    const existing = byRepo.get(key);
    if (!existing) {
      byRepo.set(key, {
        repoFullName: rec.repoFullName,
        repoUrl: rec.repoUrl,
        latestBranch: rec.branch || 'main',
        latestAuditDateIso: rec.updatedAtIso || rec.createdAtIso,
        latestRunPhase: rec.runPhase,
        runCount: 1,
        latestPerfBefore: rec.performanceBefore,
        latestPerfAfter: rec.performanceAfter,
        latestA11yBefore: rec.accessibilityBefore,
        latestA11yAfter: rec.accessibilityAfter,
        latestRecord: rec
      });
    } else {
      existing.runCount += 1;
    }
  }

  return Array.from(byRepo.values()).slice(0, Math.max(1, limit));
}

@Component({
  selector: 'app-audit-dashboard',
  standalone: true,
  imports: [BusinessUrlAuditComponent, AstWorkerScannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="dashboard-shell" aria-labelledby="dashboard-heading">
      <!-- Top Editorial Header + Primary Action -->
      <div class="dashboard-header">
        <div class="dashboard-header__intro">
          <p class="dashboard-kicker">
            @if (userSession().isAuthenticated) {
              <span>Firestore Workspace</span>
              <span aria-hidden="true">·</span>
              <span>{{ userSession().displayName }}</span>
            } @else {
              <span>Zero-AI Static AST &amp; Lighthouse Workbench</span>
            }
          </p>
          <h1 id="dashboard-heading" class="dashboard-title">Audit Dashboard</h1>
          <p class="dashboard-subtitle">
            Review past repository audit runs, audit timestamps, and score improvements before launching a new scan.
          </p>
        </div>

        <div class="dashboard-header__actions">
          <button
            type="button"
            id="dashboard-open-drawer-btn"
            class="secondary-flow-btn dashboard-action-btn"
            aria-controls="saved-audits-drawer"
            [attr.aria-expanded]="isDrawerOpen()"
            [attr.aria-label]="'Open Saved Audits drawer (' + savedAudits().length + ' saved reports) to browse, filter, export, or restore your offline JSON, Markdown, and TOON audit history'"
            title="Open the Saved Audits drawer to browse, filter, import, export, or restore your locally saved JSON, Markdown, and TOON audit reports"
            (click)="openDrawer.emit()"
          >
            <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
              <path d="M4.5 3.2h9a1.3 1.3 0 0 1 1.3 1.3v10.8l-5.8-3-5.8 3V4.5a1.3 1.3 0 0 1 1.3-1.3z" stroke-linejoin="round" />
            </svg>
            <span>Saved Audits ({{ savedAudits().length }})</span>
          </button>
          <label
            class="secondary-flow-btn dashboard-action-btn saved-audits-import-label"
            title="Load a local saved audit file (.toon, .json, or .md)"
          >
            <input
              id="dashboard-import-local-file"
              type="file"
              accept=".json,.toon,.md,.markdown,.txt"
              class="sr-only"
              (change)="onImportFileSelected($event)"
            />
            <span>Import File</span>
          </label>
          @if (userSession().isAuthenticated && savedAudits().length >= 2) {
            <button
              type="button"
              id="dashboard-auto-compare-btn"
              class="secondary-flow-btn dashboard-action-btn"
              (click)="autoCompare.emit()"
            >
              <span>Compare Latest Runs</span>
            </button>
          }
          <button
            type="button"
            id="dashboard-new-audit-btn"
            class="primary-flow-btn dashboard-action-btn"
            (click)="startNewAudit.emit()"
          >
            <span>New Audit</span>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M4.5 10h11M10.5 5l5 5-5 5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      @if (importError()) {
        <div class="saved-audits-drawer__alert" role="alert">
          <span>{{ importError() }}</span>
          <button type="button" class="text-action-btn" (click)="importError.set(null)">
            Dismiss
          </button>
        </div>
      } @else if (localNotice()) {
        <div class="saved-audits-drawer__notice" role="status" aria-live="polite">
          {{ localNotice() }}
        </div>
      }

      @if (auditCache.cachedAudits().length > 0) {
        <section
          id="dashboard-recent-cache-strip"
          class="recent-cache-strip"
          aria-labelledby="recent-cache-heading"
        >
          <div class="recent-cache-strip__head">
            <div>
              <h2 id="recent-cache-heading" class="recent-cache-strip__title">
                Recent Cached Scans ({{ auditCache.cacheCount() }} / 5 · LocalStorage)
              </h2>
              <p class="recent-cache-strip__desc">
                Instantly resume any of your last 5 repository audits—including commit selections—after a browser refresh.
              </p>
            </div>
            <button
              type="button"
              id="dashboard-clear-cache-btn"
              class="text-action-btn"
              (click)="auditCache.clearCache()"
            >
              Clear cache
            </button>
          </div>

          <ul class="recent-cache-grid" role="list">
            @for (entry of auditCache.cachedAudits(); track entry.cacheKey) {
              <li class="recent-cache-card">
                <div class="recent-cache-card__top">
                  <div class="recent-cache-card__repo-wrap">
                    <strong class="recent-cache-card__repo" [title]="entry.repoFullName">
                      {{ entry.repoFullName }}
                    </strong>
                    <span class="recent-cache-card__meta">
                      {{ entry.runPhase === 'lhr' ? 'Run 2 · LHR' : 'Static AST' }} · {{ entry.branch }} · {{ formatShortDate(entry.cachedAtIso) }} {{ formatTimeOnly(entry.cachedAtIso) }}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="recent-cache-card__remove"
                    [attr.aria-label]="'Remove cached scan for ' + entry.repoFullName"
                    title="Remove from LocalStorage cache"
                    (click)="auditCache.removeCachedAudit(entry.cacheKey)"
                  >
                    ✕
                  </button>
                </div>

                <div class="recent-cache-card__scores">
                  <span>Perf <strong>{{ entry.performanceBefore }}→{{ entry.performanceAfter }}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>A11y <strong>{{ entry.accessibilityBefore }}→{{ entry.accessibilityAfter }}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>{{ entry.selectedCommitIds.length }}/{{ entry.totalCommitsCount }} commits</span>
                </div>

                <div class="recent-cache-card__actions">
                  <button
                    type="button"
                    class="dashboard-inline-btn dashboard-inline-btn--primary"
                    (click)="resumeCachedAudit.emit(entry)"
                  >
                    Resume scan →
                  </button>
                </div>
              </li>
            }
          </ul>
        </section>
      }

      <!-- Business URL Entering & OSS Audit Suite Component -->
      <app-business-url-audit
        (openSavedAudit)="openSavedAudit.emit($event)"
      />

      <!-- In-Browser Web Worker Acorn AST Scanner -->
      <app-ast-worker-scanner
        (openSavedAudit)="openSavedAudit.emit($event)"
      />

      <!-- Summary KPI Strip (4 Columns, Single-Elevation Hairline Grid) -->
      <div class="dashboard-kpi-strip" role="region" aria-label="Past audit summary metrics">
        <div class="dashboard-kpi-cell">
          <span class="dashboard-kpi-cell__label">Total Audit Runs</span>
          <strong class="dashboard-kpi-cell__value">{{ summary().totalRuns }}</strong>
          <span class="dashboard-kpi-cell__meta">
            {{ userSession().isAuthenticated ? 'Local + Firestore' : 'Saved locally (JSON / TOON / MD)' }}
          </span>
        </div>

        <div class="dashboard-kpi-cell">
          <span class="dashboard-kpi-cell__label">Repositories Audited</span>
          <strong class="dashboard-kpi-cell__value">{{ summary().uniqueRepositoriesCount }}</strong>
          <span class="dashboard-kpi-cell__meta">
            {{ summary().totalCommitsSelected }} atomic commits saved
          </span>
        </div>

        <div class="dashboard-kpi-cell">
          <span class="dashboard-kpi-cell__label">Latest Audit Date</span>
          <strong class="dashboard-kpi-cell__value dashboard-kpi-cell__value--date">
            {{ summary().latestAuditDateIso ? formatShortDate(summary().latestAuditDateIso!) : 'No runs yet' }}
          </strong>
          <span class="dashboard-kpi-cell__meta">
            {{ summary().latestAuditDateIso ? formatTimeOnly(summary().latestAuditDateIso!) : 'Ready to scan' }}
          </span>
        </div>

        <div class="dashboard-kpi-cell">
          <span class="dashboard-kpi-cell__label">Avg. Score Lift</span>
          <strong class="dashboard-kpi-cell__value">
            +{{ summary().avgPerfLift }} / +{{ summary().avgA11yLift }}
          </strong>
          <span class="dashboard-kpi-cell__meta">Perf pts · A11y pts</span>
        </div>
      </div>

      <!-- Body Content Based on Auth / Loading / Saved State -->
      @if (!userSession().isAuthReady && savedAudits().length === 0) {
        <div class="dashboard-state-panel" role="status" aria-live="polite">
          <p class="dashboard-state-panel__title">Checking authentication state…</p>
          <p class="dashboard-state-panel__desc">
            Connecting to Firebase Authentication and Firestore to load your past audit runs.
          </p>
        </div>
      } @else if (!userSession().isAuthenticated && savedAudits().length === 0) {
        <div class="dashboard-state-panel">
          <div class="dashboard-state-panel__copy">
            <h2 class="dashboard-section-title">Sign in to view past Firestore audit runs</h2>
            <p class="dashboard-state-panel__desc">
              Authenticate with GitHub OAuth or Google Sign-In to inspect your saved repositories, audit dates, and before-vs-after score deltas—or jump straight into a new repository audit.
            </p>
            @if (authError(); as err) {
              <p class="dashboard-error-text" role="alert">{{ err }}</p>
            }
          </div>

          <div class="dashboard-state-panel__actions">
            <button
              type="button"
              id="dashboard-github-signin-btn"
              class="primary-flow-btn dashboard-action-btn"
              [disabled]="isSigningIn()"
              (click)="signInGithub.emit()"
            >
              <span>{{ isSigningIn() ? 'Signing in…' : 'Sign in with GitHub' }}</span>
            </button>
            <button
              type="button"
              id="dashboard-google-signin-btn"
              class="secondary-flow-btn dashboard-action-btn"
              [disabled]="isSigningIn()"
              (click)="signInGoogle.emit()"
            >
              <span>Continue with Google</span>
            </button>
            <label
              class="secondary-flow-btn dashboard-action-btn saved-audits-import-label"
              title="Load a local saved audit file (.toon, .json, or .md)"
            >
              <input
                type="file"
                accept=".json,.toon,.md,.markdown,.txt"
                class="sr-only"
                (change)="onImportFileSelected($event)"
              />
              <span>Load .toon / .json / .md File</span>
            </label>
            <button
              type="button"
              class="quiet-demo-link"
              (click)="startDemoAudit.emit()"
            >
              Try demo audit without signing in
            </button>
          </div>
        </div>
      } @else if (isLoadingHistory() && savedAudits().length === 0) {
        <div class="dashboard-skeleton-list" role="status" aria-label="Loading past audit runs">
          <div class="dashboard-skeleton-row"></div>
          <div class="dashboard-skeleton-row"></div>
          <div class="dashboard-skeleton-row"></div>
        </div>
      } @else if (savedAudits().length === 0) {
        <div class="dashboard-state-panel">
          <div class="dashboard-state-panel__copy">
            <h2 class="dashboard-section-title">No past audit runs saved yet</h2>
            <p class="dashboard-state-panel__desc">
              Run your first repository audit and click <strong>Save to account</strong> on the report view to track audited repositories and timestamps here.
            </p>
          </div>
          <div class="dashboard-state-panel__actions">
            <button
              type="button"
              class="primary-flow-btn dashboard-action-btn"
              (click)="startNewAudit.emit()"
            >
              <span>Start First Audit</span>
            </button>
            <button
              type="button"
              class="secondary-flow-btn dashboard-action-btn"
              (click)="startDemoAudit.emit()"
            >
              <span>Run Demo Audit</span>
            </button>
            <label
              class="secondary-flow-btn dashboard-action-btn saved-audits-import-label"
              title="Load a local saved audit file (.toon, .json, or .md)"
            >
              <input
                type="file"
                accept=".json,.toon,.md,.markdown,.txt"
                class="sr-only"
                (change)="onImportFileSelected($event)"
              />
              <span>Load .toon / .json / .md File</span>
            </label>
          </div>
        </div>
      } @else {
        <!-- D3.js Category Findings Distribution Summary Chart -->
        <section class="dashboard-section" aria-labelledby="category-distribution-heading">
          <div class="dashboard-section__head dashboard-section__head--controls">
            <div>
              <h2 id="category-distribution-heading" class="dashboard-section-title">
                Findings Distribution by Category (D3.js Donut)
              </h2>
              <p class="dashboard-section-subtitle">
                {{ totalCategoryFindings() }} aggregated findings across Performance, Accessibility, Best Practices, SEO &amp; Security from {{ scopedChartAudits().length }}
                {{ scopedChartAudits().length === 1 ? 'saved audit' : 'saved audits' }}
                @if (chartScope() === 'local') {
                  <span>(local .json / .toon / .md files)</span>
                }
              </p>
            </div>

            <div class="dashboard-filter-bar">
              <button
                type="button"
                id="dashboard-donut-connect-folder-btn"
                class="dashboard-inline-btn"
                [disabled]="fsData.isSyncing()"
                (click)="onConnectOrSyncFolder()"
                title="Connect a local audit folder using the File System Access API to auto-load and save audit files"
              >
                @if (fsData.hasConnectedDirectory()) {
                  {{ fsData.isSyncing() ? 'Syncing…' : 'Sync Folder (' + fsData.connectedDirectoryName() + ')' }}
                } @else if (fsData.needsPermissionReconnect()) {
                  Reconnect {{ fsData.connectedDirectoryName() }}
                } @else {
                  Connect Local Folder
                }
              </button>

              <button
                type="button"
                id="dashboard-donut-import-file-btn"
                class="dashboard-inline-btn"
                (click)="onOpenDeviceFilePicker()"
                title="Open one or more local .json, .toon, or .md audit files from your device"
              >
                Open Local Files
              </button>

              @if (sortedAudits().length > 0) {
                <button
                  type="button"
                  id="dashboard-donut-save-latest-btn"
                  class="dashboard-inline-btn"
                  (click)="onSaveLatestToDisk('json')"
                  title="Write the most recent audit report as a local JSON file via the File System Access API"
                >
                  Save JSON
                </button>
                <button
                  type="button"
                  id="dashboard-donut-save-markdown-btn"
                  class="dashboard-inline-btn"
                  (click)="onSaveLatestToDisk('markdown')"
                  title="Write the most recent audit report as an offline Markdown (.md) file via the File System Access API"
                >
                  Save Markdown
                </button>
              }

              @if (localAuditsCount() > 0 && localAuditsCount() < savedAudits().length) {
                <div class="dashboard-segmented" role="group" aria-label="Filter chart dataset scope">
                  <button
                    type="button"
                    id="dashboard-chart-scope-all-btn"
                    class="dashboard-segmented__btn"
                    [class.is-active]="chartScope() === 'all'"
                    (click)="chartScope.set('all')"
                  >
                    All ({{ savedAudits().length }})
                  </button>
                  <button
                    type="button"
                    id="dashboard-chart-scope-local-btn"
                    class="dashboard-segmented__btn"
                    [class.is-active]="chartScope() === 'local'"
                    (click)="chartScope.set('local')"
                  >
                    Local Files ({{ localAuditsCount() }})
                  </button>
                </div>
              }

              <div class="dashboard-segmented" role="group" aria-label="Category chart visualization mode">
                <button
                  type="button"
                  id="dashboard-chart-donut-btn"
                  class="dashboard-segmented__btn"
                  [class.is-active]="chartMode() === 'donut'"
                  (click)="chartMode.set('donut')"
                >
                  Donut
                </button>
                <button
                  type="button"
                  id="dashboard-chart-bars-btn"
                  class="dashboard-segmented__btn"
                  [class.is-active]="chartMode() === 'bars'"
                  (click)="chartMode.set('bars')"
                >
                  Bars
                </button>
              </div>
            </div>
          </div>

          @if (fsData.errorMessage(); as fsErr) {
            <div class="dashboard-fsa-sync-bar dashboard-fsa-sync-bar--error" role="alert">
              <span>{{ fsErr }}</span>
              <button type="button" class="text-action-btn" (click)="fsData.errorMessage.set(null)">
                Dismiss
              </button>
            </div>
          } @else if (fsData.statusMessage()) {
            <div class="dashboard-fsa-sync-bar dashboard-fsa-sync-bar--ok" role="status" aria-live="polite">
              <span>{{ fsData.statusMessage() }}</span>
            </div>
          } @else if (fsData.hasConnectedDirectory()) {
            <div class="dashboard-fsa-sync-bar">
              <span>
                File System Access API synced with <strong>{{ fsData.connectedDirectoryName() }}</strong>
                <span aria-hidden="true"> · </span>
                {{ fsData.syncedDiskFilesCount() }} local audit {{ fsData.syncedDiskFilesCount() === 1 ? 'file' : 'files' }} on disk
              </span>
              <button type="button" class="text-action-btn" (click)="fsData.disconnectAuditDirectory()">
                Disconnect
              </button>
            </div>
          }

          <div class="dashboard-chart-panel">
            <div class="dashboard-chart-layout">
              <div
                #categoryChartHost
                id="dashboard-category-d3-chart"
                class="dashboard-d3-host"
                role="img"
                [attr.aria-label]="chartAriaLabel()"
              ></div>

              <div class="dashboard-chart-breakdown" aria-label="Audit findings count by category">
                @for (item of categoryDistribution(); track item.category) {
                  <button
                    type="button"
                    class="dashboard-chart-row"
                    [class.is-active]="activeCategory() === item.category"
                    [class.is-dimmed]="activeCategory() !== null && activeCategory() !== item.category"
                    (mouseenter)="activeCategory.set(item.category)"
                    (mouseleave)="activeCategory.set(null)"
                    (focus)="activeCategory.set(item.category)"
                    (blur)="activeCategory.set(null)"
                    (click)="toggleActiveCategory(item.category)"
                  >
                    <span class="dashboard-chart-row__left">
                      <span
                        class="dashboard-chart-row__swatch"
                        [style.background]="item.colorCssVar"
                        aria-hidden="true"
                      ></span>
                      <span class="dashboard-chart-row__label">{{ item.label }}</span>
                    </span>
                    <span class="dashboard-chart-row__metrics">
                      <strong class="dashboard-chart-row__count">{{ item.count }}</strong>
                      <span class="dashboard-chart-row__share">{{ item.sharePercent }}%</span>
                      <span class="dashboard-chart-row__lift">+{{ item.avgLift }} pts</span>
                    </span>
                  </button>
                }
              </div>
            </div>

            @if (highlightedCategoryDatum(); as activeDatum) {
              <p class="dashboard-chart-summary-line" aria-live="polite">
                <strong>{{ activeDatum.label }}</strong>
                <span aria-hidden="true">·</span>
                <span>{{ activeDatum.count }} {{ activeDatum.count === 1 ? 'finding' : 'findings' }} ({{ activeDatum.sharePercent }}% share)</span>
                <span aria-hidden="true">·</span>
                <span>Avg +{{ activeDatum.avgLift }} pts lift across saved audits</span>
              </p>
            } @else {
              @if (topCategoryDatum(); as topDatum) {
                <p class="dashboard-chart-summary-line">
                  <span>Top category: <strong>{{ topDatum.label }}</strong> ({{ topDatum.count }} findings, {{ topDatum.sharePercent }}%)</span>
                  <span aria-hidden="true">·</span>
                  <span>Hover or select any bar or row to inspect category impact</span>
                </p>
              }
            }
          </div>
        </section>

        <!-- Recent Repositories Audited Grid -->
        <section class="dashboard-section" aria-labelledby="recent-repos-heading">
          <div class="dashboard-section__head">
            <div>
              <h2 id="recent-repos-heading" class="dashboard-section-title">
                Recent Repositories Audited
              </h2>
              <p class="dashboard-section-subtitle">
                Latest snapshot per repository with full audit date and quick re-open actions.
              </p>
            </div>
            @if (userSession().isAuthenticated) {
              <button
                type="button"
                class="text-action-btn"
                [disabled]="isLoadingHistory()"
                (click)="refreshFromFirestore.emit()"
              >
                {{ isLoadingHistory() ? 'Refreshing…' : 'Refresh from Firestore' }}
              </button>
            }
          </div>

          <div class="dashboard-repo-grid">
            @for (repo of recentRepositories(); track repo.repoFullName) {
              <article class="dashboard-repo-card">
                <div class="dashboard-repo-card__top">
                  <h3 class="dashboard-repo-card__name">{{ repo.repoFullName }}</h3>
                  <span class="dashboard-repo-card__date">
                    {{ formatShortDate(repo.latestAuditDateIso) }}
                  </span>
                </div>

                <p class="dashboard-repo-card__meta">
                  <span>{{ repo.latestBranch }}</span>
                  <span aria-hidden="true">·</span>
                  <span>{{ repo.latestRunPhase === 'lhr' ? 'Run 2 · LHR' : 'Run 1 · Static AST' }}</span>
                  <span aria-hidden="true">·</span>
                  <span>{{ repo.runCount }} {{ repo.runCount === 1 ? 'run' : 'runs' }}</span>
                </p>

                <div class="dashboard-repo-card__scores">
                  <span>
                    Perf <strong>{{ repo.latestPerfBefore }} → {{ repo.latestPerfAfter }}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    A11y <strong>{{ repo.latestA11yBefore }} → {{ repo.latestA11yAfter }}</strong>
                  </span>
                </div>

                <div class="dashboard-repo-card__actions">
                  <button
                    type="button"
                    class="dashboard-inline-btn dashboard-inline-btn--primary"
                    (click)="openSavedAudit.emit(repo.latestRecord)"
                  >
                    Open Report
                  </button>
                  <button
                    type="button"
                    class="dashboard-inline-btn"
                    (click)="reAuditRepo.emit(repo.repoUrl)"
                  >
                    Run Fresh Scan
                  </button>
                </div>
              </article>
            }
          </div>
        </section>

        <!-- Complete Past Audit Runs Table -->
        <section class="dashboard-section" aria-labelledby="all-runs-heading">
          <div class="dashboard-section__head dashboard-section__head--controls">
            <div>
              <h2 id="all-runs-heading" class="dashboard-section-title">
                Past Audit Runs ({{ filteredAudits().length }})
              </h2>
              <p class="dashboard-section-subtitle">
                Chronological Firestore audit log ordered from most recent to earliest.
              </p>
            </div>

            <div class="dashboard-filter-bar">
              <div class="dashboard-search-box">
                <label for="dashboard-repo-search" class="sr-only">Filter past audit runs</label>
                <input
                  id="dashboard-repo-search"
                  type="search"
                  class="dashboard-search-box__input"
                  placeholder="Filter by repo, branch, or notes…"
                  [value]="searchQuery()"
                  (input)="onSearchInput($event)"
                />
              </div>

              <div class="dashboard-segmented" role="group" aria-label="Filter by audit phase">
                <button
                  type="button"
                  class="dashboard-segmented__btn"
                  [class.is-active]="phaseFilter() === 'all'"
                  (click)="phaseFilter.set('all')"
                >
                  All
                </button>
                <button
                  type="button"
                  class="dashboard-segmented__btn"
                  [class.is-active]="phaseFilter() === 'static'"
                  (click)="phaseFilter.set('static')"
                >
                  Static AST
                </button>
                <button
                  type="button"
                  class="dashboard-segmented__btn"
                  [class.is-active]="phaseFilter() === 'lhr'"
                  (click)="phaseFilter.set('lhr')"
                >
                  LHR JSON
                </button>
              </div>
            </div>
          </div>

          @if (filteredAudits().length === 0) {
            <div class="dashboard-state-panel">
              <p class="dashboard-state-panel__desc">
                No audit runs match your current filter.
              </p>
              <button
                type="button"
                class="text-action-btn"
                (click)="resetFilters()"
              >
                Clear filters
              </button>
            </div>
          } @else {
            <div class="dashboard-table-wrap">
              <table class="dashboard-table">
                <thead>
                  <tr>
                    <th scope="col">Repository</th>
                    <th scope="col">Audit Date</th>
                    <th scope="col">Phase</th>
                    <th scope="col" class="is-num">Perf</th>
                    <th scope="col" class="is-num">A11y</th>
                    <th scope="col" class="is-num">Commits</th>
                    <th scope="col" class="is-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (rec of filteredAudits(); track rec.auditId) {
                    <tr>
                      <td>
                        <div class="dashboard-table__repo">{{ rec.repoFullName }}</div>
                        <div class="dashboard-table__sub">{{ rec.branch || 'main' }}</div>
                      </td>
                      <td class="dashboard-table__date">
                        <div>{{ formatShortDate(rec.updatedAtIso) }}</div>
                        <div class="dashboard-table__sub">{{ formatTimeOnly(rec.updatedAtIso) }}</div>
                      </td>
                      <td class="dashboard-table__phase">
                        {{ rec.runPhase === 'lhr' ? 'Run 2 · LHR' : 'Run 1 · Static' }}
                      </td>
                      <td class="is-num dashboard-table__num">
                        {{ rec.performanceBefore }} → <strong>{{ rec.performanceAfter }}</strong>
                      </td>
                      <td class="is-num dashboard-table__num">
                        {{ rec.accessibilityBefore }} → <strong>{{ rec.accessibilityAfter }}</strong>
                      </td>
                      <td class="is-num dashboard-table__num">
                        {{ rec.selectedCommitsCount }}/{{ rec.totalCommitsCount }}
                      </td>
                      <td class="is-right dashboard-table__actions">
                        <button
                          type="button"
                          class="dashboard-inline-btn dashboard-inline-btn--primary"
                          (click)="openSavedAudit.emit(rec)"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          class="dashboard-inline-btn"
                          (click)="reAuditRepo.emit(rec.repoUrl)"
                        >
                          Re-scan
                        </button>
                        <button
                          type="button"
                          class="text-action-btn"
                          [attr.aria-label]="'Delete audit run for ' + rec.repoFullName"
                          (click)="deleteSavedAudit.emit(rec.auditId)"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }
    </section>
  `
})
export class AuditDashboardComponent {
  readonly fsData = inject(FileSystemAuditDataService);
  readonly storage = inject(StorageService);
  readonly auditCache = inject(AuditResultCacheService);

  readonly savedAudits = input<(SavedAuditHistoryRecord | LocalSavedAuditRecord)[]>([]);
  readonly userSession = input.required<UserSessionState>();
  readonly isLoadingHistory = input<boolean>(false);
  readonly isSigningIn = input<boolean>(false);
  readonly authError = input<string | null>(null);
  readonly localNotice = input<string | null>(null);
  readonly isDrawerOpen = input<boolean>(false);

  readonly startNewAudit = output<void>();
  readonly startDemoAudit = output<void>();
  readonly reAuditRepo = output<string>();
  readonly openSavedAudit = output<SavedAuditHistoryRecord | LocalSavedAuditRecord>();
  readonly resumeCachedAudit = output<CachedRepositoryAuditEntry>();
  readonly deleteSavedAudit = output<string>();
  readonly refreshFromFirestore = output<void>();
  readonly autoCompare = output<void>();
  readonly openDrawer = output<void>();
  readonly importFile = output<{ filename: string; content: string }>();
  readonly loadSampleAudits = output<void>();
  readonly openPushTroubleshooter = output<void>();
  readonly signInGithub = output<void>();
  readonly signInGoogle = output<void>();

  private readonly categoryChartHost = viewChild<ElementRef<HTMLDivElement>>('categoryChartHost');

  readonly searchQuery = signal<string>('');
  readonly phaseFilter = signal<'all' | 'static' | 'lhr'>('all');
  readonly chartMode = signal<DashboardChartMode>('donut');
  readonly chartScope = signal<'all' | 'local'>('all');
  readonly activeCategory = signal<AuditCategoryKey | null>(null);
  readonly importError = signal<string | null>(null);

  readonly sortedAudits = computed<(SavedAuditHistoryRecord | LocalSavedAuditRecord)[]>(() =>
    sortSavedAuditsByDateDesc(this.savedAudits())
  );

  readonly localAuditsCount = computed<number>(
    () =>
      this.sortedAudits().filter(
        (rec) =>
          'storageSource' in rec &&
          (rec.storageSource === 'local' || rec.storageSource === 'imported')
      ).length
  );

  readonly scopedChartAudits = computed<(SavedAuditHistoryRecord | LocalSavedAuditRecord)[]>(() => {
    const all = this.sortedAudits();
    if (this.chartScope() === 'local' && this.localAuditsCount() > 0) {
      return all.filter(
        (rec) =>
          'storageSource' in rec &&
          (rec.storageSource === 'local' || rec.storageSource === 'imported')
      );
    }
    return all;
  });

  readonly summary = computed<DashboardSummaryMetrics>(() =>
    computeDashboardSummary(this.sortedAudits())
  );

  readonly categoryDistribution = computed<CategoryFindingDatum[]>(() =>
    computeCategoryFindingsDistribution(this.scopedChartAudits())
  );

  readonly totalCategoryFindings = computed<number>(() =>
    this.categoryDistribution().reduce((sum, d) => sum + d.count, 0)
  );

  readonly topCategoryDatum = computed<CategoryFindingDatum | null>(() => {
    const items = this.categoryDistribution().filter((d) => d.count > 0);
    if (items.length === 0) return null;
    return items.reduce((best, cur) => (cur.count > best.count ? cur : best), items[0]);
  });

  readonly highlightedCategoryDatum = computed<CategoryFindingDatum | null>(() => {
    const active = this.activeCategory();
    if (!active) return null;
    return this.categoryDistribution().find((d) => d.category === active) ?? null;
  });

  readonly chartAriaLabel = computed<string>(() => {
    const parts = this.categoryDistribution().map(
      (d) => `${d.label}: ${d.count} findings (${d.sharePercent}%)`
    );
    return `D3 chart of audit findings distribution by category. ${parts.join(', ')}.`;
  });

  readonly recentRepositories = computed<RecentRepositorySummary[]>(() =>
    summarizeRecentRepositories(this.sortedAudits(), 6)
  );

  readonly filteredAudits = computed<SavedAuditHistoryRecord[]>(() => {
    const phase = this.phaseFilter();
    const query = this.searchQuery().trim().toLowerCase();
    return this.sortedAudits().filter((rec) => {
      if (phase !== 'all' && rec.runPhase !== phase) return false;
      if (!query) return true;
      const hay = `${rec.repoFullName} ${rec.branch || ''} ${rec.summaryNotes || ''}`.toLowerCase();
      return hay.includes(query);
    });
  });

  constructor() {
    effect(() => {
      const hostEl = this.categoryChartHost()?.nativeElement;
      const data = this.categoryDistribution();
      const mode = this.chartMode();
      if (!hostEl || typeof window === 'undefined') {
        return;
      }
      this.renderCategoryD3Chart(hostEl, data, mode);
    });

    effect(() => {
      const hostEl = this.categoryChartHost()?.nativeElement;
      const active = this.activeCategory();
      if (!hostEl || typeof window === 'undefined') {
        return;
      }
      this.syncCategoryD3Highlight(hostEl, active);
    });
  }

  toggleActiveCategory(category: AuditCategoryKey): void {
    this.activeCategory.update((cur) => (cur === category ? null : category));
  }

  private renderCategoryD3Chart(
    hostEl: HTMLDivElement,
    data: CategoryFindingDatum[],
    mode: DashboardChartMode
  ): void {
    const root = d3.select(hostEl);
    root.selectAll('*').remove();

    const total = data.reduce((s, d) => s + d.count, 0);
    if (mode === 'donut') {
      this.renderDonutChart(root, data, total);
      return;
    }
    this.renderHorizontalBarChart(root, data);
  }

  private renderHorizontalBarChart(
    root: d3.Selection<HTMLDivElement, unknown, null, undefined>,
    data: CategoryFindingDatum[]
  ): void {
    const width = 460;
    const height = 216;
    const margin = { top: 10, right: 68, bottom: 24, left: 102 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = root
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('class', 'dashboard-d3-svg')
      .attr('aria-hidden', 'true');

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const maxCount = Math.max(1, d3.max(data, (d) => d.count) ?? 1);
    const xScale = d3.scaleLinear().domain([0, maxCount]).nice(4).range([0, innerWidth]);
    const yScale = d3
      .scaleBand<string>()
      .domain(data.map((d) => d.category))
      .range([0, innerHeight])
      .padding(0.32);

    const ticks = xScale.ticks(4);
    g.selectAll('line.d3-grid-line')
      .data(ticks)
      .enter()
      .append('line')
      .attr('class', 'd3-grid-line')
      .attr('x1', (t) => xScale(t))
      .attr('x2', (t) => xScale(t))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', 'var(--border-hairline)')
      .attr('stroke-width', 1);

    g.selectAll('text.d3-axis-tick')
      .data(ticks)
      .enter()
      .append('text')
      .attr('class', 'd3-axis-tick')
      .attr('x', (t) => xScale(t))
      .attr('y', innerHeight + 16)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '10px')
      .attr('font-family', 'var(--font-mono)')
      .text((t) => (Number.isInteger(t) ? String(t) : ''));

    const rows = g
      .selectAll('g.d3-cat-bar-row')
      .data(data)
      .enter()
      .append('g')
      .attr('class', 'd3-cat-bar-row')
      .attr('data-category', (d) => d.category)
      .attr('transform', (d) => `translate(0,${yScale(d.category) ?? 0})`)
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => this.activeCategory.set(d.category))
      .on('mouseleave', () => this.activeCategory.set(null))
      .on('click', (_event, d) => this.toggleActiveCategory(d.category));

    const barHeight = Math.max(10, yScale.bandwidth());

    rows
      .append('rect')
      .attr('class', 'd3-cat-track')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', barHeight)
      .attr('rx', 4)
      .attr('fill', 'var(--bg-subtle)');

    rows
      .append('rect')
      .attr('class', 'd3-cat-bar')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', (d) => (d.count > 0 ? Math.max(4, xScale(d.count)) : 0))
      .attr('height', barHeight)
      .attr('rx', 4)
      .attr('fill', (d) => d.colorCssVar);

    rows
      .append('text')
      .attr('class', 'd3-cat-label')
      .attr('x', -10)
      .attr('y', barHeight / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', 'var(--text-body)')
      .attr('font-size', '11.5px')
      .attr('font-weight', '600')
      .text((d) => d.label);

    rows
      .append('text')
      .attr('class', 'd3-cat-value')
      .attr('x', (d) => (d.count > 0 ? Math.max(4, xScale(d.count)) + 8 : 8))
      .attr('y', barHeight / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'start')
      .attr('fill', 'var(--text-main)')
      .attr('font-size', '11px')
      .attr('font-family', 'var(--font-mono)')
      .text((d) => `${d.count} · ${d.sharePercent}%`);
  }

  private renderDonutChart(
    root: d3.Selection<HTMLDivElement, unknown, null, undefined>,
    data: CategoryFindingDatum[],
    total: number
  ): void {
    const width = 340;
    const height = 228;
    const radius = Math.min(width, height) / 2 - 18;

    const svg = root
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('class', 'dashboard-d3-svg')
      .attr('aria-hidden', 'true');

    const g = svg
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    const nonZero = data.filter((d) => d.count > 0);
    if (nonZero.length === 0) {
      g.append('circle')
        .attr('r', radius)
        .attr('fill', 'none')
        .attr('stroke', 'var(--border-hairline)')
        .attr('stroke-width', 24);
    } else {
      const pie = d3
        .pie<CategoryFindingDatum>()
        .value((d) => d.count)
        .sort(null)
        .padAngle(0.03);

      const arc = d3
        .arc<d3.PieArcDatum<CategoryFindingDatum>>()
        .innerRadius(radius * 0.57)
        .outerRadius(radius)
        .cornerRadius(3.5);

      const labelArc = d3
        .arc<d3.PieArcDatum<CategoryFindingDatum>>()
        .innerRadius(radius * 0.78)
        .outerRadius(radius * 0.78);

      const pieData = pie(nonZero);

      const slices = g
        .selectAll('path.d3-cat-slice')
        .data(pieData)
        .enter()
        .append('path')
        .attr('class', 'd3-cat-slice')
        .attr('data-category', (d) => d.data.category)
        .attr('d', arc)
        .attr('fill', (d) => d.data.colorCssVar)
        .attr('stroke', 'var(--bg-card, #ffffff)')
        .attr('stroke-width', 2)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-label', (d) => `${d.data.label}: ${d.data.count} findings (${d.data.sharePercent}%)`)
        .style('cursor', 'pointer')
        .on('mouseenter', (_event, d) => this.activeCategory.set(d.data.category))
        .on('mouseleave', () => this.activeCategory.set(null))
        .on('keydown', (event: KeyboardEvent, d) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.toggleActiveCategory(d.data.category);
          }
        })
        .on('click', (_event, d) => this.toggleActiveCategory(d.data.category));

      slices
        .append('title')
        .text((d) => `${d.data.label}: ${d.data.count} findings (${d.data.sharePercent}% of total)`);

      g.selectAll('text.d3-slice-pct')
        .data(pieData.filter((d) => d.data.sharePercent >= 9))
        .enter()
        .append('text')
        .attr('class', 'd3-slice-pct')
        .attr('transform', (d) => `translate(${labelArc.centroid(d)})`)
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', '#ffffff')
        .attr('font-family', 'var(--font-mono)')
        .attr('font-size', '10px')
        .attr('font-weight', '700')
        .style('pointer-events', 'none')
        .text((d) => `${d.data.sharePercent}%`);
    }

    g.append('text')
      .attr('class', 'd3-donut-total')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.08em')
      .attr('fill', 'var(--text-main)')
      .attr('font-family', 'var(--font-mono)')
      .attr('font-size', '23px')
      .attr('font-weight', '700')
      .text(String(total));

    g.append('text')
      .attr('class', 'd3-donut-caption')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.35em')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '11px')
      .text('Total findings');
  }

  private syncCategoryD3Highlight(
    hostEl: HTMLDivElement,
    active: AuditCategoryKey | null
  ): void {
    const root = d3.select(hostEl);
    root
      .selectAll<SVGGElement, CategoryFindingDatum>('g.d3-cat-bar-row')
      .style('opacity', (d) => (!active || d.category === active ? '1' : '0.35'));

    const radius = Math.min(340, 228) / 2 - 18;
    const baseArc = d3
      .arc<d3.PieArcDatum<CategoryFindingDatum>>()
      .innerRadius(radius * 0.57)
      .outerRadius(radius)
      .cornerRadius(3.5);
    const expandedArc = d3
      .arc<d3.PieArcDatum<CategoryFindingDatum>>()
      .innerRadius(radius * 0.57)
      .outerRadius(radius + 6)
      .cornerRadius(4);

    root
      .selectAll<SVGPathElement, d3.PieArcDatum<CategoryFindingDatum>>('path.d3-cat-slice')
      .style('opacity', (d) => (!active || d.data.category === active ? '1' : '0.35'))
      .attr('d', (d) => (active && d.data.category === active ? expandedArc(d) : baseArc(d)) || '');

    const totalEl = root.select<SVGTextElement>('text.d3-donut-total');
    const captionEl = root.select<SVGTextElement>('text.d3-donut-caption');

    if (!totalEl.empty() && !captionEl.empty()) {
      if (active) {
        const activeDatum = this.categoryDistribution().find((d) => d.category === active);
        if (activeDatum) {
          totalEl
            .text(String(activeDatum.count))
            .attr('fill', activeDatum.colorCssVar);
          captionEl.text(`${activeDatum.shortLabel} (${activeDatum.sharePercent}%)`);
          return;
        }
      }
      totalEl
        .text(String(this.totalCategoryFindings()))
        .attr('fill', 'var(--text-main)');
      captionEl.text('Total findings');
    }
  }

  async onConnectOrSyncFolder(): Promise<void> {
    if (this.storage.hasConnectedFolder()) {
      await this.storage.syncOfflineDirectory();
      return;
    }
    await this.storage.connectOfflineDirectory();
  }

  async onOpenDeviceFilePicker(): Promise<void> {
    this.importError.set(null);
    try {
      await this.storage.readAuditFiles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to parse selected local audit file.';
      this.importError.set(msg);
    }
  }

  async onSaveLatestToDisk(format?: 'json' | 'markdown'): Promise<void> {
    const latest = this.sortedAudits()[0];
    if (!latest) return;
    const targetFormat =
      format ?? ('savedFormat' in latest && latest.savedFormat ? latest.savedFormat : 'json');
    if (targetFormat === 'markdown') {
      await this.storage.writeAuditMarkdown(latest);
      return;
    }
    if (targetFormat === 'json') {
      await this.storage.writeAuditJson(latest);
      return;
    }
    await this.storage.writeAuditFile(latest, targetFormat);
  }

  onSearchInput(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    this.searchQuery.set(el?.value ?? '');
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

  resetFilters(): void {
    this.searchQuery.set('');
    this.phaseFilter.set('all');
  }

  formatShortDate(iso: string): string {
    if (!iso) return 'Recently';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Recently';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  formatTimeOnly(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
