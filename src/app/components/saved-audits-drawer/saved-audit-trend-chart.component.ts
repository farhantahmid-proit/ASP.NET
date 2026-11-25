import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  signal,
  viewChild
} from '@angular/core';
import * as d3 from 'd3';
import {
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord
} from '../../models/audit.model';

export interface RepositoryTrendPoint {
  auditId: string;
  runIndex: number;
  timestampMs: number;
  shortDate: string;
  fullDate: string;
  branch: string;
  runPhase: 'static' | 'lhr';
  performanceBefore: number;
  performanceAfter: number;
  accessibilityBefore: number;
  accessibilityAfter: number;
  perfDeltaFromPrev: number | null;
  a11yDeltaFromPrev: number | null;
}

export interface TrendRepositoryOption {
  repoFullName: string;
  runCount: number;
  latestTimestampMs: number;
}

function toTimestampMs(rec: SavedAuditHistoryRecord | LocalSavedAuditRecord): number {
  const t = new Date(rec.updatedAtIso || rec.createdAtIso || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function formatShortRunDate(ms: number, runIndex: number): string {
  if (!ms) return `Run ${runIndex}`;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return `Run ${runIndex}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullRunDate(ms: number): string {
  if (!ms) return 'Recent run';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return 'Recent run';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function listTrendRepositories(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
): TrendRepositoryOption[] {
  const byRepo = new Map<string, TrendRepositoryOption>();
  for (const rec of records) {
    const repoName = (rec.repoFullName || '').trim();
    if (!repoName) continue;
    const key = repoName.toLowerCase();
    const ts = toTimestampMs(rec);
    const existing = byRepo.get(key);
    if (!existing) {
      byRepo.set(key, {
        repoFullName: repoName,
        runCount: 1,
        latestTimestampMs: ts
      });
    } else {
      existing.runCount += 1;
      if (ts > existing.latestTimestampMs) {
        existing.latestTimestampMs = ts;
      }
    }
  }

  return Array.from(byRepo.values()).sort((a, b) => {
    if (b.runCount !== a.runCount) return b.runCount - a.runCount;
    return b.latestTimestampMs - a.latestTimestampMs;
  });
}

export function buildRepositoryTrendSeries(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[],
  repoFullName: string,
  scoreMode: 'after' | 'before' = 'after'
): RepositoryTrendPoint[] {
  const target = (repoFullName || '').trim().toLowerCase();
  if (!target) return [];

  const matched = records
    .filter((rec) => (rec.repoFullName || '').trim().toLowerCase() === target)
    .sort((a, b) => toTimestampMs(a) - toTimestampMs(b));

  return matched.map((rec, idx) => {
    const ts = toTimestampMs(rec);
    const runIndex = idx + 1;
    const performanceBefore = Math.max(0, Math.min(100, Math.round(rec.performanceBefore || 0)));
    const performanceAfter = Math.max(0, Math.min(100, Math.round(rec.performanceAfter || 0)));
    const accessibilityBefore = Math.max(0, Math.min(100, Math.round(rec.accessibilityBefore || 0)));
    const accessibilityAfter = Math.max(0, Math.min(100, Math.round(rec.accessibilityAfter || 0)));

    let perfDeltaFromPrev: number | null = null;
    let a11yDeltaFromPrev: number | null = null;
    if (idx > 0) {
      const prev = matched[idx - 1];
      const prevPerf =
        scoreMode === 'after'
          ? Math.max(0, Math.min(100, Math.round(prev.performanceAfter || 0)))
          : Math.max(0, Math.min(100, Math.round(prev.performanceBefore || 0)));
      const prevA11y =
        scoreMode === 'after'
          ? Math.max(0, Math.min(100, Math.round(prev.accessibilityAfter || 0)))
          : Math.max(0, Math.min(100, Math.round(prev.accessibilityBefore || 0)));
      perfDeltaFromPrev = (scoreMode === 'after' ? performanceAfter : performanceBefore) - prevPerf;
      a11yDeltaFromPrev = (scoreMode === 'after' ? accessibilityAfter : accessibilityBefore) - prevA11y;
    }

    return {
      auditId: rec.auditId,
      runIndex,
      timestampMs: ts,
      shortDate: formatShortRunDate(ts, runIndex),
      fullDate: formatFullRunDate(ts),
      branch: rec.branch || 'main',
      runPhase: rec.runPhase === 'lhr' ? 'lhr' : 'static',
      performanceBefore,
      performanceAfter,
      accessibilityBefore,
      accessibilityAfter,
      perfDeltaFromPrev,
      a11yDeltaFromPrev
    };
  });
}

@Component({
  selector: 'app-saved-audit-trend-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (repoOptions().length > 0) {
      <section #trendCardSection class="drawer-trend-card" aria-labelledby="drawer-trend-heading">
        <div class="drawer-trend-card__head">
          <div class="drawer-trend-card__title-wrap">
            <h3 id="drawer-trend-heading" class="drawer-trend-card__title">
              Score Fluctuation Trend
            </h3>
            <p class="drawer-trend-card__sub">
              Performance &amp; Accessibility across historical runs (D3.js)
            </p>
          </div>

          <div class="saved-audits-drawer__filters" role="group" aria-label="Trend score phase">
            <button
              type="button"
              id="drawer-trend-mode-after"
              class="saved-audits-filter-btn"
              [class.is-active]="scoreMode() === 'after'"
              (click)="scoreMode.set('after')"
            >
              After
            </button>
            <button
              type="button"
              id="drawer-trend-mode-before"
              class="saved-audits-filter-btn"
              [class.is-active]="scoreMode() === 'before'"
              (click)="scoreMode.set('before')"
            >
              Baseline
            </button>
          </div>
        </div>

        <div class="drawer-trend-card__controls">
          <label for="drawer-trend-repo-select" class="sr-only">
            Select repository to visualize historical score trend
          </label>
          <select
            id="drawer-trend-repo-select"
            class="saved-audits-sort-select drawer-trend-card__select"
            [value]="effectiveSelectedRepo()"
            (change)="onRepoSelectChange($event)"
          >
            @for (opt of repoOptions(); track opt.repoFullName) {
              <option [value]="opt.repoFullName">
                {{ opt.repoFullName }} ({{ opt.runCount }} {{ opt.runCount === 1 ? 'run' : 'runs' }})
              </option>
            }
          </select>

          <div class="drawer-trend-legend" aria-hidden="true">
            <span class="drawer-trend-legend__item">
              <span class="drawer-trend-legend__dot drawer-trend-legend__dot--perf"></span>
              <span>Perf</span>
            </span>
            <span class="drawer-trend-legend__item">
              <span class="drawer-trend-legend__dot drawer-trend-legend__dot--a11y"></span>
              <span>A11y</span>
            </span>
          </div>
        </div>

        <div
          #trendSvgHost
          id="drawer-d3-trend-chart"
          class="drawer-trend-card__chart"
          role="img"
          [attr.aria-label]="chartAriaLabel()"
        ></div>

        @if (activePoint(); as pt) {
          <div class="drawer-trend-card__readout" aria-live="polite">
            <span>
              <strong>Run {{ pt.runIndex }}</strong> ({{ pt.fullDate }} · {{ pt.branch }})
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Perf <strong>{{ scoreMode() === 'after' ? pt.performanceAfter : pt.performanceBefore }}</strong>
              @if (pt.perfDeltaFromPrev !== null) {
                <span>({{ pt.perfDeltaFromPrev >= 0 ? '+' : '' }}{{ pt.perfDeltaFromPrev }})</span>
              }
            </span>
            <span aria-hidden="true">·</span>
            <span>
              A11y <strong>{{ scoreMode() === 'after' ? pt.accessibilityAfter : pt.accessibilityBefore }}</strong>
              @if (pt.a11yDeltaFromPrev !== null) {
                <span>({{ pt.a11yDeltaFromPrev >= 0 ? '+' : '' }}{{ pt.a11yDeltaFromPrev }})</span>
              }
            </span>
          </div>
        } @else {
          @if (trendSummary(); as summary) {
            <div class="drawer-trend-card__readout">
              @if (series().length >= 2) {
                <span>
                  {{ series().length }} runs · Perf
                  <strong>{{ summary.perfStart }}→{{ summary.perfEnd }}</strong>
                  ({{ summary.perfDelta >= 0 ? '+' : '' }}{{ summary.perfDelta }})
                  · A11y
                  <strong>{{ summary.a11yStart }}→{{ summary.a11yEnd }}</strong>
                  ({{ summary.a11yDelta >= 0 ? '+' : '' }}{{ summary.a11yDelta }})
                </span>
              } @else {
                <span>
                  1 saved run for <strong>{{ effectiveSelectedRepo() }}</strong> — save another scan to view multi-run fluctuations.
                </span>
              }
            </div>
          }
        }
      </section>
    }
  `
})
export class SavedAuditTrendChartComponent {
  readonly records = input.required<(SavedAuditHistoryRecord | LocalSavedAuditRecord)[]>();
  readonly isVisible = input<boolean>(true);
  readonly focusedRepo = input<string | null>(null);

  private readonly trendSvgHost = viewChild<ElementRef<HTMLDivElement>>('trendSvgHost');
  private readonly trendCardSection = viewChild<ElementRef<HTMLElement>>('trendCardSection');

  readonly selectedRepo = signal<string>('');
  readonly scoreMode = signal<'after' | 'before'>('after');
  readonly activePoint = signal<RepositoryTrendPoint | null>(null);

  readonly repoOptions = computed<TrendRepositoryOption[]>(() =>
    listTrendRepositories(this.records())
  );

  readonly effectiveSelectedRepo = computed<string>(() => {
    const opts = this.repoOptions();
    if (opts.length === 0) return '';
    const chosen = this.selectedRepo() || this.focusedRepo() || '';
    if (chosen) {
      const matched = opts.find((o) => o.repoFullName.toLowerCase() === chosen.toLowerCase());
      if (matched) return matched.repoFullName;
    }
    return opts[0].repoFullName;
  });

  readonly series = computed<RepositoryTrendPoint[]>(() =>
    buildRepositoryTrendSeries(this.records(), this.effectiveSelectedRepo(), this.scoreMode())
  );

  readonly trendSummary = computed<{
    perfStart: number;
    perfEnd: number;
    a11yStart: number;
    a11yEnd: number;
    perfDelta: number;
    a11yDelta: number;
    perfMin: number;
    perfMax: number;
    a11yMin: number;
    a11yMax: number;
  } | null>(() => {
    const pts = this.series();
    if (pts.length === 0) return null;
    const mode = this.scoreMode();
    const perfVals = pts.map((p) => (mode === 'after' ? p.performanceAfter : p.performanceBefore));
    const a11yVals = pts.map((p) => (mode === 'after' ? p.accessibilityAfter : p.accessibilityBefore));
    return {
      perfStart: perfVals[0],
      perfEnd: perfVals[perfVals.length - 1],
      a11yStart: a11yVals[0],
      a11yEnd: a11yVals[a11yVals.length - 1],
      perfDelta: perfVals[perfVals.length - 1] - perfVals[0],
      a11yDelta: a11yVals[a11yVals.length - 1] - a11yVals[0],
      perfMin: Math.min(...perfVals),
      perfMax: Math.max(...perfVals),
      a11yMin: Math.min(...a11yVals),
      a11yMax: Math.max(...a11yVals)
    };
  });

  readonly chartAriaLabel = computed<string>(() => {
    const repo = this.effectiveSelectedRepo();
    const pts = this.series();
    if (!repo || pts.length === 0) {
      return 'Repository score trend line chart';
    }
    const modeLabel = this.scoreMode() === 'after' ? 'remediated' : 'baseline';
    const last = pts[pts.length - 1];
    const perf = this.scoreMode() === 'after' ? last.performanceAfter : last.performanceBefore;
    const a11y = this.scoreMode() === 'after' ? last.accessibilityAfter : last.accessibilityBefore;
    return `D3 trend line chart for ${repo} across ${pts.length} historical runs showing ${modeLabel} Performance (${perf}) and Accessibility (${a11y}) scores.`;
  });

  constructor() {
    effect(() => {
      const focused = this.focusedRepo();
      if (focused) {
        this.selectedRepo.set(focused);
        this.activePoint.set(null);
      }
    });

    effect(() => {
      const hostRef = this.trendSvgHost();
      const pts = this.series();
      const mode = this.scoreMode();
      const visible = this.isVisible();
      if (!hostRef || !visible) return;
      this.renderD3TrendChart(hostRef.nativeElement, pts, mode);
    });
  }

  onRepoSelectChange(event: Event): void {
    const selectEl = event.target as HTMLSelectElement | null;
    this.selectedRepo.set(selectEl?.value ?? '');
    this.activePoint.set(null);
  }

  focusRepository(repoFullName: string): void {
    if (!repoFullName) return;
    this.selectedRepo.set(repoFullName);
    this.activePoint.set(null);
    const el = this.trendCardSection()?.nativeElement;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  private renderD3TrendChart(
    host: HTMLDivElement,
    points: RepositoryTrendPoint[],
    mode: 'after' | 'before'
  ): void {
    const container = d3.select(host);
    container.selectAll('*').remove();

    if (points.length === 0) return;

    const width = 392;
    const height = 166;
    const margin = { top: 14, right: 16, bottom: 26, left: 32 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = container
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', height)
      .attr('class', 'drawer-trend-svg');

    const defs = svg.append('defs');
    const perfGrad = defs
      .append('linearGradient')
      .attr('id', 'drawer-perf-area-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    perfGrad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', 'var(--cat-perf, #2563eb)')
      .attr('stop-opacity', 0.16);
    perfGrad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', 'var(--cat-perf, #2563eb)')
      .attr('stop-opacity', 0);

    const a11yGrad = defs
      .append('linearGradient')
      .attr('id', 'drawer-a11y-area-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    a11yGrad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', 'var(--cat-a11y, #10b981)')
      .attr('stop-opacity', 0.12);
    a11yGrad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', 'var(--cat-a11y, #10b981)')
      .attr('stop-opacity', 0);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale =
      points.length === 1
        ? d3.scaleLinear().domain([0, 2]).range([0, innerW])
        : d3.scaleLinear().domain([1, points.length]).range([0, innerW]);

    const yScale = d3.scaleLinear().domain([0, 100]).range([innerH, 0]);

    // Horizontal reference gridlines at 0, 25, 50, 75, 100
    const yTicks = [0, 25, 50, 75, 100];
    g.selectAll('.drawer-trend-grid')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('class', 'drawer-trend-grid')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', 'var(--border-hairline, #e2e8f0)')
      .attr('stroke-dasharray', (d) => (d === 0 ? 'none' : '2,3'));

    // Y-axis score labels
    g.selectAll('.drawer-trend-ylabel')
      .data([0, 50, 100])
      .enter()
      .append('text')
      .attr('class', 'drawer-trend-axis-label')
      .attr('x', -6)
      .attr('y', (d) => yScale(d) + 3)
      .attr('text-anchor', 'end')
      .attr('fill', 'var(--text-muted, #64748b)')
      .attr('font-size', '10px')
      .attr('font-family', 'var(--font-mono, monospace)')
      .text((d) => String(d));

    const getX = (pt: RepositoryTrendPoint): number =>
      points.length === 1 ? xScale(1) : xScale(pt.runIndex);
    const getPerf = (pt: RepositoryTrendPoint): number =>
      mode === 'after' ? pt.performanceAfter : pt.performanceBefore;
    const getA11y = (pt: RepositoryTrendPoint): number =>
      mode === 'after' ? pt.accessibilityAfter : pt.accessibilityBefore;

    // Draw subtle area + connecting lines when 2+ runs exist
    if (points.length >= 2) {
      const perfArea = d3
        .area<RepositoryTrendPoint>()
        .x((d) => getX(d))
        .y0(innerH)
        .y1((d) => yScale(getPerf(d)))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('class', 'drawer-trend-area drawer-trend-area--perf')
        .attr('fill', 'url(#drawer-perf-area-grad)')
        .attr('d', perfArea);

      const perfLine = d3
        .line<RepositoryTrendPoint>()
        .x((d) => getX(d))
        .y((d) => yScale(getPerf(d)))
        .curve(d3.curveMonotoneX);

      const a11yLine = d3
        .line<RepositoryTrendPoint>()
        .x((d) => getX(d))
        .y((d) => yScale(getA11y(d)))
        .curve(d3.curveMonotoneX);

      const a11yArea = d3
        .area<RepositoryTrendPoint>()
        .x((d) => getX(d))
        .y0(innerH)
        .y1((d) => yScale(getA11y(d)))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('class', 'drawer-trend-area drawer-trend-area--a11y')
        .attr('fill', 'url(#drawer-a11y-area-grad)')
        .attr('d', a11yArea);

      g.append('path')
        .datum(points)
        .attr('class', 'drawer-trend-line drawer-trend-line--perf')
        .attr('fill', 'none')
        .attr('stroke', 'var(--cat-perf, #2563eb)')
        .attr('stroke-width', 2.25)
        .attr('stroke-linecap', 'round')
        .attr('d', perfLine);

      g.append('path')
        .datum(points)
        .attr('class', 'drawer-trend-line drawer-trend-line--a11y')
        .attr('fill', 'none')
        .attr('stroke', 'var(--cat-a11y, #10b981)')
        .attr('stroke-width', 2.25)
        .attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', '5,3')
        .attr('d', a11yLine);

      // Value labels on first and latest runs to highlight improvement history
      const endpointPoints = [points[0], points[points.length - 1]];
      g.selectAll('.drawer-trend-score-perf')
        .data(endpointPoints)
        .enter()
        .append('text')
        .attr('class', 'drawer-trend-score-label')
        .attr('x', (d) => getX(d))
        .attr('y', (d) => Math.max(10, yScale(getPerf(d)) - 8))
        .attr('text-anchor', (_d, i) => (i === 0 ? 'start' : 'end'))
        .attr('fill', 'var(--cat-perf, #2563eb)')
        .attr('font-size', '9.5px')
        .attr('font-weight', '600')
        .attr('font-family', 'var(--font-mono, monospace)')
        .text((d) => `${getPerf(d)}`);

      g.selectAll('.drawer-trend-score-a11y')
        .data(endpointPoints)
        .enter()
        .append('text')
        .attr('class', 'drawer-trend-score-label')
        .attr('x', (d) => getX(d))
        .attr('y', (d) => Math.min(innerH - 4, yScale(getA11y(d)) + 15))
        .attr('text-anchor', (_d, i) => (i === 0 ? 'start' : 'end'))
        .attr('fill', 'var(--cat-a11y, #10b981)')
        .attr('font-size', '9.5px')
        .attr('font-weight', '600')
        .attr('font-family', 'var(--font-mono, monospace)')
        .text((d) => `${getA11y(d)}`);
    }

    // X-axis run labels (avoid crowding if many runs)
    const maxLabels = 5;
    const labelStep = Math.max(1, Math.ceil(points.length / maxLabels));
    const labeledPoints = points.filter(
      (_, idx) => idx === 0 || idx === points.length - 1 || idx % labelStep === 0
    );

    g.selectAll('.drawer-trend-xlabel')
      .data(labeledPoints)
      .enter()
      .append('text')
      .attr('class', 'drawer-trend-axis-label')
      .attr('x', (d) => getX(d))
      .attr('y', innerH + 17)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted, #64748b)')
      .attr('font-size', '10px')
      .attr('font-family', 'var(--font-mono, monospace)')
      .text((d) => `R${d.runIndex} · ${d.shortDate}`);

    const crosshair = g
      .append('line')
      .attr('class', 'drawer-trend-crosshair')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', 'var(--text-muted, #64748b)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('opacity', 0)
      .style('pointer-events', 'none');

    const highlightPoint = (pt: RepositoryTrendPoint | null): void => {
      this.activePoint.set(pt);
      if (!pt) {
        crosshair.style('opacity', 0);
        return;
      }
      const cx = getX(pt);
      crosshair.attr('x1', cx).attr('x2', cx).style('opacity', 0.65);
    };

    // Performance data dots (hover + keyboard focusable)
    g.selectAll('.drawer-trend-dot-perf')
      .data(points)
      .enter()
      .append('circle')
      .attr('class', 'drawer-trend-dot-perf')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) => `Run ${d.runIndex} Performance score ${getPerf(d)}`)
      .attr('cx', (d) => getX(d))
      .attr('cy', (d) => yScale(getPerf(d)))
      .attr('r', 4.5)
      .attr('fill', 'var(--cat-perf, #2563eb)')
      .attr('stroke', 'var(--bg-card, #ffffff)')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseenter', (_ev, d) => highlightPoint(d))
      .on('mouseleave', () => highlightPoint(null))
      .on('focus', (_ev, d) => highlightPoint(d))
      .on('blur', () => highlightPoint(null))
      .append('title')
      .text((d) => `Run ${d.runIndex} (${d.fullDate}) — Performance: ${getPerf(d)}`);

    // Accessibility data dots (hover + keyboard focusable)
    g.selectAll('.drawer-trend-dot-a11y')
      .data(points)
      .enter()
      .append('circle')
      .attr('class', 'drawer-trend-dot-a11y')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) => `Run ${d.runIndex} Accessibility score ${getA11y(d)}`)
      .attr('cx', (d) => getX(d))
      .attr('cy', (d) => yScale(getA11y(d)))
      .attr('r', 4.5)
      .attr('fill', 'var(--cat-a11y, #10b981)')
      .attr('stroke', 'var(--bg-card, #ffffff)')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseenter', (_ev, d) => highlightPoint(d))
      .on('mouseleave', () => highlightPoint(null))
      .on('focus', (_ev, d) => highlightPoint(d))
      .on('blur', () => highlightPoint(null))
      .append('title')
      .text((d) => `Run ${d.runIndex} (${d.fullDate}) — Accessibility: ${getA11y(d)}`);
  }
}
