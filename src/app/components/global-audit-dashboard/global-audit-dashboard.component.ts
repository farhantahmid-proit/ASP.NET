import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import * as d3 from 'd3';
import {
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord
} from '../../models/audit.model';
import {
  SavedAuditOwnerOption,
  extractRepoOwner,
  listSavedAuditOwners
} from '../saved-audits-drawer/saved-audits-drawer.component';

export type GlobalChartViewMode = 'cumulative' | 'average';

export interface GlobalCumulativePoint {
  index: number;
  auditId: string;
  repoFullName: string;
  owner: string;
  branch: string;
  runPhase: 'static' | 'lhr';
  timestampMs: number;
  dateIso: string;
  shortDate: string;
  fullDate: string;
  perfBefore: number;
  perfAfter: number;
  perfLift: number;
  a11yBefore: number;
  a11yAfter: number;
  a11yLift: number;
  cumulativePerfLift: number;
  cumulativeA11yLift: number;
  rollingAvgPerfAfter: number;
  rollingAvgA11yAfter: number;
  cumulativeReposCount: number;
  record: SavedAuditHistoryRecord | LocalSavedAuditRecord;
}

export interface GlobalRepoContribution {
  repoFullName: string;
  owner: string;
  runCount: number;
  cumulativePerfLift: number;
  cumulativeA11yLift: number;
  totalLift: number;
  sharePercent: number;
  latestPerfAfter: number;
  latestA11yAfter: number;
  latestDateIso: string;
  latestRecord: SavedAuditHistoryRecord | LocalSavedAuditRecord;
}

export interface GlobalDashboardMetrics {
  totalRuns: number;
  uniqueRepos: number;
  uniqueOrgs: number;
  cumulativePerfLift: number;
  cumulativeA11yLift: number;
  avgPerfLift: number;
  avgA11yLift: number;
  fleetAvgPerfAfter: number;
  fleetAvgA11yAfter: number;
}

function toTimestampMs(rec: SavedAuditHistoryRecord | LocalSavedAuditRecord): number {
  const t = new Date(rec.updatedAtIso || rec.createdAtIso || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function clampScore(value: number | undefined | null): number {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function formatShortTimelineDate(ms: number, idx: number): string {
  if (!ms) return `Run ${idx}`;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return `Run ${idx}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullTimelineDate(ms: number): string {
  if (!ms) return 'Recent audit';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return 'Recent audit';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function filterGlobalRecords(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  ownerFilter = 'all',
  phaseFilter: 'all' | 'static' | 'lhr' = 'all'
): (SavedAuditHistoryRecord | LocalSavedAuditRecord)[] {
  const normalizedOwner = (ownerFilter || 'all').trim().toLowerCase();
  return records.filter((rec) => {
    if (phaseFilter !== 'all' && rec.runPhase !== phaseFilter) {
      return false;
    }
    if (
      normalizedOwner !== 'all' &&
      extractRepoOwner(rec).toLowerCase() !== normalizedOwner
    ) {
      return false;
    }
    return true;
  });
}

export function buildGlobalCumulativeTimeline(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  ownerFilter = 'all',
  phaseFilter: 'all' | 'static' | 'lhr' = 'all'
): GlobalCumulativePoint[] {
  const filtered = filterGlobalRecords(records, ownerFilter, phaseFilter);
  const chronological = [...filtered].sort((a, b) => {
    const diff = toTimestampMs(a) - toTimestampMs(b);
    if (diff !== 0) return diff;
    return (a.auditId || '').localeCompare(b.auditId || '');
  });

  const seenRepos = new Set<string>();
  let cumulativePerfLift = 0;
  let cumulativeA11yLift = 0;
  let sumPerfAfter = 0;
  let sumA11yAfter = 0;

  return chronological.map((rec, idx) => {
    const index = idx + 1;
    const ts = toTimestampMs(rec);
    const repoFullName = (rec.repoFullName || 'owner/repository').trim();
    const owner = extractRepoOwner(rec);
    seenRepos.add(repoFullName.toLowerCase());

    const perfBefore = clampScore(rec.performanceBefore);
    const perfAfter = clampScore(rec.performanceAfter);
    const a11yBefore = clampScore(rec.accessibilityBefore);
    const a11yAfter = clampScore(rec.accessibilityAfter);
    const perfLift = Math.max(0, perfAfter - perfBefore);
    const a11yLift = Math.max(0, a11yAfter - a11yBefore);

    cumulativePerfLift += perfLift;
    cumulativeA11yLift += a11yLift;
    sumPerfAfter += perfAfter;
    sumA11yAfter += a11yAfter;

    return {
      index,
      auditId: rec.auditId,
      repoFullName,
      owner,
      branch: rec.branch || 'main',
      runPhase: rec.runPhase === 'lhr' ? 'lhr' : 'static',
      timestampMs: ts,
      dateIso: rec.updatedAtIso || rec.createdAtIso || '',
      shortDate: formatShortTimelineDate(ts, index),
      fullDate: formatFullTimelineDate(ts),
      perfBefore,
      perfAfter,
      perfLift,
      a11yBefore,
      a11yAfter,
      a11yLift,
      cumulativePerfLift,
      cumulativeA11yLift,
      rollingAvgPerfAfter: Math.round(sumPerfAfter / index),
      rollingAvgA11yAfter: Math.round(sumA11yAfter / index),
      cumulativeReposCount: seenRepos.size,
      record: rec
    };
  });
}

export function computeGlobalDashboardMetrics(
  timeline: readonly GlobalCumulativePoint[]
): GlobalDashboardMetrics {
  if (timeline.length === 0) {
    return {
      totalRuns: 0,
      uniqueRepos: 0,
      uniqueOrgs: 0,
      cumulativePerfLift: 0,
      cumulativeA11yLift: 0,
      avgPerfLift: 0,
      avgA11yLift: 0,
      fleetAvgPerfAfter: 0,
      fleetAvgA11yAfter: 0
    };
  }

  const last = timeline[timeline.length - 1];
  const orgSet = new Set(timeline.map((pt) => pt.owner.toLowerCase()));

  return {
    totalRuns: timeline.length,
    uniqueRepos: last.cumulativeReposCount,
    uniqueOrgs: orgSet.size,
    cumulativePerfLift: last.cumulativePerfLift,
    cumulativeA11yLift: last.cumulativeA11yLift,
    avgPerfLift: Math.round(last.cumulativePerfLift / timeline.length),
    avgA11yLift: Math.round(last.cumulativeA11yLift / timeline.length),
    fleetAvgPerfAfter: last.rollingAvgPerfAfter,
    fleetAvgA11yAfter: last.rollingAvgA11yAfter
  };
}

export function buildGlobalRepoContributions(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  ownerFilter = 'all',
  phaseFilter: 'all' | 'static' | 'lhr' = 'all'
): GlobalRepoContribution[] {
  const filtered = filterGlobalRecords(records, ownerFilter, phaseFilter);
  const byRepo = new Map<
    string,
    {
      repoFullName: string;
      owner: string;
      runCount: number;
      cumulativePerfLift: number;
      cumulativeA11yLift: number;
      latestTs: number;
      latestPerfAfter: number;
      latestA11yAfter: number;
      latestDateIso: string;
      latestRecord: SavedAuditHistoryRecord | LocalSavedAuditRecord;
    }
  >();

  for (const rec of filtered) {
    const repoFullName = (rec.repoFullName || 'owner/repository').trim();
    const key = repoFullName.toLowerCase();
    const owner = extractRepoOwner(rec);
    const ts = toTimestampMs(rec);
    const perfBefore = clampScore(rec.performanceBefore);
    const perfAfter = clampScore(rec.performanceAfter);
    const a11yBefore = clampScore(rec.accessibilityBefore);
    const a11yAfter = clampScore(rec.accessibilityAfter);
    const perfLift = Math.max(0, perfAfter - perfBefore);
    const a11yLift = Math.max(0, a11yAfter - a11yBefore);

    const existing = byRepo.get(key);
    if (!existing) {
      byRepo.set(key, {
        repoFullName,
        owner,
        runCount: 1,
        cumulativePerfLift: perfLift,
        cumulativeA11yLift: a11yLift,
        latestTs: ts,
        latestPerfAfter: perfAfter,
        latestA11yAfter: a11yAfter,
        latestDateIso: rec.updatedAtIso || rec.createdAtIso || '',
        latestRecord: rec
      });
    } else {
      existing.runCount += 1;
      existing.cumulativePerfLift += perfLift;
      existing.cumulativeA11yLift += a11yLift;
      if (ts >= existing.latestTs) {
        existing.latestTs = ts;
        existing.latestPerfAfter = perfAfter;
        existing.latestA11yAfter = a11yAfter;
        existing.latestDateIso = rec.updatedAtIso || rec.createdAtIso || '';
        existing.latestRecord = rec;
      }
    }
  }

  const rows = Array.from(byRepo.values());
  const grandTotal = rows.reduce(
    (sum, r) => sum + r.cumulativePerfLift + r.cumulativeA11yLift,
    0
  );

  return rows
    .map((r) => {
      const totalLift = r.cumulativePerfLift + r.cumulativeA11yLift;
      return {
        repoFullName: r.repoFullName,
        owner: r.owner,
        runCount: r.runCount,
        cumulativePerfLift: r.cumulativePerfLift,
        cumulativeA11yLift: r.cumulativeA11yLift,
        totalLift,
        sharePercent: grandTotal > 0 ? Math.round((totalLift / grandTotal) * 100) : 0,
        latestPerfAfter: r.latestPerfAfter,
        latestA11yAfter: r.latestA11yAfter,
        latestDateIso: r.latestDateIso,
        latestRecord: r.latestRecord
      };
    })
    .sort((a, b) => {
      if (b.totalLift !== a.totalLift) return b.totalLift - a.totalLift;
      return b.runCount - a.runCount;
    });
}

@Component({
  selector: 'app-global-audit-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="global-audit-dashboard-section"
      class="dashboard-section global-dashboard"
      aria-labelledby="global-audit-dashboard-heading"
    >
      <div class="dashboard-section__head dashboard-section__head--controls">
        <div>
          <h2 id="global-audit-dashboard-heading" class="dashboard-section-title">
            Global Audit Dashboard
          </h2>
          <p class="dashboard-section-subtitle">
            Cumulative Performance and Accessibility improvements aggregated across all audited repositories over time (D3.js).
          </p>
        </div>

        <div class="dashboard-filter-bar">
          @if (ownerOptions().length > 1) {
            <div class="global-dashboard__select-wrap">
              <label for="global-dashboard-owner-select" class="sr-only">
                Filter Global Audit Dashboard by organization or repository owner
              </label>
              <select
                id="global-dashboard-owner-select"
                class="saved-audits-sort-select"
                [value]="ownerFilter()"
                (change)="onOwnerFilterChange($event)"
              >
                <option value="all">All orgs ({{ ownerOptions().length }})</option>
                @for (opt of ownerOptions(); track opt.owner) {
                  <option [value]="opt.owner">
                    &#64;{{ opt.owner }} ({{ opt.count }})
                  </option>
                }
              </select>
            </div>
          }

          <div class="dashboard-segmented" role="group" aria-label="Filter global timeline by audit phase">
            <button
              type="button"
              id="global-phase-all-btn"
              class="dashboard-segmented__btn"
              [class.is-active]="phaseFilter() === 'all'"
              (click)="phaseFilter.set('all')"
            >
              All
            </button>
            <button
              type="button"
              id="global-phase-static-btn"
              class="dashboard-segmented__btn"
              [class.is-active]="phaseFilter() === 'static'"
              (click)="phaseFilter.set('static')"
            >
              Static AST
            </button>
            <button
              type="button"
              id="global-phase-lhr-btn"
              class="dashboard-segmented__btn"
              [class.is-active]="phaseFilter() === 'lhr'"
              (click)="phaseFilter.set('lhr')"
            >
              LHR JSON
            </button>
          </div>

          <div class="dashboard-segmented" role="group" aria-label="Global D3 chart metric view">
            <button
              type="button"
              id="global-view-cumulative-btn"
              class="dashboard-segmented__btn"
              [class.is-active]="viewMode() === 'cumulative'"
              (click)="viewMode.set('cumulative')"
            >
              Cumulative Lift
            </button>
            <button
              type="button"
              id="global-view-average-btn"
              class="dashboard-segmented__btn"
              [class.is-active]="viewMode() === 'average'"
              (click)="viewMode.set('average')"
            >
              Fleet Avg
            </button>
          </div>

          @if (savedAudits().length > 0) {
            <button
              type="button"
              id="global-dashboard-export-json-btn"
              class="dashboard-inline-btn dashboard-inline-btn--primary"
              (click)="exportAllJson.emit()"
              title="Export the full Saved Audits history as a single consolidated JSON report for offline analysis or backup"
            >
              Export All JSON
            </button>
          }
        </div>
      </div>

      @if (timeline().length === 0) {
        <div class="dashboard-state-panel">
          <div class="dashboard-state-panel__copy">
            <p class="dashboard-state-panel__title">No audit milestones in current scope</p>
            <p class="dashboard-state-panel__desc">
              @if (savedAudits().length > 0) {
                Clear the active organization or phase filter to view cumulative repository improvements across your full history.
              } @else {
                Run repository audits or load sample saved audits to track cumulative Performance and Accessibility gains over time.
              }
            </p>
          </div>
          <div class="dashboard-state-panel__actions">
            @if (savedAudits().length > 0) {
              <button type="button" class="secondary-flow-btn dashboard-action-btn" (click)="resetFilters()">
                <span>Reset Filters</span>
              </button>
            } @else {
              <button type="button" class="secondary-flow-btn dashboard-action-btn" (click)="loadSampleAudits.emit()">
                <span>Load Sample Audits</span>
              </button>
            }
          </div>
        </div>
      } @else {
        <div class="global-dashboard__panel">
          <!-- 4-Column Tabular Cumulative KPI Row -->
          <div class="global-dashboard__kpis" role="region" aria-label="Global cumulative improvement metrics">
            <div class="global-kpi-cell">
              <span class="global-kpi-cell__label">Cumulative Performance Gain</span>
              <strong class="global-kpi-cell__value global-kpi-cell__value--perf">
                +{{ metrics().cumulativePerfLift }} pts
              </strong>
              <span class="global-kpi-cell__meta">
                Avg +{{ metrics().avgPerfLift }} pts per run
              </span>
            </div>

            <div class="global-kpi-cell">
              <span class="global-kpi-cell__label">Cumulative Accessibility Gain</span>
              <strong class="global-kpi-cell__value global-kpi-cell__value--a11y">
                +{{ metrics().cumulativeA11yLift }} pts
              </strong>
              <span class="global-kpi-cell__meta">
                Avg +{{ metrics().avgA11yLift }} pts per run
              </span>
            </div>

            <div class="global-kpi-cell">
              <span class="global-kpi-cell__label">Audited Fleet Coverage</span>
              <strong class="global-kpi-cell__value">
                {{ metrics().uniqueRepos }} {{ metrics().uniqueRepos === 1 ? 'repo' : 'repos' }}
              </strong>
              <span class="global-kpi-cell__meta">
                {{ metrics().totalRuns }} {{ metrics().totalRuns === 1 ? 'run' : 'runs' }}
                <span aria-hidden="true">·</span>
                {{ metrics().uniqueOrgs }} {{ metrics().uniqueOrgs === 1 ? 'org' : 'orgs' }}
              </span>
            </div>

            <div class="global-kpi-cell">
              <span class="global-kpi-cell__label">Fleet Avg Remediated Score</span>
              <strong class="global-kpi-cell__value">
                {{ metrics().fleetAvgPerfAfter }} / {{ metrics().fleetAvgA11yAfter }}
              </strong>
              <span class="global-kpi-cell__meta">Perf avg · A11y avg (0–100)</span>
            </div>
          </div>

          <!-- Chart Legend & Active Mode Description -->
          <div class="global-dashboard__chart-bar">
            <span class="global-dashboard__chart-caption">
              @if (viewMode() === 'cumulative') {
                Running sum of Performance &amp; Accessibility score points recovered across {{ metrics().uniqueRepos }} audited {{ metrics().uniqueRepos === 1 ? 'repository' : 'repositories' }}
              } @else {
                Rolling fleet-wide average remediated Performance &amp; Accessibility scores across all repositories (target 90+)
              }
            </span>

            <div class="global-dashboard__legend" aria-hidden="true">
              <span class="global-dashboard__legend-item">
                <span class="global-dashboard__swatch global-dashboard__swatch--perf"></span>
                <span>Performance</span>
              </span>
              <span class="global-dashboard__legend-item">
                <span class="global-dashboard__swatch global-dashboard__swatch--a11y"></span>
                <span>Accessibility</span>
              </span>
            </div>
          </div>

          <!-- D3.js Cumulative Timeline Visualization Host -->
          <div
            #globalChartHost
            id="global-audit-d3-chart"
            class="global-dashboard__chart-host"
            role="img"
            [attr.aria-label]="chartAriaLabel()"
          ></div>

          <!-- Interactive Milestone Readout Strip -->
          @if (activePoint(); as pt) {
            <div class="global-dashboard__readout" aria-live="polite">
              <div class="global-dashboard__readout-text">
                <strong>#{{ pt.index }} {{ pt.repoFullName }}</strong>
                <span aria-hidden="true">·</span>
                <span>{{ pt.fullDate }}</span>
                <span aria-hidden="true">·</span>
                <span>{{ pt.runPhase === 'lhr' ? 'LHR JSON' : 'Static AST' }}</span>
                <span aria-hidden="true">·</span>
                @if (viewMode() === 'cumulative') {
                  <span>
                    Cumulative Perf <strong>+{{ pt.cumulativePerfLift }} pts</strong> (+{{ pt.perfLift }} this run)
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Cumulative A11y <strong>+{{ pt.cumulativeA11yLift }} pts</strong> (+{{ pt.a11yLift }} this run)
                  </span>
                } @else {
                  <span>
                    Fleet Avg Perf <strong>{{ pt.rollingAvgPerfAfter }}</strong> (run: {{ pt.perfBefore }}→{{ pt.perfAfter }})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Fleet Avg A11y <strong>{{ pt.rollingAvgA11yAfter }}</strong> (run: {{ pt.a11yBefore }}→{{ pt.a11yAfter }})
                  </span>
                }
              </div>
              <button
                type="button"
                class="text-action-btn"
                (click)="openSavedAudit.emit(pt.record)"
              >
                Open Run →
              </button>
            </div>
          } @else {
            <div class="global-dashboard__readout">
              <div class="global-dashboard__readout-text">
                <span>
                  Hover or focus any milestone dot to inspect repository-level impact and running fleet totals.
                </span>
              </div>
            </div>
          }

          <!-- Per-Repository Contribution Breakdown Table -->
          @if (repoContributions().length > 0) {
            <div class="global-dashboard__contrib-wrap">
              <div class="global-dashboard__contrib-head">
                <h3 class="global-dashboard__contrib-title">Repository Cumulative Contributions</h3>
                <span class="global-dashboard__contrib-sub">
                  Ranked by total combined Performance + Accessibility points gained
                </span>
              </div>
              <div class="dashboard-table-wrap">
                <table class="dashboard-table global-dashboard__table">
                  <thead>
                    <tr>
                      <th scope="col">Repository</th>
                      <th scope="col" class="is-num">Runs</th>
                      <th scope="col" class="is-num">Perf Gain</th>
                      <th scope="col" class="is-num">A11y Gain</th>
                      <th scope="col" class="is-num">Latest Scores</th>
                      <th scope="col" class="is-num">Fleet Share</th>
                      <th scope="col" class="is-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of repoContributions(); track row.repoFullName) {
                      <tr>
                        <td>
                          <div class="dashboard-table__repo">{{ row.repoFullName }}</div>
                          <div class="dashboard-table__sub">&#64;{{ row.owner }}</div>
                        </td>
                        <td class="is-num dashboard-table__num">{{ row.runCount }}</td>
                        <td class="is-num dashboard-table__num global-table__gain-perf">
                          +{{ row.cumulativePerfLift }} pts
                        </td>
                        <td class="is-num dashboard-table__num global-table__gain-a11y">
                          +{{ row.cumulativeA11yLift }} pts
                        </td>
                        <td class="is-num dashboard-table__num">
                          {{ row.latestPerfAfter }} / {{ row.latestA11yAfter }}
                        </td>
                        <td class="is-num dashboard-table__num">{{ row.sharePercent }}%</td>
                        <td class="is-right dashboard-table__actions">
                          <button
                            type="button"
                            class="dashboard-inline-btn"
                            (click)="openSavedAudit.emit(row.latestRecord)"
                          >
                            Open Latest
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </div>
      }
    </section>
  `
})
export class GlobalAuditDashboardComponent {
  readonly savedAudits = input<(SavedAuditHistoryRecord | LocalSavedAuditRecord)[]>([]);

  readonly openSavedAudit = output<SavedAuditHistoryRecord | LocalSavedAuditRecord>();
  readonly exportAllJson = output<void>();
  readonly loadSampleAudits = output<void>();

  private readonly globalChartHost = viewChild<ElementRef<HTMLDivElement>>('globalChartHost');

  readonly ownerFilter = signal<string>('all');
  readonly phaseFilter = signal<'all' | 'static' | 'lhr'>('all');
  readonly viewMode = signal<GlobalChartViewMode>('cumulative');
  readonly activePoint = signal<GlobalCumulativePoint | null>(null);

  readonly ownerOptions = computed<SavedAuditOwnerOption[]>(() =>
    listSavedAuditOwners(this.savedAudits())
  );

  readonly timeline = computed<GlobalCumulativePoint[]>(() =>
    buildGlobalCumulativeTimeline(
      this.savedAudits(),
      this.ownerFilter(),
      this.phaseFilter()
    )
  );

  readonly metrics = computed<GlobalDashboardMetrics>(() =>
    computeGlobalDashboardMetrics(this.timeline())
  );

  readonly repoContributions = computed<GlobalRepoContribution[]>(() =>
    buildGlobalRepoContributions(
      this.savedAudits(),
      this.ownerFilter(),
      this.phaseFilter()
    )
  );

  readonly chartAriaLabel = computed<string>(() => {
    const m = this.metrics();
    if (m.totalRuns === 0) {
      return 'Global Audit Dashboard D3.js cumulative improvement chart with no data.';
    }
    if (this.viewMode() === 'cumulative') {
      return `Global Audit Dashboard D3.js chart showing cumulative improvements across ${m.uniqueRepos} repositories and ${m.totalRuns} runs: +${m.cumulativePerfLift} Performance points and +${m.cumulativeA11yLift} Accessibility points gained.`;
    }
    return `Global Audit Dashboard D3.js chart showing rolling fleet averages across ${m.uniqueRepos} repositories: Performance ${m.fleetAvgPerfAfter} and Accessibility ${m.fleetAvgA11yAfter}.`;
  });

  constructor() {
    effect(() => {
      const hostEl = this.globalChartHost()?.nativeElement;
      const pts = this.timeline();
      const mode = this.viewMode();
      if (!hostEl || typeof window === 'undefined') return;
      this.renderGlobalD3Chart(hostEl, pts, mode);
    });
  }

  onOwnerFilterChange(event: Event): void {
    const selectEl = event.target as HTMLSelectElement | null;
    this.ownerFilter.set(selectEl?.value || 'all');
    this.activePoint.set(null);
  }

  resetFilters(): void {
    this.ownerFilter.set('all');
    this.phaseFilter.set('all');
    this.activePoint.set(null);
  }

  private renderGlobalD3Chart(
    hostEl: HTMLDivElement,
    points: GlobalCumulativePoint[],
    mode: GlobalChartViewMode
  ): void {
    const container = d3.select(hostEl);
    container.selectAll('*').remove();

    if (points.length === 0) return;

    const width = 880;
    const height = 270;
    const margin = { top: 20, right: 24, bottom: 36, left: 52 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = container
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('class', 'global-d3-svg');

    const defs = svg.append('defs');

    const perfGrad = defs
      .append('linearGradient')
      .attr('id', 'global-perf-area-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    perfGrad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', 'var(--cat-perf, #2563eb)')
      .attr('stop-opacity', 0.18);
    perfGrad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', 'var(--cat-perf, #2563eb)')
      .attr('stop-opacity', 0.01);

    const a11yGrad = defs
      .append('linearGradient')
      .attr('id', 'global-a11y-area-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    a11yGrad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', 'var(--cat-a11y, #10b981)')
      .attr('stop-opacity', 0.14);
    a11yGrad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', 'var(--cat-a11y, #10b981)')
      .attr('stop-opacity', 0.01);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const getPerfY = (pt: GlobalCumulativePoint): number =>
      mode === 'cumulative' ? pt.cumulativePerfLift : pt.rollingAvgPerfAfter;
    const getA11yY = (pt: GlobalCumulativePoint): number =>
      mode === 'cumulative' ? pt.cumulativeA11yLift : pt.rollingAvgA11yAfter;

    const xScale =
      points.length === 1
        ? d3.scaleLinear().domain([0, 2]).range([0, innerW])
        : d3.scaleLinear().domain([1, points.length]).range([0, innerW]);

    const maxVal =
      mode === 'cumulative'
        ? Math.max(
            20,
            d3.max(points, (d) => Math.max(d.cumulativePerfLift, d.cumulativeA11yLift)) ?? 20
          )
        : 100;

    const yScale =
      mode === 'cumulative'
        ? d3.scaleLinear().domain([0, maxVal * 1.12]).nice(5).range([innerH, 0])
        : d3.scaleLinear().domain([0, 100]).range([innerH, 0]);

    const yTicks = mode === 'cumulative' ? yScale.ticks(5) : [0, 25, 50, 75, 90, 100];

    // Horizontal gridlines
    g.selectAll('line.global-d3-grid')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('class', 'global-d3-grid')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', (d) =>
        mode === 'average' && d === 90
          ? 'var(--cat-a11y, #10b981)'
          : 'var(--border-hairline, #e2e8f0)'
      )
      .attr('stroke-opacity', (d) => (mode === 'average' && d === 90 ? 0.5 : 1))
      .attr('stroke-dasharray', (d) =>
        d === 0 ? 'none' : mode === 'average' && d === 90 ? '4,3' : '2,3'
      );

    // Y-axis tick labels
    g.selectAll('text.global-d3-ylabel')
      .data(yTicks)
      .enter()
      .append('text')
      .attr('class', 'global-d3-axis-label')
      .attr('x', -10)
      .attr('y', (d) => yScale(d) + 3.5)
      .attr('text-anchor', 'end')
      .attr('fill', 'var(--text-muted, #64748b)')
      .attr('font-size', '10.5px')
      .attr('font-family', 'var(--font-mono, monospace)')
      .text((d) => (mode === 'cumulative' ? `+${Math.round(d)}` : String(d)));

    const getX = (pt: GlobalCumulativePoint): number =>
      points.length === 1 ? xScale(1) : xScale(pt.index);

    // Vertical hover guide line (hidden until point hover/focus)
    const guideLine = g
      .append('line')
      .attr('class', 'global-d3-guide')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', 'var(--accent-primary, #2563eb)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('opacity', 0)
      .style('pointer-events', 'none');

    if (points.length >= 2) {
      const perfArea = d3
        .area<GlobalCumulativePoint>()
        .x((d) => getX(d))
        .y0(innerH)
        .y1((d) => yScale(getPerfY(d)))
        .curve(d3.curveMonotoneX);

      const a11yArea = d3
        .area<GlobalCumulativePoint>()
        .x((d) => getX(d))
        .y0(innerH)
        .y1((d) => yScale(getA11yY(d)))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('class', 'global-d3-area global-d3-area--perf')
        .attr('fill', 'url(#global-perf-area-grad)')
        .attr('d', perfArea);

      g.append('path')
        .datum(points)
        .attr('class', 'global-d3-area global-d3-area--a11y')
        .attr('fill', 'url(#global-a11y-area-grad)')
        .attr('d', a11yArea);

      const perfLine = d3
        .line<GlobalCumulativePoint>()
        .x((d) => getX(d))
        .y((d) => yScale(getPerfY(d)))
        .curve(d3.curveMonotoneX);

      const a11yLine = d3
        .line<GlobalCumulativePoint>()
        .x((d) => getX(d))
        .y((d) => yScale(getA11yY(d)))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('class', 'global-d3-line global-d3-line--perf')
        .attr('fill', 'none')
        .attr('stroke', 'var(--cat-perf, #2563eb)')
        .attr('stroke-width', 2.5)
        .attr('stroke-linecap', 'round')
        .attr('d', perfLine);

      g.append('path')
        .datum(points)
        .attr('class', 'global-d3-line global-d3-line--a11y')
        .attr('fill', 'none')
        .attr('stroke', 'var(--cat-a11y, #10b981)')
        .attr('stroke-width', 2.5)
        .attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', '6,3')
        .attr('d', a11yLine);
    }

    // X-axis chronological milestone labels
    const maxLabels = 7;
    const labelStep = Math.max(1, Math.ceil(points.length / maxLabels));
    const labeledPoints = points.filter(
      (_, idx) => idx === 0 || idx === points.length - 1 || idx % labelStep === 0
    );

    g.selectAll('text.global-d3-xlabel')
      .data(labeledPoints)
      .enter()
      .append('text')
      .attr('class', 'global-d3-axis-label')
      .attr('x', (d) => getX(d))
      .attr('y', innerH + 22)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted, #64748b)')
      .attr('font-size', '10.5px')
      .attr('font-family', 'var(--font-mono, monospace)')
      .text((d) => `#${d.index} · ${d.shortDate}`);

    const activatePoint = (pt: GlobalCumulativePoint) => {
      this.activePoint.set(pt);
      guideLine.attr('x1', getX(pt)).attr('x2', getX(pt)).style('opacity', 0.65);
    };

    const clearPoint = () => {
      guideLine.style('opacity', 0);
    };

    // Performance milestone dots
    g.selectAll('circle.global-d3-dot-perf')
      .data(points)
      .enter()
      .append('circle')
      .attr('class', 'global-d3-dot-perf')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) =>
        mode === 'cumulative'
          ? `Run ${d.index} ${d.repoFullName}: cumulative Performance lift +${d.cumulativePerfLift} points`
          : `Run ${d.index} ${d.repoFullName}: fleet average Performance ${d.rollingAvgPerfAfter}`
      )
      .attr('cx', (d) => getX(d))
      .attr('cy', (d) => yScale(getPerfY(d)))
      .attr('r', 5)
      .attr('fill', 'var(--cat-perf, #2563eb)')
      .attr('stroke', 'var(--bg-card, #ffffff)')
      .attr('stroke-width', 1.8)
      .style('cursor', 'pointer')
      .on('mouseenter', (_ev, d) => activatePoint(d))
      .on('mouseleave', () => clearPoint())
      .on('focus', (_ev, d) => activatePoint(d))
      .on('blur', () => clearPoint())
      .on('click', (_ev, d) => activatePoint(d))
      .append('title')
      .text((d) =>
        mode === 'cumulative'
          ? `#${d.index} ${d.repoFullName} (${d.fullDate}) — Cumulative Perf: +${d.cumulativePerfLift} pts (+${d.perfLift})`
          : `#${d.index} ${d.repoFullName} (${d.fullDate}) — Fleet Avg Perf: ${d.rollingAvgPerfAfter}`
      );

    // Accessibility milestone dots
    g.selectAll('circle.global-d3-dot-a11y')
      .data(points)
      .enter()
      .append('circle')
      .attr('class', 'global-d3-dot-a11y')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) =>
        mode === 'cumulative'
          ? `Run ${d.index} ${d.repoFullName}: cumulative Accessibility lift +${d.cumulativeA11yLift} points`
          : `Run ${d.index} ${d.repoFullName}: fleet average Accessibility ${d.rollingAvgA11yAfter}`
      )
      .attr('cx', (d) => getX(d))
      .attr('cy', (d) => yScale(getA11yY(d)))
      .attr('r', 5)
      .attr('fill', 'var(--cat-a11y, #10b981)')
      .attr('stroke', 'var(--bg-card, #ffffff)')
      .attr('stroke-width', 1.8)
      .style('cursor', 'pointer')
      .on('mouseenter', (_ev, d) => activatePoint(d))
      .on('mouseleave', () => clearPoint())
      .on('focus', (_ev, d) => activatePoint(d))
      .on('blur', () => clearPoint())
      .on('click', (_ev, d) => activatePoint(d))
      .append('title')
      .text((d) =>
        mode === 'cumulative'
          ? `#${d.index} ${d.repoFullName} (${d.fullDate}) — Cumulative A11y: +${d.cumulativeA11yLift} pts (+${d.a11yLift})`
          : `#${d.index} ${d.repoFullName} (${d.fullDate}) — Fleet Avg A11y: ${d.rollingAvgA11yAfter}`
      );
  }
}
