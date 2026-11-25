import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import * as d3 from 'd3';
import * as React from 'react';
import { Root, createRoot } from 'react-dom/client';
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Tooltip,
} from 'recharts';
import {
  AuditImpactMetrics,
  RadarMetricAxis,
  SavedAuditHistoryRecord,
} from '../../models/audit.model';

interface RechartsRadarDatum {
  id: string;
  metric: string;
  fullLabel: string;
  before: number;
  after: number;
  delta: number;
  session1?: number;
  session2?: number;
  session3?: number;
  runAAfter?: number;
  runBAfter?: number;
  runAGain?: number;
  runBGain?: number;
  fullMark: number;
}

export interface HistoryTrajectorySession {
  id: string;
  slotKey: 'session1' | 'session2' | 'session3';
  title: string;
  sourceBadge: string;
  isFirestoreBacked: boolean;
  timestampLabel: string;
  commitsLabel: string;
  performanceScore: number;
  accessibilityScore: number;
  lcpScore: number;
  clsScore: number;
  fidScore: number;
  wcagAriaScore: number;
}

export interface HistoryTrajectoryAxisRow {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  s1: number;
  s2: number;
  s3: number;
  totalGain: number;
}

export type TrendDateRange = 30 | 60 | 90 | 'all';
export type TrendMetricFilter =
  | 'all-cwv'
  | 'performance'
  | 'accessibility'
  | 'seo'
  | 'best-practices';

export interface FiveAuditTrendPoint {
  auditIndex: number;
  id: string;
  shortLabel: string;
  title: string;
  sourceBadge: string;
  isFirestoreBacked: boolean;
  timestampIso: string;
  timestampLabel: string;
  daysAgo: number;
  commitsLabel: string;
  performanceScore: number;
  accessibilityScore: number;
  seoScore: number;
  bestPracticesScore: number;
  lcpScore: number;
  lcpSeconds: number;
  clsScore: number;
  clsValue: number;
  fidScore: number;
  inpMs: number;
}

export interface RadarComparableRunOption {
  id: string;
  title: string;
  sourceBadge: string;
  repoFullName: string;
  timestampLabel: string;
  commitsLabel: string;
  performanceBefore: number;
  performanceAfter: number;
  accessibilityBefore: number;
  accessibilityAfter: number;
  lcpBefore: number;
  lcpAfter: number;
  clsBefore: number;
  clsAfter: number;
  fidBefore: number;
  fidAfter: number;
  wcagBefore: number;
  wcagAfter: number;
}

export interface RadarCompareAxisRow {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  baseline: number;
  runABefore: number;
  runAAfter: number;
  runAGain: number;
  runBBefore: number;
  runBAfter: number;
  runBGain: number;
  afterDelta: number;
  gainDelta: number;
}

@Component({
  selector: 'app-impact-radar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="radar-impact-card"
      [class.is-entering]="isEntering()"
      aria-labelledby="radar-impact-heading"
    >
      <div class="radar-impact-card__header">
        <div>
          <div class="radar-impact-card__eyebrow">
            <span class="soft-pill soft-pill--accent">
              @if (viewMode() === 'history') {
                {{
                  isTrendAnalysisEnabled()
                    ? trendScope() === 'all-sessions'
                      ? 'D3 Historical Line Chart (All Saved Firestore Sessions)'
                      : 'D3 Core Web Vitals Trend Analysis (Last 5 Audits)'
                    : 'Firestore performance trajectory'
                }}
              } @else if (viewMode() === 'compare') {
                Side-by-side radar run comparison
              } @else {
                Recharts impact radar
              }
            </span>
            @if (viewMode() === 'history') {
              <span class="radar-selected-pill">
                @if (isTrendAnalysisEnabled()) {
                  {{ activeTrendPoints().length }} timeline sessions ({{ savedAudits().length }} in Firestore) · LCP {{ firstTrendPoint().lcpSeconds }}s→{{ latestTrendPoint().lcpSeconds }}s · CLS {{ firstTrendPoint().clsValue }}→{{ latestTrendPoint().clsValue }} · FID {{ firstTrendPoint().inpMs }}ms→{{ latestTrendPoint().inpMs }}ms
                } @else {
                  {{ repoFirestoreSessions().length }} Firestore
                  {{ repoFirestoreSessions().length === 1 ? 'snapshot' : 'snapshots' }} ·
                  {{ historySessions().length }} trajectory stages
                }
              </span>
            } @else if (viewMode() === 'compare') {
              <span class="radar-selected-pill">
                {{ comparableRunOptions().length }} history runs available
              </span>
            } @else {
              <span class="radar-selected-pill">
                {{ selectedCount() }} of {{ totalCount() }} commits active
              </span>
            }
          </div>
          <h2 id="radar-impact-heading" class="radar-impact-card__title">
            @if (viewMode() === 'history') {
              @if (isTrendAnalysisEnabled()) {
                D3 Trend Analysis: {{ activeTrendMetricMeta().label }} ({{ trendDateRangeLabel() }} · {{ activeTrendPoints().length }} sessions)
              } @else {
                Multi-session performance &amp; accessibility trajectory ({{ repoFullName() }})
              }
            } @else if (viewMode() === 'compare') {
              Side-by-side audit run comparison on Recharts radar ({{ selectedCompareRunA().title }} vs. {{ selectedCompareRunB().title }})
            } @else {
              Before vs. after commit impact (LCP, CLS, FID &amp; Accessibility)
            }
          </h2>
          <p class="radar-impact-card__subtitle">
            @if (viewMode() === 'history') {
              @if (isTrendAnalysisEnabled()) {
                D3 line chart plotting {{ activeTrendMetricMeta().label }} across saved Firestore audit sessions filtered by date range ({{ trendDateRangeLabel() }}) for {{ repoFullName() }}.
              } @else {
                Visualizes how {{ repoFullName() }} evolved across past Firestore audit sessions—from initial baseline inspection through saved historical runs to your current active session.
              }
            } @else if (viewMode() === 'compare') {
              Select any two audit runs from your history below to overlay and compare their performance and accessibility improvements side-by-side on the Recharts radar chart.
            } @else {
              Dynamic Recharts radar chart visualizing baseline repository metrics against the projected gains from your selected atomic code commits. Toggle any commit below to update the radar projection in real time.
            }
          </p>
        </div>

        <div class="radar-mode-tabs" role="tablist" aria-label="Radar chart dimension mode">
          <button
            type="button"
            class="radar-mode-tab"
            [class.is-active]="viewMode() === 'detailed'"
            role="tab"
            [attr.aria-selected]="viewMode() === 'detailed'"
            (click)="setViewMode('detailed')"
          >
            LCP, CLS, FID &amp; Accessibility (6 axes)
          </button>
          <button
            type="button"
            class="radar-mode-tab"
            [class.is-active]="viewMode() === 'categories'"
            role="tab"
            [attr.aria-selected]="viewMode() === 'categories'"
            (click)="setViewMode('categories')"
          >
            All Categories ({{ metrics().categoryAxes.length }} axes)
          </button>
          <button
            type="button"
            id="radar-history-tab"
            class="radar-mode-tab radar-mode-tab--history"
            [class.is-active]="viewMode() === 'history'"
            role="tab"
            [attr.aria-selected]="viewMode() === 'history'"
            (click)="setViewMode('history')"
          >
            <span>History ({{ allSavedSessionsTrendPoints().length }} sessions)</span>
          </button>
          <button
            type="button"
            id="radar-compare-runs-toggle-btn"
            class="radar-mode-tab radar-mode-tab--compare"
            [class.is-active]="viewMode() === 'compare' || isCompareDrawerOpen()"
            role="tab"
            [attr.aria-selected]="viewMode() === 'compare'"
            [attr.aria-expanded]="isCompareDrawerOpen()"
            aria-controls="radar-expandable-compare-drawer"
            (click)="toggleCompareDrawer()"
          >
            <span>{{ isCompareDrawerOpen() ? 'Hide comparison' : 'Compare 2 runs' }}</span>
          </button>
        </div>
      </div>

      <!-- History Tab Action Bar: Trend Analysis (D3) Toggle, Firestore Timeline Scope & Auto-Compare Trigger -->
      @if (viewMode() === 'history') {
        <div class="history-trend-toolbar" role="toolbar" aria-label="History visualization controls">
          <div class="history-trend-toolbar__left">
            <span class="history-trend-toolbar__label">History view mode:</span>
            <div class="history-trend-segmented" role="group" aria-label="Toggle between Radar Trajectory and D3 Trend Analysis">
              <button
                type="button"
                class="history-trend-seg-btn"
                [class.is-active]="!isTrendAnalysisEnabled()"
                [attr.aria-pressed]="!isTrendAnalysisEnabled()"
                (click)="setTrendAnalysis(false)"
              >
                <span>Recharts Radar Trajectory</span>
              </button>
              <button
                type="button"
                id="history-trend-analysis-toggle"
                class="history-trend-seg-btn history-trend-seg-btn--d3"
                [class.is-active]="isTrendAnalysisEnabled()"
                [attr.aria-pressed]="isTrendAnalysisEnabled()"
                (click)="toggleTrendAnalysis()"
              >
                <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path d="M2.5 13.5l4-4.2 3.2 2.4 5.8-6.7" stroke-linecap="round" stroke-linejoin="round" />
                  <circle cx="2.5" cy="13.5" r="1.4" fill="currentColor" />
                  <circle cx="6.5" cy="9.3" r="1.4" fill="currentColor" />
                  <circle cx="9.7" cy="11.7" r="1.4" fill="currentColor" />
                  <circle cx="15.5" cy="5" r="1.4" fill="currentColor" />
                </svg>
                <span>Trend Analysis (D3 Line Chart)</span>
              </button>
            </div>

            @if (isTrendAnalysisEnabled()) {
              <div class="history-trend-segmented" role="group" aria-label="D3 Firestore timeline scope">
                <button
                  type="button"
                  id="d3-trend-scope-all-btn"
                  class="history-trend-seg-btn"
                  [class.is-active]="trendScope() === 'all-sessions'"
                  [attr.aria-pressed]="trendScope() === 'all-sessions'"
                  (click)="setTrendScope('all-sessions')"
                >
                  <span>All Saved Sessions ({{ allSavedSessionsTrendPoints().length }})</span>
                </button>
                <button
                  type="button"
                  id="d3-trend-scope-last5-btn"
                  class="history-trend-seg-btn"
                  [class.is-active]="trendScope() === 'last-5'"
                  [attr.aria-pressed]="trendScope() === 'last-5'"
                  (click)="setTrendScope('last-5')"
                >
                  <span>Last 5 Audits</span>
                </button>
              </div>
            }
          </div>

          <div class="history-trend-toolbar__right">
            @if (isAuthenticated()) {
              <button
                type="button"
                class="radar-history-sync-btn"
                [disabled]="isLoadingHistory()"
                (click)="onRefreshHistory()"
                title="Fetch latest saved audit timeline data from Firestore"
              >
                <span>{{ isLoadingHistory() ? 'Syncing Firestore...' : '↻ Sync Firestore timeline' }}</span>
              </button>
            }
            <button
              type="button"
              id="history-tab-auto-compare-btn"
              class="export-pill-btn export-pill-btn--primary"
              (click)="onTriggerAutoCompare()"
              title="Automatically identify the initial scan and latest optimized version and open them in the side-by-side comparison panel"
            >
              <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
                <path d="M3 9h12M11.5 5.5L15 9l-3.5 3.5M6.5 12.5L3 9l3.5-3.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span>Auto-Compare (Initial vs. Latest)</span>
            </button>
          </div>
        </div>

        @if (isTrendAnalysisEnabled()) {
          <div class="d3-trend-filter-bar" role="region" aria-label="Trend Analysis date-range and metric trajectory filters">
            <div class="d3-trend-filter-group">
              <span class="d3-trend-filter-label">Date range:</span>
              <div id="d3-trend-date-range-group" class="history-trend-segmented" role="group" aria-label="Filter Trend Analysis chart by date range">
                <button
                  type="button"
                  id="d3-date-range-30d"
                  class="history-trend-seg-btn"
                  [class.is-active]="trendDateRange() === 30"
                  [attr.aria-pressed]="trendDateRange() === 30"
                  (click)="setTrendDateRange(30)"
                >
                  <span>Last 30 days</span>
                </button>
                <button
                  type="button"
                  id="d3-date-range-60d"
                  class="history-trend-seg-btn"
                  [class.is-active]="trendDateRange() === 60"
                  [attr.aria-pressed]="trendDateRange() === 60"
                  (click)="setTrendDateRange(60)"
                >
                  <span>Last 60 days</span>
                </button>
                <button
                  type="button"
                  id="d3-date-range-90d"
                  class="history-trend-seg-btn"
                  [class.is-active]="trendDateRange() === 90"
                  [attr.aria-pressed]="trendDateRange() === 90"
                  (click)="setTrendDateRange(90)"
                >
                  <span>Last 90 days</span>
                </button>
                <button
                  type="button"
                  id="d3-date-range-all"
                  class="history-trend-seg-btn"
                  [class.is-active]="trendDateRange() === 'all'"
                  [attr.aria-pressed]="trendDateRange() === 'all'"
                  (click)="setTrendDateRange('all')"
                >
                  <span>All time</span>
                </button>
              </div>
            </div>

            <div class="d3-trend-filter-group">
              <label class="d3-trend-filter-label" for="d3-trend-metric-select">Metric trajectory:</label>
              <select
                id="d3-trend-metric-select"
                class="d3-trend-metric-select"
                [value]="trendMetricFilter()"
                (change)="onSelectTrendMetric($event)"
                aria-label="Select performance metric trajectory to display on Trend Analysis chart"
              >
                <option value="all-cwv" [selected]="trendMetricFilter() === 'all-cwv'">
                  Core Web Vitals (LCP, CLS, FID &amp; Perf)
                </option>
                <option value="performance" [selected]="trendMetricFilter() === 'performance'">
                  Performance Score Trajectory
                </option>
                <option value="accessibility" [selected]="trendMetricFilter() === 'accessibility'">
                  Accessibility Score Trajectory
                </option>
                <option value="seo" [selected]="trendMetricFilter() === 'seo'">
                  SEO Score Trajectory
                </option>
                <option value="best-practices" [selected]="trendMetricFilter() === 'best-practices'">
                  Best Practices Score Trajectory
                </option>
              </select>
            </div>

            <span class="d3-trend-filter-summary">
              {{ trendDateRangeLabel() }} · {{ activeTrendPoints().length }} {{ activeTrendPoints().length === 1 ? 'session' : 'sessions' }} · {{ activeTrendMetricMeta().shortLabel }} {{ activeTrendMetricMeta().firstVal }}→{{ activeTrendMetricMeta().latestVal }} ({{ activeTrendMetricMeta().delta >= 0 ? '+' : '' }}{{ activeTrendMetricMeta().delta }} pts)
            </span>
          </div>
        }
      }

      <!-- Expandable Two-Run Comparison Selector Bar inside the Radar Chart Card -->
      @if (isCompareDrawerOpen() || viewMode() === 'compare') {
        <div
          id="radar-expandable-compare-drawer"
          class="radar-compare-drawer"
          role="region"
          aria-label="Select two audit runs from history to compare on the radar chart"
        >
          <div class="radar-compare-drawer__head">
            <div class="radar-compare-drawer__title-wrap">
              <span class="soft-pill soft-pill--accent">Expandable radar comparison</span>
              <span class="radar-compare-drawer__hint">
                Pick any two saved Firestore or session audit runs to compare their performance &amp; accessibility improvements side-by-side on the radar chart.
              </span>
            </div>
            <div class="radar-compare-drawer__actions">
              <button
                type="button"
                class="export-pill-btn export-pill-btn--primary"
                (click)="autoSelectSignificantPairInRadar()"
                title="Auto-select initial scan and latest optimized audit run"
              >
                <span>⚡ Auto-Compare significant runs</span>
              </button>
              <button
                type="button"
                id="radar-swap-compare-runs-btn"
                class="export-pill-btn export-pill-btn--ghost"
                (click)="swapCompareRuns()"
              >
                <span>⇄ Swap Run A / Run B</span>
              </button>
              @if (isAuthenticated()) {
                <button
                  type="button"
                  class="radar-history-sync-btn"
                  [disabled]="isLoadingHistory()"
                  (click)="onRefreshHistory()"
                >
                  <span>{{ isLoadingHistory() ? 'Syncing...' : 'Sync Firestore runs' }}</span>
                </button>
              }
            </div>
          </div>

          <div class="radar-compare-selectors">
            <div class="radar-compare-select-card radar-compare-select-card--a">
              <div class="radar-compare-select-card__top">
                <span class="run-slot-badge run-slot-badge--a">Audit Run A (Initial / Baseline)</span>
                <span class="run-source-tag">{{ selectedCompareRunA().sourceBadge }}</span>
              </div>
              <label class="sr-only" for="radar-compare-select-a">Select first audit run for radar comparison</label>
              <select
                id="radar-compare-select-a"
                class="run-select-input"
                [value]="selectedCompareRunA().id"
                (change)="onSelectCompareRunA($event)"
              >
                @for (opt of comparableRunOptions(); track opt.id) {
                  <option [value]="opt.id" [selected]="opt.id === selectedCompareRunA().id">
                    {{ opt.title }} — Perf {{ opt.performanceBefore }}→{{ opt.performanceAfter }} · A11y {{ opt.accessibilityBefore }}→{{ opt.accessibilityAfter }}
                  </option>
                }
              </select>
              <div class="radar-compare-select-card__meta">
                <span>Perf <strong>{{ selectedCompareRunA().performanceBefore }}→{{ selectedCompareRunA().performanceAfter }}</strong> (+{{ selectedCompareRunA().performanceAfter - selectedCompareRunA().performanceBefore }})</span>
                <span>·</span>
                <span>A11y <strong>{{ selectedCompareRunA().accessibilityBefore }}→{{ selectedCompareRunA().accessibilityAfter }}</strong> (+{{ selectedCompareRunA().accessibilityAfter - selectedCompareRunA().accessibilityBefore }})</span>
                <span>·</span>
                <span>{{ selectedCompareRunA().commitsLabel }}</span>
              </div>
            </div>

            <div class="radar-compare-select-card radar-compare-select-card--b">
              <div class="radar-compare-select-card__top">
                <span class="run-slot-badge run-slot-badge--b">Audit Run B (Latest Optimized)</span>
                <span class="run-source-tag run-source-tag--accent">{{ selectedCompareRunB().sourceBadge }}</span>
              </div>
              <label class="sr-only" for="radar-compare-select-b">Select second audit run for radar comparison</label>
              <select
                id="radar-compare-select-b"
                class="run-select-input"
                [value]="selectedCompareRunB().id"
                (change)="onSelectCompareRunB($event)"
              >
                @for (opt of comparableRunOptions(); track opt.id) {
                  <option [value]="opt.id" [selected]="opt.id === selectedCompareRunB().id">
                    {{ opt.title }} — Perf {{ opt.performanceBefore }}→{{ opt.performanceAfter }} · A11y {{ opt.accessibilityBefore }}→{{ opt.accessibilityAfter }}
                  </option>
                }
              </select>
              <div class="radar-compare-select-card__meta">
                <span>Perf <strong>{{ selectedCompareRunB().performanceBefore }}→{{ selectedCompareRunB().performanceAfter }}</strong> (+{{ selectedCompareRunB().performanceAfter - selectedCompareRunB().performanceBefore }})</span>
                <span>·</span>
                <span>A11y <strong>{{ selectedCompareRunB().accessibilityBefore }}→{{ selectedCompareRunB().accessibilityAfter }}</strong> (+{{ selectedCompareRunB().accessibilityAfter - selectedCompareRunB().accessibilityBefore }})</span>
                <span>·</span>
                <span>{{ selectedCompareRunB().commitsLabel }}</span>
              </div>
            </div>
          </div>
        </div>
      }

      <div class="radar-impact-card__grid">
        <!-- Left Canvas: Recharts SVG Radar OR D3 5-Audit Trend Analysis Line Chart -->
        <div class="radar-canvas-shell" [class.is-entering]="isEntering()">
          @if (viewMode() === 'history') {
            <div class="radar-legend" aria-label="Historical radar trajectory legend">
              @for (s of historySessions(); track s.id) {
                <span class="radar-legend__item">
                  <span
                    class="radar-legend__swatch"
                    [class.radar-legend__swatch--s1]="s.slotKey === 'session1'"
                    [class.radar-legend__swatch--s2]="s.slotKey === 'session2'"
                    [class.radar-legend__swatch--s3]="s.slotKey === 'session3'"
                    aria-hidden="true"
                  ></span>
                  <span>{{ s.title }} ({{ s.performanceScore }} Perf)</span>
                </span>
              }
            </div>
          } @else if (viewMode() === 'compare') {
            <div class="radar-legend" aria-label="Side-by-side audit run radar comparison legend">
              <span class="radar-legend__item">
                <span class="radar-legend__swatch radar-legend__swatch--s1" aria-hidden="true"></span>
                <span>Baseline</span>
              </span>
              <span class="radar-legend__item">
                <span class="radar-legend__swatch radar-legend__swatch--s2" aria-hidden="true"></span>
                <span>Run A: {{ selectedCompareRunA().title }} ({{ selectedCompareRunA().performanceAfter }} Perf)</span>
              </span>
              <span class="radar-legend__item">
                <span class="radar-legend__swatch radar-legend__swatch--s3" aria-hidden="true"></span>
                <span>Run B: {{ selectedCompareRunB().title }} ({{ selectedCompareRunB().performanceAfter }} Perf)</span>
              </span>
            </div>
          } @else {
            <div class="radar-legend" aria-label="Radar chart legend">
              <span class="radar-legend__item">
                <span class="radar-legend__swatch radar-legend__swatch--before" aria-hidden="true"></span>
                <span>Before (baseline)</span>
              </span>
              <span class="radar-legend__item">
                <span class="radar-legend__swatch radar-legend__swatch--after" aria-hidden="true"></span>
                <span>After ({{ selectedCount() }} selected commits)</span>
              </span>
            </div>
          }

          <!-- Recharts Radar Host (Always rendered for Detailed, Categories, Compare, AND Multi-Session History Trajectory) -->
          <div
            #radarContainer
            class="radar-svg-host recharts-host-container"
            [class.is-animating-entrance]="isEntering()"
            role="img"
            [attr.aria-label]="
              viewMode() === 'history'
                ? 'Recharts radar chart visualizing multi-session performance trajectory for ' + repoFullName()
                : viewMode() === 'compare'
                  ? 'Recharts radar chart comparing ' + selectedCompareRunA().title + ' and ' + selectedCompareRunB().title
                  : 'Recharts radar chart comparing before and after performance and accessibility metrics'
            "
          ></div>

          @if (viewMode() === 'history' && isTrendAnalysisEnabled()) {
            <!-- Dynamic D3 Trend Analysis Legend based on selected Metric Dropdown -->
            <div class="radar-legend d3-trend-legend" style="margin-top: 0.75rem;" aria-label="D3 Trend Analysis active metric legend">
              @if (trendMetricFilter() === 'all-cwv') {
                <span class="radar-legend__item">
                  <span class="d3-legend-line d3-legend-line--lcp" aria-hidden="true"></span>
                  <span>LCP ({{ firstTrendPoint().lcpSeconds }}s → {{ latestTrendPoint().lcpSeconds }}s)</span>
                </span>
                <span class="radar-legend__item">
                  <span class="d3-legend-line d3-legend-line--cls" aria-hidden="true"></span>
                  <span>CLS ({{ firstTrendPoint().clsValue }} → {{ latestTrendPoint().clsValue }})</span>
                </span>
                <span class="radar-legend__item">
                  <span class="d3-legend-line d3-legend-line--fid" aria-hidden="true"></span>
                  <span>FID ({{ firstTrendPoint().inpMs }}ms → {{ latestTrendPoint().inpMs }}ms)</span>
                </span>
                <span class="radar-legend__item">
                  <span class="d3-legend-line d3-legend-line--perf" aria-hidden="true"></span>
                  <span>Overall Perf ({{ firstTrendPoint().performanceScore }} → {{ latestTrendPoint().performanceScore }})</span>
                </span>
              } @else {
                <span class="radar-legend__item">
                  <span
                    class="d3-legend-line"
                    [style.background]="activeTrendMetricMeta().color"
                    aria-hidden="true"
                  ></span>
                  <span>
                    {{ activeTrendMetricMeta().label }} ({{ activeTrendMetricMeta().firstVal }} → {{ activeTrendMetricMeta().latestVal }}, {{ activeTrendMetricMeta().delta >= 0 ? '+' : '' }}{{ activeTrendMetricMeta().delta }} pts)
                  </span>
                </span>
                <span class="radar-legend__item">
                  <span class="d3-legend-line d3-legend-line--perf" aria-hidden="true"></span>
                  <span>Window: {{ trendDateRangeLabel() }}</span>
                </span>
              }
            </div>
          }

          <!-- D3 Historical Trend Analysis Line Chart SVG Host (shown when Trend Analysis is toggled ON in History tab) -->
          <div
            #d3TrendContainer
            id="d3-history-trend-chart"
            class="d3-trend-svg-host"
            [style.display]="viewMode() === 'history' && isTrendAnalysisEnabled() ? 'flex' : 'none'"
            role="img"
            [attr.aria-label]="
              'D3 line chart plotting ' + activeTrendMetricMeta().label + ' across ' + activeTrendPoints().length + ' sessions (' + trendDateRangeLabel() + ') for ' + repoFullName()
            "
          ></div>

          @if (viewMode() === 'history' && isTrendAnalysisEnabled()) {
            @let activeAudit = focusedTrendPoint();
            <div class="radar-axis-spotlight d3-trend-spotlight" aria-live="polite">
              <div class="radar-axis-spotlight__top">
                <strong>{{ activeAudit.shortLabel }} · {{ activeAudit.title }}</strong>
                <span class="radar-axis-spotlight__scores">
                  <span class="score-mid">Perf: {{ activeAudit.performanceScore }}</span>
                  <span aria-hidden="true">·</span>
                  <span class="score-after">A11y: {{ activeAudit.accessibilityScore }}</span>
                  <span aria-hidden="true">·</span>
                  <span class="score-before">SEO: {{ activeAudit.seoScore }}</span>
                  <span class="score-delta">LCP {{ activeAudit.lcpSeconds }}s</span>
                </span>
              </div>
              <p class="radar-axis-spotlight__desc">
                {{ activeAudit.sourceBadge }} · {{ activeAudit.timestampLabel }} · {{ activeAudit.commitsLabel }} applied (CLS {{ activeAudit.clsValue }}, FID {{ activeAudit.inpMs }}ms, Best Practices {{ activeAudit.bestPracticesScore }}).
              </p>
            </div>
          } @else if (viewMode() === 'history') {
            @if (focusedHistoryAxis(); as hAxis) {
              <div class="radar-axis-spotlight" aria-live="polite">
                <div class="radar-axis-spotlight__top">
                  <strong>{{ hAxis.label }}</strong>
                  <span class="radar-axis-spotlight__scores">
                    <span class="score-before">{{ hAxis.s1 }}</span>
                    <span aria-hidden="true">→</span>
                    <span class="score-mid">{{ hAxis.s2 }}</span>
                    <span aria-hidden="true">→</span>
                    <span class="score-after">{{ hAxis.s3 }}</span>
                    <span class="score-delta">+{{ hAxis.totalGain }} pts trajectory</span>
                  </span>
                </div>
                <p class="radar-axis-spotlight__desc">{{ hAxis.description }}</p>
              </div>
            }
          } @else if (viewMode() === 'compare') {
            @if (focusedCompareAxis(); as cAxis) {
              <div class="radar-axis-spotlight" aria-live="polite">
                <div class="radar-axis-spotlight__top">
                  <strong>{{ cAxis.label }}</strong>
                  <span class="radar-axis-spotlight__scores">
                    <span class="score-mid">Run A: {{ cAxis.runAAfter }} (+{{ cAxis.runAGain }})</span>
                    <span aria-hidden="true">vs.</span>
                    <span class="score-after">Run B: {{ cAxis.runBAfter }} (+{{ cAxis.runBGain }})</span>
                    <span class="score-delta">
                      {{ cAxis.afterDelta >= 0 ? '+' : '' }}{{ cAxis.afterDelta }} pts (B vs A)
                    </span>
                  </span>
                </div>
                <p class="radar-axis-spotlight__desc">{{ cAxis.description }}</p>
              </div>
            }
          } @else {
            @if (focusedAxis(); as active) {
              <div class="radar-axis-spotlight" aria-live="polite">
                <div class="radar-axis-spotlight__top">
                  <strong>{{ active.label }}</strong>
                  <span class="radar-axis-spotlight__scores">
                    <span class="score-before">{{ active.before }}</span>
                    <span aria-hidden="true">→</span>
                    <span class="score-after">{{ active.after }}</span>
                    <span class="score-delta">+{{ active.delta }} {{ active.unit }}</span>
                  </span>
                </div>
                <p class="radar-axis-spotlight__desc">{{ active.description }}</p>
              </div>
            }
          }
        </div>

        <!-- Right Panel: Multi-Session History Trajectory + D3 All-Session Firestore Timeline Breakdown, Side-by-Side Comparison, OR Before/After -->
        <div class="radar-metrics-panel" [class.is-entering]="isEntering()">
          @if (viewMode() === 'history') {
            <!-- Firestore Timeline Status Strip -->
            <div class="radar-history-source-bar">
              <div class="radar-history-source-bar__info">
                <span class="radar-history-source-bar__dot" aria-hidden="true"></span>
                <span>
                  @if (repoFirestoreSessions().length > 0) {
                    Synced with <strong>{{ repoFirestoreSessions().length }}</strong> saved Firestore
                    {{ repoFirestoreSessions().length === 1 ? 'session' : 'sessions' }} for
                    <code>{{ repoFullName() }}</code> ({{ activeTrendPoints().length }} trajectory checkpoints)
                  } @else if (savedAudits().length > 0) {
                    Synced with <strong>{{ savedAudits().length }}</strong> saved Firestore
                    {{ savedAudits().length === 1 ? 'session' : 'sessions' }} ({{ activeTrendPoints().length }} trajectory checkpoints)
                  } @else {
                    Plotting <strong>{{ activeTrendPoints().length }}</strong> historical audit checkpoints (click <strong>Save to account</strong> to add live Firestore sessions)
                  }
                </span>
              </div>

              @if (isAuthenticated()) {
                <button
                  type="button"
                  class="radar-history-sync-btn"
                  [disabled]="isLoadingHistory()"
                  (click)="onRefreshHistory()"
                >
                  <span>{{ isLoadingHistory() ? 'Syncing...' : 'Sync Firestore' }}</span>
                </button>
              }
            </div>

            <!-- Chronological Session Checkpoints (Session 1 -> Session 2 -> Session 3) -->
            <div class="radar-history-timeline" aria-label="Audit session trajectory checkpoints">
              @for (s of historySessions(); track s.id; let idx = $index) {
                <div
                  class="radar-history-session-chip"
                  [class.is-s1]="s.slotKey === 'session1'"
                  [class.is-s2]="s.slotKey === 'session2'"
                  [class.is-s3]="s.slotKey === 'session3'"
                >
                  <div class="radar-history-session-chip__top">
                    <span class="radar-history-session-chip__step">Session {{ idx + 1 }}</span>
                    <span class="radar-history-session-chip__badge">{{ s.sourceBadge }}</span>
                  </div>
                  <strong class="radar-history-session-chip__title">{{ s.title }}</strong>
                  <div class="radar-history-session-chip__scores">
                    <span>Perf <strong>{{ s.performanceScore }}</strong></span>
                    <span>·</span>
                    <span>A11y <strong>{{ s.accessibilityScore }}</strong></span>
                    <span>·</span>
                    <span>LCP <strong>{{ s.lcpScore }}</strong></span>
                  </div>
                  <span class="radar-history-session-chip__meta">
                    {{ s.timestampLabel }} · {{ s.commitsLabel }}
                  </span>
                </div>
              }
            </div>

            @if (isTrendAnalysisEnabled()) {
              <!-- Core Web Vitals (LCP, CLS, FID) Timeline Improvement Summary KPIs -->
              <div class="cwv-trend-summary-grid" aria-label="Historical LCP, CLS, and FID performance improvements across all saved audit sessions">
                <div class="cwv-trend-kpi cwv-trend-kpi--lcp">
                  <div class="cwv-trend-kpi__top">
                    <span class="cwv-trend-kpi__tag">LCP · Largest Contentful Paint</span>
                    <span class="cwv-trend-kpi__gain">+{{ latestTrendPoint().lcpScore - firstTrendPoint().lcpScore }} pts</span>
                  </div>
                  <div class="cwv-trend-kpi__values">
                    <span class="cwv-trend-kpi__before">{{ firstTrendPoint().lcpSeconds }}s</span>
                    <span aria-hidden="true">→</span>
                    <strong class="cwv-trend-kpi__after">{{ latestTrendPoint().lcpSeconds }}s</strong>
                    <span class="cwv-trend-kpi__sub">
                      (Score {{ firstTrendPoint().lcpScore }} → {{ latestTrendPoint().lcpScore }})
                    </span>
                  </div>
                </div>

                <div class="cwv-trend-kpi cwv-trend-kpi--cls">
                  <div class="cwv-trend-kpi__top">
                    <span class="cwv-trend-kpi__tag">CLS · Cumulative Layout Shift</span>
                    <span class="cwv-trend-kpi__gain">+{{ latestTrendPoint().clsScore - firstTrendPoint().clsScore }} pts</span>
                  </div>
                  <div class="cwv-trend-kpi__values">
                    <span class="cwv-trend-kpi__before">{{ firstTrendPoint().clsValue }}</span>
                    <span aria-hidden="true">→</span>
                    <strong class="cwv-trend-kpi__after">{{ latestTrendPoint().clsValue }}</strong>
                    <span class="cwv-trend-kpi__sub">
                      (Score {{ firstTrendPoint().clsScore }} → {{ latestTrendPoint().clsScore }})
                    </span>
                  </div>
                </div>

                <div class="cwv-trend-kpi cwv-trend-kpi--fid">
                  <div class="cwv-trend-kpi__top">
                    <span class="cwv-trend-kpi__tag">FID · First Input Delay</span>
                    <span class="cwv-trend-kpi__gain">+{{ latestTrendPoint().fidScore - firstTrendPoint().fidScore }} pts</span>
                  </div>
                  <div class="cwv-trend-kpi__values">
                    <span class="cwv-trend-kpi__before">{{ firstTrendPoint().inpMs }}ms</span>
                    <span aria-hidden="true">→</span>
                    <strong class="cwv-trend-kpi__after">{{ latestTrendPoint().inpMs }}ms</strong>
                    <span class="cwv-trend-kpi__sub">
                      (Score {{ firstTrendPoint().fidScore }} → {{ latestTrendPoint().fidScore }})
                    </span>
                  </div>
                </div>
              </div>

              <!-- All Saved Firestore Audit Sessions Chronological Trajectory List -->
              <ul class="radar-axes-list d3-five-audits-list" aria-label="Historical Firestore audit sessions LCP, CLS, and FID progression">
                @for (pt of activeTrendPoints(); track pt.id; let idx = $index) {
                  <li
                    class="radar-axis-row d3-audit-trend-row"
                    [class.is-highlighted]="focusedTrendPoint().auditIndex === pt.auditIndex"
                    [class.is-entering]="isEntering()"
                    [style.animation-delay.ms]="idx * 40"
                    tabindex="0"
                    (mouseenter)="hoveredTrendIndex.set(pt.auditIndex)"
                    (mouseleave)="hoveredTrendIndex.set(null)"
                    (focus)="hoveredTrendIndex.set(pt.auditIndex)"
                    (blur)="hoveredTrendIndex.set(null)"
                  >
                    <div class="radar-axis-row__top">
                      <div class="d3-audit-trend-row__title-group">
                        <span class="d3-audit-trend-row__step">{{ pt.shortLabel }}</span>
                        <span class="radar-axis-row__name">{{ pt.title }}</span>
                        @if (pt.isFirestoreBacked) {
                          <span class="d3-significance-pill d3-significance-pill--firestore">Firestore</span>
                        }
                        @if (idx === 0) {
                          <span class="d3-significance-pill d3-significance-pill--initial">Initial Scan</span>
                        } @else if (idx === activeTrendPoints().length - 1) {
                          <span class="d3-significance-pill d3-significance-pill--latest">Latest Optimized</span>
                        }
                      </div>
                      <div style="display:flex;align-items:center;gap:0.45rem;">
                        @if (idx === 0 || idx === activeTrendPoints().length - 1) {
                          <button
                            type="button"
                            class="text-action-btn"
                            (click)="onTriggerAutoCompare(); $event.stopPropagation()"
                            title="Open Initial Scan vs. Latest Optimized Run in the side-by-side comparison panel"
                          >
                            Auto-Compare →
                          </button>
                        }
                        <span class="d3-audit-trend-row__date">{{ pt.timestampLabel }}</span>
                      </div>
                    </div>

                    <div class="d3-audit-trend-row__metrics">
                      <span class="d3-cwv-chip d3-cwv-chip--perf" [class.is-metric-focused]="trendMetricFilter() === 'performance'">
                        Perf: <strong>{{ pt.performanceScore }}</strong>
                      </span>
                      <span class="d3-cwv-chip d3-cwv-chip--cls" [class.is-metric-focused]="trendMetricFilter() === 'accessibility'">
                        A11y: <strong>{{ pt.accessibilityScore }}</strong>
                      </span>
                      <span class="d3-cwv-chip d3-cwv-chip--seo" [class.is-metric-focused]="trendMetricFilter() === 'seo'">
                        SEO: <strong>{{ pt.seoScore }}</strong>
                      </span>
                      <span class="d3-cwv-chip d3-cwv-chip--lcp" [class.is-metric-focused]="trendMetricFilter() === 'all-cwv'">
                        LCP: <strong>{{ pt.lcpSeconds }}s</strong> ({{ pt.lcpScore }})
                      </span>
                      <span class="d3-cwv-chip" [class.is-metric-focused]="trendMetricFilter() === 'all-cwv'">
                        CLS: <strong>{{ pt.clsValue }}</strong>
                      </span>
                      <span class="d3-cwv-chip d3-cwv-chip--fid" [class.is-metric-focused]="trendMetricFilter() === 'best-practices'">
                        BP: <strong>{{ pt.bestPracticesScore }}</strong>
                      </span>
                    </div>
                  </li>
                }
              </ul>
            }

            <!-- 6-Axis Multi-Session Trajectory List -->
            <ul class="radar-axes-list" aria-label="Multi-session metric trajectory breakdown">
              @for (row of historyAxisRows(); track row.id; let idx = $index) {
                <li
                  class="radar-axis-row"
                  [class.is-highlighted]="focusedHistoryAxis()?.id === row.id"
                  [class.is-entering]="isEntering()"
                  [style.animation-delay.ms]="idx * 45"
                  tabindex="0"
                  (mouseenter)="hoveredAxisId.set(row.id)"
                  (mouseleave)="hoveredAxisId.set(null)"
                  (focus)="hoveredAxisId.set(row.id)"
                  (blur)="hoveredAxisId.set(null)"
                >
                  <div class="radar-axis-row__top">
                    <span class="radar-axis-row__name">{{ row.label }}</span>
                    <div class="radar-axis-row__nums">
                      <span class="radar-axis-row__before" title="Session 1">{{ row.s1 }}</span>
                      <span class="radar-axis-row__arrow" aria-hidden="true">→</span>
                      <span class="radar-axis-row__mid" title="Session 2">{{ row.s2 }}</span>
                      <span class="radar-axis-row__arrow" aria-hidden="true">→</span>
                      <span class="radar-axis-row__after" title="Latest Session">{{ row.s3 }}</span>
                      <span class="radar-axis-row__delta" [class.is-zero]="row.totalGain === 0">
                        +{{ row.totalGain }}
                      </span>
                    </div>
                  </div>
                  <div class="radar-axis-bar radar-axis-bar--history">
                    <div
                      class="radar-axis-bar__s1"
                      [style.width.%]="row.s1"
                    ></div>
                    <div
                      class="radar-axis-bar__s2"
                      [style.width.%]="row.s2"
                    ></div>
                    <div
                      class="radar-axis-bar__after"
                      [style.width.%]="row.s3"
                    ></div>
                  </div>
                </li>
              }
            </ul>
          } @else if (viewMode() === 'compare') {
            <div class="radar-headline-kpis">
              <div class="radar-kpi-box">
                <span class="radar-kpi-box__label">Performance (Run A vs. Run B)</span>
                <div class="radar-kpi-box__row">
                  <span class="radar-axis-row__mid" title="Run A After">{{ selectedCompareRunA().performanceAfter }}</span>
                  <span class="radar-kpi-box__arrow" aria-hidden="true">vs.</span>
                  <span class="radar-kpi-box__after" title="Run B After">{{ selectedCompareRunB().performanceAfter }}</span>
                  <span class="radar-kpi-box__badge">
                    {{ selectedCompareRunB().performanceAfter - selectedCompareRunA().performanceAfter >= 0 ? '+' : '' }}{{ selectedCompareRunB().performanceAfter - selectedCompareRunA().performanceAfter }} pts
                  </span>
                </div>
              </div>

              <div class="radar-kpi-box">
                <span class="radar-kpi-box__label">Accessibility (Run A vs. Run B)</span>
                <div class="radar-kpi-box__row">
                  <span class="radar-axis-row__mid" title="Run A After">{{ selectedCompareRunA().accessibilityAfter }}</span>
                  <span class="radar-kpi-box__arrow" aria-hidden="true">vs.</span>
                  <span class="radar-kpi-box__after" title="Run B After">{{ selectedCompareRunB().accessibilityAfter }}</span>
                  <span class="radar-kpi-box__badge">
                    {{ selectedCompareRunB().accessibilityAfter - selectedCompareRunA().accessibilityAfter >= 0 ? '+' : '' }}{{ selectedCompareRunB().accessibilityAfter - selectedCompareRunA().accessibilityAfter }} pts
                  </span>
                </div>
              </div>
            </div>

            <ul class="radar-axes-list" aria-label="Side-by-side Run A vs Run B radar metric breakdown">
              @for (row of compareAxisRows(); track row.id; let idx = $index) {
                <li
                  class="radar-axis-row"
                  [class.is-highlighted]="focusedCompareAxis()?.id === row.id"
                  [class.is-entering]="isEntering()"
                  [style.animation-delay.ms]="idx * 45"
                  tabindex="0"
                  (mouseenter)="hoveredAxisId.set(row.id)"
                  (mouseleave)="hoveredAxisId.set(null)"
                  (focus)="hoveredAxisId.set(row.id)"
                  (blur)="hoveredAxisId.set(null)"
                >
                  <div class="radar-axis-row__top">
                    <span class="radar-axis-row__name">{{ row.label }}</span>
                    <div class="radar-axis-row__nums">
                      <span class="radar-axis-row__mid" title="Run A After ({{ row.runABefore }}→{{ row.runAAfter }})">
                        A: {{ row.runAAfter }} (+{{ row.runAGain }})
                      </span>
                      <span class="radar-axis-row__arrow" aria-hidden="true">vs</span>
                      <span class="radar-axis-row__after" title="Run B After ({{ row.runBBefore }}→{{ row.runBAfter }})">
                        B: {{ row.runBAfter }} (+{{ row.runBGain }})
                      </span>
                      <span class="radar-axis-row__delta" [class.is-zero]="row.afterDelta === 0">
                        {{ row.afterDelta >= 0 ? '+' : '' }}{{ row.afterDelta }}
                      </span>
                    </div>
                  </div>
                  <div class="radar-axis-bar radar-axis-bar--history">
                    <div
                      class="radar-axis-bar__s1"
                      [style.width.%]="row.baseline"
                    ></div>
                    <div
                      class="radar-axis-bar__s2"
                      [style.width.%]="row.runAAfter"
                    ></div>
                    <div
                      class="radar-axis-bar__after"
                      [style.width.%]="row.runBAfter"
                    ></div>
                  </div>
                </li>
              }
            </ul>
          } @else {
            <div class="radar-headline-kpis">
              <div class="radar-kpi-box">
                <span class="radar-kpi-box__label">Performance score</span>
                <div class="radar-kpi-box__row">
                  <span class="radar-kpi-box__before">{{ metrics().performanceBefore }}</span>
                  <span class="radar-kpi-box__arrow" aria-hidden="true">→</span>
                  <span class="radar-kpi-box__after">{{ metrics().performanceAfter }}</span>
                  <span class="radar-kpi-box__badge">
                    +{{ metrics().performanceAfter - metrics().performanceBefore }} pts
                  </span>
                </div>
              </div>

              <div class="radar-kpi-box">
                <span class="radar-kpi-box__label">Accessibility score</span>
                <div class="radar-kpi-box__row">
                  <span class="radar-kpi-box__before">{{ metrics().accessibilityBefore }}</span>
                  <span class="radar-kpi-box__arrow" aria-hidden="true">→</span>
                  <span class="radar-kpi-box__after">{{ metrics().accessibilityAfter }}</span>
                  <span class="radar-kpi-box__badge">
                    +{{ metrics().accessibilityAfter - metrics().accessibilityBefore }} pts
                  </span>
                </div>
              </div>
            </div>

            <ul class="radar-axes-list" aria-label="Before vs after metric breakdown">
              @for (axis of activeAxes(); track axis.id; let idx = $index) {
                <li
                  class="radar-axis-row"
                  [class.is-highlighted]="focusedAxis()?.id === axis.id"
                  [class.is-entering]="isEntering()"
                  [style.animation-delay.ms]="idx * 45"
                  tabindex="0"
                  (mouseenter)="hoveredAxisId.set(axis.id)"
                  (mouseleave)="hoveredAxisId.set(null)"
                  (focus)="hoveredAxisId.set(axis.id)"
                  (blur)="hoveredAxisId.set(null)"
                >
                  <div class="radar-axis-row__top">
                    <span class="radar-axis-row__name">{{ axis.label }}</span>
                    <div class="radar-axis-row__nums">
                      <span class="radar-axis-row__before">{{ axis.before }}</span>
                      <span class="radar-axis-row__arrow" aria-hidden="true">→</span>
                      <span class="radar-axis-row__after">{{ axis.after }}</span>
                      <span class="radar-axis-row__delta" [class.is-zero]="axis.delta === 0">
                        +{{ axis.delta }}
                      </span>
                    </div>
                  </div>
                  <div class="radar-axis-bar">
                    <div
                      class="radar-axis-bar__before"
                      [style.width.%]="axis.before"
                    ></div>
                    <div
                      class="radar-axis-bar__after"
                      [style.width.%]="axis.after"
                    ></div>
                  </div>
                </li>
              }
            </ul>
          }
        </div>
      </div>
    </section>
  `,
})
export class ImpactRadarChartComponent implements AfterViewInit, OnDestroy {
  readonly metrics = input.required<AuditImpactMetrics>();
  readonly selectedCount = input.required<number>();
  readonly totalCount = input.required<number>();
  readonly activeCategoryTab = input<string>('all');
  readonly repoFullName = input<string>('fresnel-sandbox/lumina-web-app');
  readonly savedAudits = input<SavedAuditHistoryRecord[]>([]);
  readonly isAuthenticated = input<boolean>(false);
  readonly isLoadingHistory = input<boolean>(false);

  readonly refreshHistory = output<void>();
  readonly autoCompareRequested = output<void>();
  readonly viewModeChanged = output<'detailed' | 'categories' | 'history' | 'compare'>();
  readonly externalViewMode = input<'detailed' | 'categories' | 'history' | 'compare' | null>(null);

  @ViewChild('radarContainer', { static: true })
  private readonly radarContainer!: ElementRef<HTMLDivElement>;

  @ViewChild('d3TrendContainer', { static: true })
  private readonly d3TrendContainer!: ElementRef<HTMLDivElement>;

  readonly viewMode = signal<'detailed' | 'categories' | 'history' | 'compare'>('detailed');
  readonly isTrendAnalysisEnabled = signal<boolean>(true);
  readonly trendScope = signal<'all-sessions' | 'last-5'>('all-sessions');
  readonly trendDateRange = signal<TrendDateRange>(90);
  readonly trendMetricFilter = signal<TrendMetricFilter>('all-cwv');
  readonly hoveredTrendIndex = signal<number | null>(null);
  readonly isCompareDrawerOpen = signal<boolean>(false);
  readonly compareRunAId = signal<string>('run-static-pass');
  readonly compareRunBId = signal<string>('run-active-current');
  readonly hoveredAxisId = signal<string | null>(null);
  readonly isEntering = signal<boolean>(true);
  private readonly animCycle = signal<number>(1);
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCategoryTab = 'all';

  readonly activeAxes = computed<RadarMetricAxis[]>(() => {
    const m = this.metrics();
    return this.viewMode() === 'categories' ? m.categoryAxes : m.detailedAxes;
  });

  readonly focusedAxis = computed<RadarMetricAxis | null>(() => {
    const axes = this.activeAxes();
    const hovered = this.hoveredAxisId();
    if (hovered) {
      return axes.find((a) => a.id === hovered) ?? axes[0] ?? null;
    }
    return axes[0] ?? null;
  });

  /**
   * Filters Firestore saved audit records matching the current repository,
   * sorted chronologically (oldest to newest).
   */
  readonly repoFirestoreSessions = computed<SavedAuditHistoryRecord[]>(() => {
    const repo = (this.repoFullName() || '').trim().toLowerCase();
    const allSaved = this.savedAudits() || [];
    const matching = allSaved.filter(
      (rec) => (rec.repoFullName || '').trim().toLowerCase() === repo
    );
    const pool = matching.length > 0 ? matching : allSaved;
    return [...pool].sort((a, b) =>
      String(a.createdAtIso || a.updatedAtIso || '').localeCompare(
        String(b.createdAtIso || b.updatedAtIso || '')
      )
    );
  });

  /**
   * All saved Firestore audit sessions sorted chronologically (oldest to newest)
   * using their timeline timestamps (createdAtIso / updatedAtIso).
   */
  readonly chronologicalFirestoreAudits = computed<SavedAuditHistoryRecord[]>(() => {
    const allSaved = this.savedAudits() || [];
    return [...allSaved].sort((a, b) =>
      String(a.createdAtIso || a.updatedAtIso || '').localeCompare(
        String(b.createdAtIso || b.updatedAtIso || '')
      )
    );
  });

  /**
   * Builds the full historical timeline across ALL saved Firestore audit sessions
   * (plus initial unpatched baseline and current live session) for the D3 line chart
   * in the Trend Analysis section.
   */
  readonly allSavedSessionsTrendPoints = computed<FiveAuditTrendPoint[]>(() => {
    const m = this.metrics();
    const allFirestore = this.chronologicalFirestoreAudits();
    const selCount = this.selectedCount();
    const totCount = Math.max(1, this.totalCount());

    const getDetailedAxis = (id: string, fallbackBefore: number, fallbackAfter: number) => {
      const axis = m.detailedAxes.find((a) => a.id === id);
      return {
        before: axis?.before ?? fallbackBefore,
        after: axis?.after ?? fallbackAfter,
      };
    };

    const lcp = getDetailedAxis('lcp', 56, 95);
    const cls = getDetailedAxis('cls', 63, 97);
    const fid = getDetailedAxis('fid', 62, 94);

    const scoreToLcpSeconds = (score: number): number => {
      const clamped = Math.max(40, Math.min(99, score));
      const sec = 4.2 - ((clamped - 55) / 42) * 3.0;
      return Math.max(1.0, Math.round(sec * 10) / 10);
    };

    const scoreToClsValue = (score: number): number => {
      const clamped = Math.max(45, Math.min(99, score));
      const val = 0.25 - ((clamped - 60) / 38) * 0.235;
      return Math.max(0.01, Math.round(val * 1000) / 1000);
    };

    const formatDateShort = (iso?: string, fallback = 'Saved session') => {
      if (!iso) return fallback;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return fallback;
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const computeDaysAgo = (iso?: string, fallbackDays = 0): number => {
      if (!iso) return fallbackDays;
      const ms = new Date(iso).getTime();
      if (Number.isNaN(ms)) return fallbackDays;
      return Math.max(0, Math.round((Date.now() - ms) / (24 * 3600 * 1000)));
    };

    if (allFirestore.length === 0) {
      return this.lastFiveAudits();
    }

    const timelinePoints: FiveAuditTrendPoint[] = [];

    // 1. Initial Baseline Checkpoint derived from the earliest saved Firestore session's before-scores
    const earliest = allFirestore[0];
    const initPerf = earliest?.performanceBefore ?? m.performanceBefore;
    const initA11y = earliest?.accessibilityBefore ?? m.accessibilityBefore;
    const initSeo = earliest?.seoBefore ?? m.seoBefore;
    const initBp = earliest?.bestPracticesBefore ?? m.bestPracticesBefore;
    const earliestIso =
      earliest?.createdAtIso ||
      earliest?.updatedAtIso ||
      new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();

    timelinePoints.push({
      auditIndex: 1,
      id: 'fs-timeline-initial-baseline',
      shortLabel: 'Session 1',
      title: `Initial Unpatched Baseline (${earliest?.repoFullName?.split('/')[1] || 'Repo'})`,
      sourceBadge: 'Run 0 · Initial Baseline',
      isFirestoreBacked: false,
      timestampIso: earliestIso,
      timestampLabel: formatDateShort(earliestIso, 'Initial scan'),
      daysAgo: computeDaysAgo(earliestIso, 45),
      commitsLabel: `0/${earliest?.totalCommitsCount || totCount} commits`,
      performanceScore: initPerf,
      accessibilityScore: initA11y,
      seoScore: initSeo,
      bestPracticesScore: initBp,
      lcpScore: lcp.before,
      lcpSeconds: scoreToLcpSeconds(lcp.before),
      clsScore: cls.before,
      clsValue: scoreToClsValue(cls.before),
      fidScore: fid.before,
      inpMs: 280,
    });

    // 2. Every saved audit session in Firestore plotted along the timeline
    allFirestore.forEach((rec, idx) => {
      const sessionNum = idx + 2;
      const perfRatio =
        rec.performanceAfter > rec.performanceBefore
          ? (rec.performanceAfter - rec.performanceBefore) /
            Math.max(1, 96 - rec.performanceBefore)
          : 0.68;

      const lcpVal = Math.min(97, Math.round(lcp.before + perfRatio * 39));
      const clsVal = Math.min(98, Math.round(cls.before + perfRatio * 34));
      const fidVal = Math.min(96, Math.round(fid.before + perfRatio * 32));
      const shortRepo = rec.repoFullName?.split('/')[1] || rec.repoFullName || 'Repository';
      const recIso = rec.updatedAtIso || rec.createdAtIso || new Date().toISOString();

      timelinePoints.push({
        auditIndex: sessionNum,
        id: `fs-timeline-${rec.auditId || idx}`,
        shortLabel: `Session ${sessionNum}`,
        title:
          rec.runPhase === 'lhr'
            ? `Firestore LHR Audit · ${shortRepo}`
            : `Firestore Static Audit · ${shortRepo}`,
        sourceBadge:
          rec.runPhase === 'lhr' ? 'Firestore · Run 2 LHR' : 'Firestore · Run 1 Static',
        isFirestoreBacked: true,
        timestampIso: recIso,
        timestampLabel: formatDateShort(recIso),
        daysAgo: computeDaysAgo(recIso, 7),
        commitsLabel: `${rec.selectedCommitsCount}/${rec.totalCommitsCount} commits`,
        performanceScore: rec.performanceAfter,
        accessibilityScore: rec.accessibilityAfter,
        seoScore: rec.seoAfter ?? m.seoAfter,
        bestPracticesScore: rec.bestPracticesAfter ?? m.bestPracticesAfter,
        lcpScore: lcpVal,
        lcpSeconds: scoreToLcpSeconds(lcpVal),
        clsScore: clsVal,
        clsValue: scoreToClsValue(clsVal),
        fidScore: fidVal,
        inpMs: Math.max(72, Math.round(270 - perfRatio * 185)),
      });
    });

    // 3. Current active live session checkpoint at the head of the timeline
    const nextIdx = timelinePoints.length + 1;
    const nowIso = new Date().toISOString();
    timelinePoints.push({
      auditIndex: nextIdx,
      id: 'fs-timeline-active-head',
      shortLabel: `Session ${nextIdx}`,
      title: `Active Live Session (${this.repoFullName().split('/')[1] || this.repoFullName()})`,
      sourceBadge: 'Live Active Session',
      isFirestoreBacked: false,
      timestampIso: nowIso,
      timestampLabel: 'Active now',
      daysAgo: 0,
      commitsLabel: `${selCount}/${totCount} commits`,
      performanceScore: m.performanceAfter,
      accessibilityScore: m.accessibilityAfter,
      seoScore: m.seoAfter,
      bestPracticesScore: m.bestPracticesAfter,
      lcpScore: lcp.after,
      lcpSeconds: scoreToLcpSeconds(lcp.after),
      clsScore: cls.after,
      clsValue: scoreToClsValue(cls.after),
      fidScore: fid.after,
      inpMs: 78,
    });

    return timelinePoints;
  });

  readonly trendDateRangeLabel = computed<string>(() => {
    const r = this.trendDateRange();
    if (r === 'all') return 'All time';
    return `Last ${r} days`;
  });

  /**
   * Returns the active D3 trend points based on the user's selected scope
   * ('all-sessions' vs 'last-5') AND date-range filter (30, 60, 90 days, or all time).
   */
  readonly activeTrendPoints = computed<FiveAuditTrendPoint[]>(() => {
    const basePoints =
      this.trendScope() === 'all-sessions'
        ? this.allSavedSessionsTrendPoints()
        : this.lastFiveAudits();

    const range = this.trendDateRange();
    if (range === 'all' || basePoints.length <= 2) {
      return basePoints;
    }

    const filtered = basePoints.filter((pt) => pt.daysAgo <= range);
    if (filtered.length >= 2) {
      return filtered;
    }

    // Ensure at least 2 chronological checkpoints remain in-window so D3 renders a trajectory curve
    return basePoints.slice(-2);
  });

  /**
   * Builds the chronological 5-audit trajectory (Audit 1 through Audit 5) for the
   * D3 Trend Analysis view on the History tab, combining saved Firestore audits
   * and progressive optimization milestones spaced across 82 days so 30/60/90d
   * date-range filtering provides immediate interactive granularity.
   */
  readonly lastFiveAudits = computed<FiveAuditTrendPoint[]>(() => {
    const m = this.metrics();
    const firestoreList = this.repoFirestoreSessions();
    const selCount = this.selectedCount();
    const totCount = Math.max(1, this.totalCount());

    const getDetailedAxis = (id: string, fallbackBefore: number, fallbackAfter: number) => {
      const axis = m.detailedAxes.find((a) => a.id === id);
      return {
        before: axis?.before ?? fallbackBefore,
        after: axis?.after ?? fallbackAfter,
      };
    };

    const lcp = getDetailedAxis('lcp', 56, 95);
    const cls = getDetailedAxis('cls', 63, 97);
    const fid = getDetailedAxis('fid', 62, 94);

    // Converts a 0-100 LCP score into realistic seconds (e.g. score 56 -> 4.1s, score 95 -> 1.2s)
    const scoreToLcpSeconds = (score: number): number => {
      const clamped = Math.max(40, Math.min(99, score));
      const sec = 4.2 - ((clamped - 55) / 42) * 3.0;
      return Math.max(1.0, Math.round(sec * 10) / 10);
    };

    // Converts a 0-100 CLS score into realistic unitless layout shift (e.g. score 63 -> 0.24, score 97 -> 0.015)
    const scoreToClsValue = (score: number): number => {
      const clamped = Math.max(45, Math.min(99, score));
      const val = 0.25 - ((clamped - 60) / 38) * 0.235;
      return Math.max(0.01, Math.round(val * 1000) / 1000);
    };

    const daysAgoIso = (days: number): string =>
      new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    const formatDateShort = (iso?: string, fallback = 'Saved run') => {
      if (!iso) return fallback;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return fallback;
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    };

    const lerp = (start: number, end: number, t: number) =>
      Math.round(start + (end - start) * t);

    const dayOffsets = [82, 54, 34, 16, 0];

    // Default 5 progressive audit stages from Initial Scan (82d ago) to Latest Optimized (Today)
    const baseStages: Omit<FiveAuditTrendPoint, 'lcpSeconds' | 'clsValue'>[] = [
      {
        auditIndex: 1,
        id: 'trend-audit-1',
        shortLabel: 'Audit 1',
        title: 'Initial Unpatched Scan',
        sourceBadge: 'Run 0 · Initial Baseline',
        isFirestoreBacked: false,
        timestampIso: daysAgoIso(dayOffsets[0]),
        timestampLabel: `${formatDateShort(daysAgoIso(dayOffsets[0]))} (${dayOffsets[0]}d ago)`,
        daysAgo: dayOffsets[0],
        commitsLabel: `0/${totCount} commits`,
        performanceScore: m.performanceBefore,
        accessibilityScore: m.accessibilityBefore,
        seoScore: m.seoBefore,
        bestPracticesScore: m.bestPracticesBefore,
        lcpScore: lcp.before,
        clsScore: cls.before,
        fidScore: fid.before,
        inpMs: 280,
      },
      {
        auditIndex: 2,
        id: 'trend-audit-2',
        shortLabel: 'Audit 2',
        title: 'Hero Preload & Font Swap Pass',
        sourceBadge: 'Run 1 · Early Static Pass',
        isFirestoreBacked: false,
        timestampIso: daysAgoIso(dayOffsets[1]),
        timestampLabel: `${formatDateShort(daysAgoIso(dayOffsets[1]))} (${dayOffsets[1]}d ago)`,
        daysAgo: dayOffsets[1],
        commitsLabel: `${Math.max(1, Math.round(totCount * 0.33))}/${totCount} commits`,
        performanceScore: lerp(m.performanceBefore, m.performanceAfter, 0.28),
        accessibilityScore: lerp(m.accessibilityBefore, m.accessibilityAfter, 0.25),
        seoScore: lerp(m.seoBefore, m.seoAfter, 0.3),
        bestPracticesScore: lerp(m.bestPracticesBefore, m.bestPracticesAfter, 0.28),
        lcpScore: lerp(lcp.before, lcp.after, 0.34),
        clsScore: lerp(cls.before, cls.after, 0.28),
        fidScore: lerp(fid.before, fid.after, 0.26),
        inpMs: 220,
      },
      {
        auditIndex: 3,
        id: 'trend-audit-3',
        shortLabel: 'Audit 3',
        title: 'CLS Media Dimensions & Defer Pass',
        sourceBadge: 'Run 1 · Core Web Vitals',
        isFirestoreBacked: false,
        timestampIso: daysAgoIso(dayOffsets[2]),
        timestampLabel: `${formatDateShort(daysAgoIso(dayOffsets[2]))} (${dayOffsets[2]}d ago)`,
        daysAgo: dayOffsets[2],
        commitsLabel: `${Math.max(2, Math.round(totCount * 0.55))}/${totCount} commits`,
        performanceScore: lerp(m.performanceBefore, m.performanceAfter, 0.56),
        accessibilityScore: lerp(m.accessibilityBefore, m.accessibilityAfter, 0.54),
        seoScore: lerp(m.seoBefore, m.seoAfter, 0.58),
        bestPracticesScore: lerp(m.bestPracticesBefore, m.bestPracticesAfter, 0.55),
        lcpScore: lerp(lcp.before, lcp.after, 0.6),
        clsScore: lerp(cls.before, cls.after, 0.62),
        fidScore: lerp(fid.before, fid.after, 0.55),
        inpMs: 165,
      },
      {
        auditIndex: 4,
        id: 'trend-audit-4',
        shortLabel: 'Audit 4',
        title: 'WCAG AA Contrast & SEO Metadata Pass',
        sourceBadge: 'Run 1 · Full Static Suite',
        isFirestoreBacked: false,
        timestampIso: daysAgoIso(dayOffsets[3]),
        timestampLabel: `${formatDateShort(daysAgoIso(dayOffsets[3]))} (${dayOffsets[3]}d ago)`,
        daysAgo: dayOffsets[3],
        commitsLabel: `${Math.max(3, Math.round(totCount * 0.82))}/${totCount} commits`,
        performanceScore: lerp(m.performanceBefore, m.performanceAfter, 0.8),
        accessibilityScore: lerp(m.accessibilityBefore, m.accessibilityAfter, 0.84),
        seoScore: lerp(m.seoBefore, m.seoAfter, 0.85),
        bestPracticesScore: lerp(m.bestPracticesBefore, m.bestPracticesAfter, 0.82),
        lcpScore: lerp(lcp.before, lcp.after, 0.82),
        clsScore: lerp(cls.before, cls.after, 0.84),
        fidScore: lerp(fid.before, fid.after, 0.8),
        inpMs: 118,
      },
      {
        auditIndex: 5,
        id: 'trend-audit-5',
        shortLabel: 'Audit 5',
        title: 'Latest Optimized Build',
        sourceBadge: 'Active Optimized Session',
        isFirestoreBacked: false,
        timestampIso: daysAgoIso(0),
        timestampLabel: 'Today · Active',
        daysAgo: 0,
        commitsLabel: `${selCount}/${totCount} commits`,
        performanceScore: m.performanceAfter,
        accessibilityScore: m.accessibilityAfter,
        seoScore: m.seoAfter,
        bestPracticesScore: m.bestPracticesAfter,
        lcpScore: lcp.after,
        clsScore: cls.after,
        fidScore: fid.after,
        inpMs: 78,
      },
    ];

    // Overlay up to the last 4 saved Firestore audits into slots 2..4 (or 1..5 if >=5 Firestore records exist)
    const recentFirestore = firestoreList.slice(-5);
    recentFirestore.forEach((rec, idx) => {
      const targetSlot =
        recentFirestore.length >= 5
          ? idx
          : Math.min(3, idx + 1);
      const perfRatio =
        rec.performanceAfter > rec.performanceBefore
          ? (rec.performanceAfter - rec.performanceBefore) /
            Math.max(1, 96 - rec.performanceBefore)
          : 0.68;

      const lcpVal = Math.min(97, Math.round(lcp.before + perfRatio * 39));
      const clsVal = Math.min(98, Math.round(cls.before + perfRatio * 34));
      const fidVal = Math.min(96, Math.round(fid.before + perfRatio * 32));
      const recIso = rec.updatedAtIso || rec.createdAtIso || daysAgoIso(dayOffsets[targetSlot]);
      const recDaysAgo = Math.max(
        0,
        Math.round((Date.now() - new Date(recIso).getTime()) / (24 * 3600 * 1000))
      );

      baseStages[targetSlot] = {
        auditIndex: targetSlot + 1,
        id: `trend-fs-${rec.auditId || idx}`,
        shortLabel: `Audit ${targetSlot + 1}`,
        title:
          rec.runPhase === 'lhr'
            ? `Saved LHR Pass (${rec.repoFullName.split('/')[1] || rec.repoFullName})`
            : `Saved Static Pass (${rec.repoFullName.split('/')[1] || rec.repoFullName})`,
        sourceBadge:
          rec.runPhase === 'lhr' ? 'Firestore · Run 2 LHR' : 'Firestore · Run 1 Static',
        isFirestoreBacked: true,
        timestampIso: recIso,
        timestampLabel: formatDateShort(recIso),
        daysAgo: Number.isNaN(recDaysAgo) ? dayOffsets[targetSlot] : recDaysAgo,
        commitsLabel: `${rec.selectedCommitsCount}/${rec.totalCommitsCount} commits`,
        performanceScore: rec.performanceAfter,
        accessibilityScore: rec.accessibilityAfter,
        seoScore: rec.seoAfter ?? m.seoAfter,
        bestPracticesScore: rec.bestPracticesAfter ?? m.bestPracticesAfter,
        lcpScore: lcpVal,
        clsScore: clsVal,
        fidScore: fidVal,
        inpMs: Math.max(72, Math.round(270 - perfRatio * 185)),
      };
    });

    return baseStages.map((stage) => ({
      ...stage,
      lcpSeconds: scoreToLcpSeconds(stage.lcpScore),
      clsValue: scoreToClsValue(stage.clsScore),
    }));
  });

  readonly firstTrendPoint = computed<FiveAuditTrendPoint>(() => {
    const pts = this.activeTrendPoints();
    return pts[0];
  });

  readonly latestTrendPoint = computed<FiveAuditTrendPoint>(() => {
    const pts = this.activeTrendPoints();
    return pts[pts.length - 1];
  });

  readonly focusedTrendPoint = computed<FiveAuditTrendPoint>(() => {
    const pts = this.activeTrendPoints();
    const hovered = this.hoveredTrendIndex();
    if (hovered !== null) {
      return pts.find((p) => p.auditIndex === hovered) ?? pts[pts.length - 1];
    }
    return pts[pts.length - 1];
  });

  readonly activeTrendMetricMeta = computed<{
    label: string;
    shortLabel: string;
    color: string;
    firstVal: number;
    latestVal: number;
    delta: number;
    targetZoneText: string;
  }>(() => {
    const first = this.firstTrendPoint();
    const latest = this.latestTrendPoint();
    const filter = this.trendMetricFilter();

    switch (filter) {
      case 'performance':
        return {
          label: 'Performance Score Trajectory',
          shortLabel: 'Performance',
          color: '#0284c7',
          firstVal: first.performanceScore,
          latestVal: latest.performanceScore,
          delta: latest.performanceScore - first.performanceScore,
          targetZoneText: '90+ Good Lighthouse Performance Zone',
        };
      case 'accessibility':
        return {
          label: 'Accessibility Score Trajectory',
          shortLabel: 'Accessibility',
          color: '#10b981',
          firstVal: first.accessibilityScore,
          latestVal: latest.accessibilityScore,
          delta: latest.accessibilityScore - first.accessibilityScore,
          targetZoneText: '90+ WCAG 2.2 AA Accessibility Compliance Zone',
        };
      case 'seo':
        return {
          label: 'SEO Score Trajectory',
          shortLabel: 'SEO',
          color: '#f59e0b',
          firstVal: first.seoScore,
          latestVal: latest.seoScore,
          delta: latest.seoScore - first.seoScore,
          targetZoneText: '90+ Search Crawlability & Metadata Zone',
        };
      case 'best-practices':
        return {
          label: 'Best Practices Score Trajectory',
          shortLabel: 'Best Practices',
          color: '#8b5cf6',
          firstVal: first.bestPracticesScore,
          latestVal: latest.bestPracticesScore,
          delta: latest.bestPracticesScore - first.bestPracticesScore,
          targetZoneText: '90+ Modern Web Best Practices Zone',
        };
      default:
        return {
          label: 'Core Web Vitals (LCP, CLS, FID & Performance)',
          shortLabel: 'Overall Perf',
          color: '#0ea5e9',
          firstVal: first.performanceScore,
          latestVal: latest.performanceScore,
          delta: latest.performanceScore - first.performanceScore,
          targetZoneText: '90+ Good Core Web Vitals Zone (LCP ≤ 2.5s · CLS ≤ 0.10 · FID ≤ 100ms)',
        };
    }
  });

  /**
   * Builds selectable audit run options from active session, intermediate passes,
   * and the user's saved Firestore audit history so any two runs can be compared
   * side-by-side on the existing Recharts radar chart.
   */
  readonly comparableRunOptions = computed<RadarComparableRunOption[]>(() => {
    const m = this.metrics();
    const repo = this.repoFullName();
    const selCount = this.selectedCount();
    const totCount = this.totalCount();
    const saved = this.savedAudits() || [];

    const getAxisScore = (id: string, fallbackBefore: number, fallbackAfter: number) => {
      const found = m.detailedAxes.find((a) => a.id === id);
      return {
        before: found?.before ?? fallbackBefore,
        after: found?.after ?? fallbackAfter,
      };
    };

    const lcp = getAxisScore('lcp', 56, 94);
    const cls = getAxisScore('cls', 63, 96);
    const fid = getAxisScore('fid', 62, 93);
    const wcag = getAxisScore('wcag-aria', 66, 96);

    const initialBaselineOption: RadarComparableRunOption = {
      id: 'run-initial-scan',
      title: `Initial Scan — Unpatched Repository Baseline (0/${totCount} commits)`,
      sourceBadge: 'Initial Scan · Baseline',
      repoFullName: repo,
      timestampLabel: 'Initial scan',
      commitsLabel: `0/${totCount} commits`,
      performanceBefore: m.performanceBefore,
      performanceAfter: m.performanceBefore,
      accessibilityBefore: m.accessibilityBefore,
      accessibilityAfter: m.accessibilityBefore,
      lcpBefore: lcp.before,
      lcpAfter: lcp.before,
      clsBefore: cls.before,
      clsAfter: cls.before,
      fidBefore: fid.before,
      fidAfter: fid.before,
      wcagBefore: wcag.before,
      wcagAfter: wcag.before,
    };

    const activeOption: RadarComparableRunOption = {
      id: 'run-active-current',
      title: `Latest Optimized — Active Selection (${selCount}/${totCount} commits)`,
      sourceBadge: 'Latest Optimized · Live Radar',
      repoFullName: repo,
      timestampLabel: 'Active now',
      commitsLabel: `${selCount}/${totCount} commits`,
      performanceBefore: m.performanceBefore,
      performanceAfter: m.performanceAfter,
      accessibilityBefore: m.accessibilityBefore,
      accessibilityAfter: m.accessibilityAfter,
      lcpBefore: lcp.before,
      lcpAfter: lcp.after,
      clsBefore: cls.before,
      clsAfter: cls.after,
      fidBefore: fid.before,
      fidAfter: fid.after,
      wcagBefore: wcag.before,
      wcagAfter: wcag.after,
    };

    const staticCount = Math.max(1, Math.min(totCount, Math.ceil(totCount * 0.6)));
    const staticOption: RadarComparableRunOption = {
      id: 'run-static-pass',
      title: `Run 1 — Initial Static Audit (${staticCount}/${totCount} core commits)`,
      sourceBadge: 'Run 1 · Static Analysis',
      repoFullName: repo,
      timestampLabel: 'Initial Pass',
      commitsLabel: `${staticCount}/${totCount} commits`,
      performanceBefore: m.performanceBefore,
      performanceAfter: Math.min(96, m.performanceBefore + Math.round((95 - m.performanceBefore) * 0.62)),
      accessibilityBefore: m.accessibilityBefore,
      accessibilityAfter: Math.min(97, m.accessibilityBefore + Math.round((98 - m.accessibilityBefore) * 0.64)),
      lcpBefore: lcp.before,
      lcpAfter: Math.min(95, lcp.before + 22),
      clsBefore: cls.before,
      clsAfter: Math.min(96, cls.before + 20),
      fidBefore: fid.before,
      fidAfter: Math.min(94, fid.before + 18),
      wcagBefore: wcag.before,
      wcagAfter: Math.min(96, wcag.before + 19),
    };

    const lhrOption: RadarComparableRunOption = {
      id: 'run-lhr-full',
      title: `Run 2 — Full Lighthouse LHR Suite (${totCount}/${totCount} commits)`,
      sourceBadge: 'Run 2 · Headless Chromium + LHR',
      repoFullName: repo,
      timestampLabel: 'Full LHR Benchmark',
      commitsLabel: `${totCount}/${totCount} commits`,
      performanceBefore: m.performanceBefore,
      performanceAfter: 96,
      accessibilityBefore: m.accessibilityBefore,
      accessibilityAfter: 98,
      lcpBefore: lcp.before,
      lcpAfter: 95,
      clsBefore: cls.before,
      clsAfter: 97,
      fidBefore: fid.before,
      fidAfter: 94,
      wcagBefore: wcag.before,
      wcagAfter: 97,
    };

    const formatDateShort = (iso?: string) => {
      if (!iso) return 'Saved snapshot';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'Saved snapshot';
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const savedOptions: RadarComparableRunOption[] = saved.map((rec, idx) => {
      const perfGainRatio =
        rec.performanceAfter > rec.performanceBefore
          ? (rec.performanceAfter - rec.performanceBefore) /
            Math.max(1, 96 - rec.performanceBefore)
          : 0.65;
      const a11yGainRatio =
        rec.accessibilityAfter > rec.accessibilityBefore
          ? (rec.accessibilityAfter - rec.accessibilityBefore) /
            Math.max(1, 98 - rec.accessibilityBefore)
          : 0.7;

      const phaseTag = rec.runPhase === 'lhr' ? 'Run 2 LHR' : 'Run 1 Static';
      const dateStr = formatDateShort(rec.updatedAtIso);

      return {
        id: `saved-${rec.auditId || idx}`,
        title: `Saved #${idx + 1}: ${rec.repoFullName} (${phaseTag} · ${dateStr})`,
        sourceBadge: 'Firestore Saved History',
        repoFullName: rec.repoFullName,
        timestampLabel: dateStr,
        commitsLabel: `${rec.selectedCommitsCount}/${rec.totalCommitsCount} commits`,
        performanceBefore: rec.performanceBefore,
        performanceAfter: rec.performanceAfter,
        accessibilityBefore: rec.accessibilityBefore,
        accessibilityAfter: rec.accessibilityAfter,
        lcpBefore: 56,
        lcpAfter: Math.min(97, Math.round(56 + perfGainRatio * 39)),
        clsBefore: 63,
        clsAfter: Math.min(98, Math.round(63 + perfGainRatio * 34)),
        fidBefore: 62,
        fidAfter: Math.min(95, Math.round(62 + perfGainRatio * 32)),
        wcagBefore: 66,
        wcagAfter: Math.min(98, Math.round(66 + a11yGainRatio * 31)),
      };
    });

    return [initialBaselineOption, activeOption, staticOption, lhrOption, ...savedOptions];
  });

  readonly selectedCompareRunA = computed<RadarComparableRunOption>(() => {
    const opts = this.comparableRunOptions();
    const id = this.compareRunAId();
    return opts.find((o) => o.id === id) ?? opts[0];
  });

  readonly selectedCompareRunB = computed<RadarComparableRunOption>(() => {
    const opts = this.comparableRunOptions();
    const id = this.compareRunBId();
    return opts.find((o) => o.id === id) ?? opts[1] ?? opts[0];
  });

  readonly compareAxisRows = computed<RadarCompareAxisRow[]>(() => {
    const a = this.selectedCompareRunA();
    const b = this.selectedCompareRunB();

    const makeRow = (
      id: string,
      label: string,
      shortLabel: string,
      description: string,
      aBefore: number,
      aAfter: number,
      bBefore: number,
      bAfter: number
    ): RadarCompareAxisRow => {
      const aGain = Math.max(0, aAfter - aBefore);
      const bGain = Math.max(0, bAfter - bBefore);
      return {
        id,
        label,
        shortLabel,
        description,
        baseline: Math.round((aBefore + bBefore) / 2),
        runABefore: aBefore,
        runAAfter: aAfter,
        runAGain: aGain,
        runBBefore: bBefore,
        runBAfter: bAfter,
        runBGain: bGain,
        afterDelta: bAfter - aAfter,
        gainDelta: bGain - aGain,
      };
    };

    return [
      makeRow(
        'lcp',
        'LCP (Largest Contentful Paint)',
        'LCP',
        'Compares hero image preload, fetchpriority="high", and critical rendering path speed between Run A and Run B.',
        a.lcpBefore,
        a.lcpAfter,
        b.lcpBefore,
        b.lcpAfter
      ),
      makeRow(
        'cls',
        'CLS (Cumulative Layout Shift)',
        'CLS',
        'Compares visual stability and layout shift elimination across intrinsic media dimensions and font-display rules.',
        a.clsBefore,
        a.clsAfter,
        b.clsBefore,
        b.clsAfter
      ),
      makeRow(
        'fid',
        'FID / INP (First Input Delay)',
        'FID',
        'Compares main-thread responsiveness and input latency reduction between the two selected audit runs.',
        a.fidBefore,
        a.fidAfter,
        b.fidBefore,
        b.fidAfter
      ),
      makeRow(
        'performance-score',
        'Performance Score',
        'Performance',
        'Compares overall Lighthouse Performance scores and net points gained between Audit Run A and Audit Run B.',
        a.performanceBefore,
        a.performanceAfter,
        b.performanceBefore,
        b.performanceAfter
      ),
      makeRow(
        'accessibility-score',
        'Accessibility Score',
        'Accessibility',
        'Compares overall Lighthouse Accessibility scores and semantic remediation gains between Audit Run A and Audit Run B.',
        a.accessibilityBefore,
        a.accessibilityAfter,
        b.accessibilityBefore,
        b.accessibilityAfter
      ),
      makeRow(
        'wcag-aria',
        'WCAG Contrast & ARIA Semantics',
        'WCAG & ARIA',
        'Compares WCAG 2.2 AA contrast ratio compliance, ARIA labeling, and keyboard focus navigation between both runs.',
        a.wcagBefore,
        a.wcagAfter,
        b.wcagBefore,
        b.wcagAfter
      ),
    ];
  });

  readonly focusedCompareAxis = computed<RadarCompareAxisRow | null>(() => {
    const rows = this.compareAxisRows();
    const hovered = this.hoveredAxisId();
    if (hovered) {
      return rows.find((r) => r.id === hovered) ?? rows[0] ?? null;
    }
    return rows[0] ?? null;
  });

  /**
   * Builds 3 chronological trajectory stages for the repository combining
   * historical Firestore snapshots and the active session metrics.
   */
  readonly historySessions = computed<HistoryTrajectorySession[]>(() => {
    const m = this.metrics();
    const firestoreList = this.repoFirestoreSessions();
    const selCount = this.selectedCount();
    const totCount = this.totalCount();

    const getDetailedAxis = (id: string, fallbackBefore: number, fallbackAfter: number) => {
      const axis = m.detailedAxes.find((a) => a.id === id);
      return {
        before: axis?.before ?? fallbackBefore,
        after: axis?.after ?? fallbackAfter,
      };
    };

    const lcp = getDetailedAxis('lcp', 56, 94);
    const cls = getDetailedAxis('cls', 63, 96);
    const fid = getDetailedAxis('fid', 62, 93);
    const wcag = getDetailedAxis('wcag-aria', 66, 96);

    const formatDateShort = (iso?: string, fallback = 'Past session') => {
      if (!iso) return fallback;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return fallback;
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const mapFirestoreRecordToSession = (
      rec: SavedAuditHistoryRecord,
      slotKey: 'session1' | 'session2',
      fallbackTitle: string
    ): HistoryTrajectorySession => {
      const perfGainRatio =
        rec.performanceAfter > rec.performanceBefore
          ? (rec.performanceAfter - rec.performanceBefore) /
            Math.max(1, 96 - rec.performanceBefore)
          : 0.65;
      const a11yGainRatio =
        rec.accessibilityAfter > rec.accessibilityBefore
          ? (rec.accessibilityAfter - rec.accessibilityBefore) /
            Math.max(1, 98 - rec.accessibilityBefore)
          : 0.7;

      return {
        id: `hist-${slotKey}-${rec.auditId}`,
        slotKey,
        title: fallbackTitle,
        sourceBadge:
          rec.runPhase === 'lhr' ? 'Firestore · Run 2 LHR' : 'Firestore · Run 1 Static',
        isFirestoreBacked: true,
        timestampLabel: formatDateShort(rec.updatedAtIso),
        commitsLabel: `${rec.selectedCommitsCount}/${rec.totalCommitsCount} commits`,
        performanceScore: rec.performanceAfter,
        accessibilityScore: rec.accessibilityAfter,
        lcpScore: Math.min(97, Math.round(lcp.before + perfGainRatio * 38)),
        clsScore: Math.min(98, Math.round(cls.before + perfGainRatio * 33)),
        fidScore: Math.min(95, Math.round(fid.before + perfGainRatio * 31)),
        wcagAriaScore: Math.min(98, Math.round(wcag.before + a11yGainRatio * 30)),
      };
    };

    const session1: HistoryTrajectorySession =
      firestoreList.length >= 2
        ? mapFirestoreRecordToSession(
            firestoreList[0],
            'session1',
            'Earliest Firestore Audit'
          )
        : {
            id: 'hist-session1-baseline',
            slotKey: 'session1',
            title: 'Initial Baseline Audit',
            sourceBadge: 'Run 0 · Unpatched Baseline',
            isFirestoreBacked: false,
            timestampLabel: 'Initial scan',
            commitsLabel: `0/${totCount} commits`,
            performanceScore: m.performanceBefore,
            accessibilityScore: m.accessibilityBefore,
            lcpScore: lcp.before,
            clsScore: cls.before,
            fidScore: fid.before,
            wcagAriaScore: wcag.before,
          };

    const latestFirestore =
      firestoreList.length >= 1 ? firestoreList[firestoreList.length - 1] : null;

    const session2: HistoryTrajectorySession = latestFirestore
      ? mapFirestoreRecordToSession(
          latestFirestore,
          'session2',
          'Saved Firestore Snapshot'
        )
      : {
          id: 'hist-session2-intermediate',
          slotKey: 'session2',
          title: 'Prior Static Audit Pass',
          sourceBadge: 'Run 1 · Core Fixes',
          isFirestoreBacked: false,
          timestampLabel: 'Previous run',
          commitsLabel: `${Math.max(1, Math.floor(totCount * 0.6))}/${totCount} commits`,
          performanceScore: Math.round(
            m.performanceBefore + (m.performanceAfter - m.performanceBefore) * 0.62
          ),
          accessibilityScore: Math.round(
            m.accessibilityBefore + (m.accessibilityAfter - m.accessibilityBefore) * 0.64
          ),
          lcpScore: Math.round(lcp.before + (lcp.after - lcp.before) * 0.62),
          clsScore: Math.round(cls.before + (cls.after - cls.before) * 0.6),
          fidScore: Math.round(fid.before + (fid.after - fid.before) * 0.58),
          wcagAriaScore: Math.round(wcag.before + (wcag.after - wcag.before) * 0.65),
        };

    const session3: HistoryTrajectorySession = {
      id: 'hist-session3-current',
      slotKey: 'session3',
      title: 'Current Active Session',
      sourceBadge: 'Live Report Projection',
      isFirestoreBacked: false,
      timestampLabel: 'Active now',
      commitsLabel: `${selCount}/${totCount} commits`,
      performanceScore: m.performanceAfter,
      accessibilityScore: m.accessibilityAfter,
      lcpScore: lcp.after,
      clsScore: cls.after,
      fidScore: fid.after,
      wcagAriaScore: wcag.after,
    };

    return [session1, session2, session3];
  });

  readonly historyAxisRows = computed<HistoryTrajectoryAxisRow[]>(() => {
    const sessions = this.historySessions();
    if (sessions.length < 3) return [];
    const [s1, s2, s3] = sessions;

    const makeRow = (
      id: string,
      label: string,
      shortLabel: string,
      description: string,
      v1: number,
      v2: number,
      v3: number
    ): HistoryTrajectoryAxisRow => ({
      id,
      label,
      shortLabel,
      description,
      s1: v1,
      s2: v2,
      s3: v3,
      totalGain: Math.max(0, v3 - v1),
    });

    return [
      makeRow(
        'lcp',
        'LCP (Largest Contentful Paint)',
        'LCP',
        'Multi-session trajectory for Largest Contentful Paint resource prioritization and hero image decoding.',
        s1.lcpScore,
        s2.lcpScore,
        s3.lcpScore
      ),
      makeRow(
        'cls',
        'CLS (Cumulative Layout Shift)',
        'CLS',
        'Historical layout stability progression across intrinsic media dimensions and font-display: swap.',
        s1.clsScore,
        s2.clsScore,
        s3.clsScore
      ),
      makeRow(
        'fid',
        'FID / INP (First Input Delay)',
        'FID',
        'Main-thread responsiveness trajectory across past audit sessions after eliminating render-blocking assets.',
        s1.fidScore,
        s2.fidScore,
        s3.fidScore
      ),
      makeRow(
        'performance-score',
        'Performance Score',
        'Performance',
        'Overall Lighthouse Performance trajectory from initial repository baseline through saved Firestore sessions.',
        s1.performanceScore,
        s2.performanceScore,
        s3.performanceScore
      ),
      makeRow(
        'accessibility-score',
        'Accessibility Score',
        'Accessibility',
        'Overall Lighthouse Accessibility score trajectory across saved Firestore audit runs.',
        s1.accessibilityScore,
        s2.accessibilityScore,
        s3.accessibilityScore
      ),
      makeRow(
        'wcag-aria',
        'WCAG Contrast & ARIA Semantics',
        'WCAG & ARIA',
        'Historical compliance trajectory for WCAG 2.2 AA contrast ratios, ARIA labels, and landmark structure.',
        s1.wcagAriaScore,
        s2.wcagAriaScore,
        s3.wcagAriaScore
      ),
    ];
  });

  readonly focusedHistoryAxis = computed<HistoryTrajectoryAxisRow | null>(() => {
    const rows = this.historyAxisRows();
    const hovered = this.hoveredAxisId();
    if (hovered) {
      return rows.find((r) => r.id === hovered) ?? rows[0] ?? null;
    }
    return rows[0] ?? null;
  });

  private isViewReady = false;
  private reactRoot: Root | null = null;

  constructor() {
    effect(() => {
      const extMode = this.externalViewMode();
      if (extMode && extMode !== this.viewMode()) {
        this.viewMode.set(extMode);
        if (extMode === 'history' || extMode === 'compare') {
          this.refreshHistory.emit();
        }
        this.triggerEntranceAnimation();
      }
    });

    effect(() => {
      const catTab = this.activeCategoryTab();
      if (this.isViewReady && catTab !== this.lastCategoryTab) {
        this.lastCategoryTab = catTab;
        if (catTab === 'performance' && this.viewMode() !== 'categories') {
          this.hoveredAxisId.set('lcp');
        } else if (catTab === 'accessibility' && this.viewMode() !== 'categories') {
          this.hoveredAxisId.set('accessibility-score');
        } else if (catTab !== 'all' && this.viewMode() === 'categories') {
          this.hoveredAxisId.set(`cat-${catTab}`);
        }
        this.triggerEntranceAnimation();
      }
    });

    effect(() => {
      const mode = this.viewMode();
      const trendOn = this.isTrendAnalysisEnabled();
      const trendPoints = this.activeTrendPoints();
      const focusedIdx = this.focusedTrendPoint().auditIndex;
      const metricFilter = this.trendMetricFilter();
      const dateRange = this.trendDateRange();
      const axes = this.activeAxes();
      const histRows = this.historyAxisRows();
      const histSessions = this.historySessions();
      const compareRows = this.compareAxisRows();
      const runA = this.selectedCompareRunA();
      const runB = this.selectedCompareRunB();
      const selCount = this.selectedCount();
      const cycle = this.animCycle();

      if (!this.isViewReady) return;

      this.renderRechartsRadar(
        mode,
        axes,
        histRows,
        histSessions,
        compareRows,
        runA,
        runB,
        selCount,
        cycle
      );

      if (mode === 'history' && trendOn) {
        this.renderD3TrendChart(trendPoints, focusedIdx, metricFilter, dateRange);
      }
    });
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    this.lastCategoryTab = this.activeCategoryTab();
    this.triggerEntranceAnimation();
    this.renderRechartsRadar(
      this.viewMode(),
      this.activeAxes(),
      this.historyAxisRows(),
      this.historySessions(),
      this.compareAxisRows(),
      this.selectedCompareRunA(),
      this.selectedCompareRunB(),
      this.selectedCount(),
      this.animCycle()
    );
    if (this.viewMode() === 'history' && this.isTrendAnalysisEnabled()) {
      this.renderD3TrendChart(
        this.activeTrendPoints(),
        this.focusedTrendPoint().auditIndex,
        this.trendMetricFilter(),
        this.trendDateRange()
      );
    }
  }

  ngOnDestroy(): void {
    if (this.enterTimer) {
      clearTimeout(this.enterTimer);
      this.enterTimer = null;
    }
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
  }

  setViewMode(mode: 'detailed' | 'categories' | 'history' | 'compare'): void {
    if (mode === 'history' || mode === 'compare') {
      this.refreshHistory.emit();
    }
    if (mode === 'compare') {
      this.isCompareDrawerOpen.set(true);
    }
    this.viewModeChanged.emit(mode);
    if (this.viewMode() === mode) {
      this.triggerEntranceAnimation();
      return;
    }
    this.viewMode.set(mode);
    this.hoveredAxisId.set(null);
    this.triggerEntranceAnimation();
  }

  toggleTrendAnalysis(): void {
    this.isTrendAnalysisEnabled.update((v) => !v);
    this.triggerEntranceAnimation();
  }

  setTrendAnalysis(enabled: boolean): void {
    if (this.isTrendAnalysisEnabled() === enabled) return;
    this.isTrendAnalysisEnabled.set(enabled);
    this.triggerEntranceAnimation();
  }

  setTrendScope(scope: 'all-sessions' | 'last-5'): void {
    if (this.trendScope() === scope) return;
    this.trendScope.set(scope);
    this.hoveredTrendIndex.set(null);
    this.triggerEntranceAnimation();
  }

  setTrendDateRange(range: TrendDateRange): void {
    if (this.trendDateRange() === range) return;
    this.trendDateRange.set(range);
    this.hoveredTrendIndex.set(null);
    this.triggerEntranceAnimation();
  }

  onSelectTrendMetric(event: Event): void {
    const val = (event.target as HTMLSelectElement | null)?.value as TrendMetricFilter | undefined;
    if (val && val !== this.trendMetricFilter()) {
      this.trendMetricFilter.set(val);
      this.triggerEntranceAnimation();
    }
  }

  onTriggerAutoCompare(): void {
    this.syncSignificantPairIds();
    this.autoCompareRequested.emit();
  }

  private syncSignificantPairIds(): void {
    const opts = this.comparableRunOptions();
    if (opts.length < 2) return;

    const savedOpts = opts.filter((o) => o.id.startsWith('saved-'));
    if (savedOpts.length >= 2) {
      const sorted = [...savedOpts].sort(
        (a, b) =>
          a.performanceAfter +
          a.accessibilityAfter -
          (b.performanceAfter + b.accessibilityAfter)
      );
      this.compareRunAId.set(sorted[0].id);
      this.compareRunBId.set(sorted[sorted.length - 1].id);
    } else {
      const initialOpt =
        opts.find((o) => o.id === 'run-initial-scan') ??
        opts.find((o) => o.id === 'run-static-pass') ??
        opts[0];
      const latestOpt =
        savedOpts[0] ??
        opts.find((o) => o.id === 'run-lhr-full') ??
        opts.find((o) => o.id === 'run-active-current') ??
        opts[1];
      this.compareRunAId.set(initialOpt.id);
      this.compareRunBId.set(
        latestOpt.id !== initialOpt.id ? latestOpt.id : opts[1].id
      );
    }
  }

  /**
   * Identifies the two most significant audit runs (initial scan vs. latest optimized version)
   * and selects them in the radar comparison view.
   */
  autoSelectSignificantPairInRadar(): void {
    this.syncSignificantPairIds();
    this.isCompareDrawerOpen.set(true);
    this.viewMode.set('compare');
    this.triggerEntranceAnimation();
  }

  toggleCompareDrawer(): void {
    if (this.viewMode() === 'compare' && this.isCompareDrawerOpen()) {
      this.isCompareDrawerOpen.set(false);
      this.viewMode.set('detailed');
      this.triggerEntranceAnimation();
      return;
    }
    this.isCompareDrawerOpen.set(true);
    this.setViewMode('compare');
  }

  onSelectCompareRunA(event: Event): void {
    const val = (event.target as HTMLSelectElement | null)?.value;
    if (val) {
      this.compareRunAId.set(val);
      this.viewMode.set('compare');
      this.triggerEntranceAnimation();
    }
  }

  onSelectCompareRunB(event: Event): void {
    const val = (event.target as HTMLSelectElement | null)?.value;
    if (val) {
      this.compareRunBId.set(val);
      this.viewMode.set('compare');
      this.triggerEntranceAnimation();
    }
  }

  swapCompareRuns(): void {
    const currentA = this.selectedCompareRunA().id;
    const currentB = this.selectedCompareRunB().id;
    this.compareRunAId.set(currentB);
    this.compareRunBId.set(currentA);
    this.viewMode.set('compare');
    this.triggerEntranceAnimation();
  }

  onRefreshHistory(): void {
    this.refreshHistory.emit();
    this.triggerEntranceAnimation();
  }

  triggerEntranceAnimation(): void {
    if (this.enterTimer) {
      clearTimeout(this.enterTimer);
    }
    this.isEntering.set(false);
    this.animCycle.update((n) => n + 1);
    setTimeout(() => {
      this.isEntering.set(true);
      this.enterTimer = setTimeout(() => {
        this.isEntering.set(false);
      }, 720);
    }, 16);
  }

  /**
   * Uses D3 (d3-scale, d3-shape, d3-selection) to plot historical score trajectories
   * (Core Web Vitals LCP/CLS/FID, Performance, Accessibility, SEO, or Best Practices)
   * filtered by the user's selected date range (30/60/90 days or All Time).
   */
  private renderD3TrendChart(
    points: FiveAuditTrendPoint[],
    highlightedAuditIndex: number,
    metricFilter: TrendMetricFilter,
    dateRange: TrendDateRange
  ): void {
    const hostEl = this.d3TrendContainer?.nativeElement;
    if (!hostEl || typeof window === 'undefined' || points.length === 0) return;

    const root = d3.select(hostEl);
    root.selectAll('*').remove();

    const width = 430;
    const height = 315;
    const margin = { top: 28, right: 34, bottom: 44, left: 38 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = root
      .append('svg')
      .attr('class', 'd3-trend-svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const defs = svg.append('defs');

    const addAreaGrad = (id: string, color: string, topOpacity: number) => {
      const grad = defs
        .append('linearGradient')
        .attr('id', id)
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '0%')
        .attr('y2', '100%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', topOpacity);
      grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0.01);
    };

    addAreaGrad('d3-lcp-area-grad', '#0ea5e9', 0.24);
    addAreaGrad('d3-cls-area-grad', '#10b981', 0.18);
    addAreaGrad('d3-fid-area-grad', '#8b5cf6', 0.16);
    addAreaGrad('d3-seo-area-grad', '#f59e0b', 0.24);
    addAreaGrad('d3-perf-area-grad', '#0284c7', 0.24);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scalePoint<number>()
      .domain(points.map((d) => d.auditIndex))
      .range([0, innerWidth])
      .padding(0.15);

    const yScale = d3.scaleLinear().domain([45, 100]).range([innerHeight, 0]);

    // Good 90+ target band
    const goodBandTop = yScale(100);
    const goodBandBottom = yScale(90);
    g.append('rect')
      .attr('x', 0)
      .attr('y', goodBandTop)
      .attr('width', innerWidth)
      .attr('height', Math.max(0, goodBandBottom - goodBandTop))
      .attr('rx', 6)
      .attr('fill', '#10b981')
      .attr('fill-opacity', 0.08);

    g.append('text')
      .attr('x', 6)
      .attr('y', goodBandBottom - 4)
      .attr('fill', '#10b981')
      .attr('font-size', '8.2px')
      .attr('font-weight', '700')
      .text(this.activeTrendMetricMeta().targetZoneText);

    // Date-range badge in top-right of chart
    g.append('text')
      .attr('x', innerWidth - 4)
      .attr('y', -10)
      .attr('text-anchor', 'end')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '8.5px')
      .attr('font-family', 'var(--font-mono)')
      .attr('font-weight', '600')
      .text(dateRange === 'all' ? 'Range: All time' : `Window: Last ${dateRange}d`);

    // Horizontal grid lines
    const yTicks = [50, 60, 70, 80, 90, 100];
    yTicks.forEach((tickVal) => {
      const yPos = yScale(tickVal);
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', yPos)
        .attr('y2', yPos)
        .attr('stroke', 'var(--border-card)')
        .attr('stroke-dasharray', tickVal === 90 ? '4 2' : '2 3')
        .attr('stroke-width', tickVal === 90 ? 1.2 : 0.8);

      g.append('text')
        .attr('x', -8)
        .attr('y', yPos + 3)
        .attr('text-anchor', 'end')
        .attr('fill', 'var(--text-muted)')
        .attr('font-size', '9px')
        .attr('font-family', 'var(--font-mono)')
        .text(String(tickVal));
    });

    // Vertical audit columns & X-axis labels
    const totalPts = points.length;
    const compactLabels = totalPts > 6;
    points.forEach((pt, idx) => {
      const xPos = xScale(pt.auditIndex) ?? 0;
      const isFocused = pt.auditIndex === highlightedAuditIndex;
      const isLast = idx === totalPts - 1;

      g.append('line')
        .attr('x1', xPos)
        .attr('x2', xPos)
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr(
          'stroke',
          isFocused
            ? 'var(--accent-primary)'
            : pt.isFirestoreBacked
              ? 'rgba(14, 165, 233, 0.35)'
              : 'var(--border-hairline)'
        )
        .attr('stroke-width', isFocused ? 1.6 : 1)
        .attr('stroke-dasharray', isFocused ? 'none' : '2 3');

      const topAxisLabel = compactLabels ? `S${idx + 1}` : pt.shortLabel;
      g.append('text')
        .attr('x', xPos)
        .attr('y', innerHeight + 17)
        .attr('text-anchor', 'middle')
        .attr('fill', isFocused ? 'var(--text-main)' : 'var(--text-body)')
        .attr('font-size', compactLabels ? '9px' : '10px')
        .attr('font-weight', isFocused ? '700' : '600')
        .text(topAxisLabel);

      const subAxisLabel = isLast
        ? 'Today'
        : pt.daysAgo === 0
          ? 'Today'
          : `${pt.daysAgo}d ago`;

      g.append('text')
        .attr('x', xPos)
        .attr('y', innerHeight + 30)
        .attr('text-anchor', 'middle')
        .attr('fill', pt.isFirestoreBacked ? '#0284c7' : 'var(--text-muted)')
        .attr('font-size', '8px')
        .attr('font-family', 'var(--font-mono)')
        .text(subAxisLabel);
    });

    const makeArea = (accessor: (d: FiveAuditTrendPoint) => number) =>
      d3
        .area<FiveAuditTrendPoint>()
        .x((d) => xScale(d.auditIndex) ?? 0)
        .y0(innerHeight)
        .y1((d) => yScale(accessor(d)))
        .curve(d3.curveMonotoneX);

    const makeLine = (accessor: (d: FiveAuditTrendPoint) => number) =>
      d3
        .line<FiveAuditTrendPoint>()
        .x((d) => xScale(d.auditIndex) ?? 0)
        .y((d) => yScale(accessor(d)))
        .curve(d3.curveMonotoneX);

    const first = points[0];
    const last = points[points.length - 1];
    const xFirst = xScale(first.auditIndex) ?? 0;
    const xLast = xScale(last.auditIndex) ?? innerWidth;

    if (metricFilter === 'all-cwv') {
      g.append('path').datum(points).attr('fill', 'url(#d3-lcp-area-grad)').attr('d', makeArea((d) => d.lcpScore));
      g.append('path').datum(points).attr('fill', 'url(#d3-cls-area-grad)').attr('d', makeArea((d) => d.clsScore));
      g.append('path').datum(points).attr('fill', 'url(#d3-fid-area-grad)').attr('d', makeArea((d) => d.fidScore));

      const seriesList: {
        id: string;
        color: string;
        strokeWidth: number;
        dash?: string;
        accessor: (d: FiveAuditTrendPoint) => number;
      }[] = [
        { id: 'perf', color: 'var(--accent-primary)', strokeWidth: 1.9, dash: '4 3', accessor: (d) => d.performanceScore },
        { id: 'fid', color: '#8b5cf6', strokeWidth: 2.4, accessor: (d) => d.fidScore },
        { id: 'cls', color: '#10b981', strokeWidth: 2.5, accessor: (d) => d.clsScore },
        { id: 'lcp', color: '#0ea5e9', strokeWidth: 2.8, accessor: (d) => d.lcpScore },
      ];

      seriesList.forEach((s) => {
        g.append('path')
          .datum(points)
          .attr('fill', 'none')
          .attr('stroke', s.color)
          .attr('stroke-width', s.strokeWidth)
          .attr('stroke-dasharray', s.dash ?? 'none')
          .attr('stroke-linecap', 'round')
          .attr('d', makeLine(s.accessor));

        points.forEach((pt) => {
          const cx = xScale(pt.auditIndex) ?? 0;
          const cy = yScale(s.accessor(pt));
          const isHighlighted = pt.auditIndex === highlightedAuditIndex;

          g.append('circle')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', isHighlighted ? 5.2 : pt.isFirestoreBacked ? 4.1 : 3.5)
            .attr('fill', s.color)
            .attr('stroke', 'var(--bg-card)')
            .attr('stroke-width', 1.5)
            .style('cursor', 'pointer')
            .on('mouseenter', () => {
              this.hoveredTrendIndex.set(pt.auditIndex);
            });
        });
      });

      // Core Web Vitals endpoint callouts
      g.append('text')
        .attr('x', xFirst + 4)
        .attr('y', yScale(first.lcpScore) + 13)
        .attr('fill', '#0284c7')
        .attr('font-size', '8.5px')
        .attr('font-weight', '700')
        .attr('font-family', 'var(--font-mono)')
        .text(`LCP ${first.lcpSeconds}s`);

      g.append('text')
        .attr('x', xFirst + 4)
        .attr('y', yScale(first.clsScore) - 7)
        .attr('fill', '#059669')
        .attr('font-size', '8.5px')
        .attr('font-weight', '700')
        .attr('font-family', 'var(--font-mono)')
        .text(`CLS ${first.clsValue}`);

      g.append('text')
        .attr('x', xFirst + 4)
        .attr('y', yScale(first.fidScore) + 3)
        .attr('fill', '#7c3aed')
        .attr('font-size', '8.5px')
        .attr('font-weight', '700')
        .attr('font-family', 'var(--font-mono)')
        .text(`FID ${first.inpMs}ms`);

      g.append('text')
        .attr('x', xLast - 4)
        .attr('y', yScale(last.lcpScore) + 14)
        .attr('text-anchor', 'end')
        .attr('fill', '#0284c7')
        .attr('font-size', '8.6px')
        .attr('font-weight', '700')
        .attr('font-family', 'var(--font-mono)')
        .text(`LCP ${last.lcpSeconds}s (+${last.lcpScore - first.lcpScore})`);

      g.append('text')
        .attr('x', xLast - 4)
        .attr('y', Math.max(11, yScale(last.clsScore) - 7))
        .attr('text-anchor', 'end')
        .attr('fill', '#059669')
        .attr('font-size', '8.6px')
        .attr('font-weight', '700')
        .attr('font-family', 'var(--font-mono)')
        .text(`CLS ${last.clsValue} (+${last.clsScore - first.clsScore})`);

      g.append('text')
        .attr('x', xLast - 4)
        .attr('y', Math.min(innerHeight - 4, yScale(last.fidScore) + 25))
        .attr('text-anchor', 'end')
        .attr('fill', '#7c3aed')
        .attr('font-size', '8.6px')
        .attr('font-weight', '700')
        .attr('font-family', 'var(--font-mono)')
        .text(`FID ${last.inpMs}ms (+${last.fidScore - first.fidScore})`);
      return;
    }

    // Focused Single-Metric Trajectory Mode (Performance, Accessibility, SEO, or Best Practices)
    const metricConfigMap: Record<
      Exclude<TrendMetricFilter, 'all-cwv'>,
      {
        shortTag: string;
        color: string;
        gradId: string;
        accessor: (d: FiveAuditTrendPoint) => number;
      }
    > = {
      performance: {
        shortTag: 'Perf',
        color: '#0284c7',
        gradId: 'url(#d3-perf-area-grad)',
        accessor: (d) => d.performanceScore,
      },
      accessibility: {
        shortTag: 'A11y',
        color: '#10b981',
        gradId: 'url(#d3-cls-area-grad)',
        accessor: (d) => d.accessibilityScore,
      },
      seo: {
        shortTag: 'SEO',
        color: '#f59e0b',
        gradId: 'url(#d3-seo-area-grad)',
        accessor: (d) => d.seoScore,
      },
      'best-practices': {
        shortTag: 'BP',
        color: '#8b5cf6',
        gradId: 'url(#d3-fid-area-grad)',
        accessor: (d) => d.bestPracticesScore,
      },
    };

    const cfg = metricConfigMap[metricFilter];

    // Subtle secondary baseline reference curve (Performance when viewing another metric, or LCP when viewing Performance)
    const refAccessor =
      metricFilter === 'performance'
        ? (d: FiveAuditTrendPoint) => d.lcpScore
        : (d: FiveAuditTrendPoint) => d.performanceScore;
    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', 'var(--text-muted)')
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', 1.4)
      .attr('stroke-dasharray', '4 3')
      .attr('d', makeLine(refAccessor));

    // Area + Main Trajectory Line
    g.append('path').datum(points).attr('fill', cfg.gradId).attr('d', makeArea(cfg.accessor));
    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', cfg.color)
      .attr('stroke-width', 3.1)
      .attr('stroke-linecap', 'round')
      .attr('d', makeLine(cfg.accessor));

    // Data points + direct score labels above each point
    points.forEach((pt, idx) => {
      const cx = xScale(pt.auditIndex) ?? 0;
      const val = cfg.accessor(pt);
      const cy = yScale(val);
      const isHighlighted = pt.auditIndex === highlightedAuditIndex;

      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', isHighlighted ? 6 : 4.5)
        .attr('fill', cfg.color)
        .attr('stroke', 'var(--bg-card)')
        .attr('stroke-width', 1.8)
        .style('cursor', 'pointer')
        .on('mouseenter', () => {
          this.hoveredTrendIndex.set(pt.auditIndex);
        });

      const isLast = idx === points.length - 1;
      const labelTxt = isLast
        ? `${cfg.shortTag} ${val} (+${val - cfg.accessor(first)})`
        : `${val}`;

      g.append('text')
        .attr('x', isLast ? cx - 4 : cx)
        .attr('y', Math.max(12, cy - 10))
        .attr('text-anchor', isLast ? 'end' : 'middle')
        .attr('fill', cfg.color)
        .attr('font-size', isLast ? '9.2px' : '8.6px')
        .attr('font-weight', '700')
        .attr('font-family', 'var(--font-mono)')
        .text(labelTxt);
    });
  }

  private renderRechartsRadar(
    mode: 'detailed' | 'categories' | 'history' | 'compare',
    axes: RadarMetricAxis[],
    historyRows: HistoryTrajectoryAxisRow[],
    historySessions: HistoryTrajectorySession[],
    compareRows: RadarCompareAxisRow[],
    compareRunA: RadarComparableRunOption,
    compareRunB: RadarComparableRunOption,
    selectedCount: number,
    cycle: number
  ): void {
    const hostEl = this.radarContainer?.nativeElement;
    if (!hostEl || typeof window === 'undefined') return;

    if (!this.reactRoot) {
      this.reactRoot = createRoot(hostEl);
    }

    if (mode === 'compare') {
      if (compareRows.length < 3) return;

      const compareData: RechartsRadarDatum[] = compareRows.map((row) => ({
        id: row.id,
        metric: `${row.shortLabel} (${row.runAAfter} vs ${row.runBAfter})`,
        fullLabel: row.label,
        before: row.baseline,
        after: row.runBAfter,
        delta: row.afterDelta,
        runAAfter: row.runAAfter,
        runBAfter: row.runBAfter,
        runAGain: row.runAGain,
        runBGain: row.runBGain,
        fullMark: 100,
      }));

      const compareRadarElement = React.createElement(
        RadarChart,
        {
          width: 390,
          height: 320,
          cx: '50%',
          cy: '52%',
          outerRadius: 102,
          data: compareData,
        },
        React.createElement(PolarGrid, {
          stroke: 'var(--border-card)',
          strokeDasharray: '3 3',
        }),
        React.createElement(PolarAngleAxis, {
          dataKey: 'metric',
          tick: {
            fill: 'var(--text-main)',
            fontSize: 10.5,
            fontWeight: 600,
          },
        }),
        React.createElement(PolarRadiusAxis, {
          angle: 90,
          domain: [0, 100],
          tickCount: 5,
          tick: {
            fill: 'var(--text-muted)',
            fontSize: 9,
          },
        }),
        React.createElement(Radar, {
          key: `radar-cmp-base-${cycle}`,
          name: 'Unpatched Baseline',
          dataKey: 'before',
          stroke: '#94a3b8',
          strokeWidth: 1.5,
          strokeDasharray: '5 4',
          fill: '#94a3b8',
          fillOpacity: 0.12,
          isAnimationActive: true,
          animationBegin: 15,
          animationDuration: 500,
          animationEasing: 'ease-out',
        }),
        React.createElement(Radar, {
          key: `radar-cmp-a-${cycle}`,
          name: `Run A: ${compareRunA.title}`,
          dataKey: 'runAAfter',
          stroke: '#0ea5e9',
          strokeWidth: 2.2,
          strokeDasharray: '3 2',
          fill: '#0ea5e9',
          fillOpacity: 0.2,
          dot: {
            r: 3.5,
            fill: '#0ea5e9',
            stroke: 'var(--bg-card)',
            strokeWidth: 1.4,
          },
          isAnimationActive: true,
          animationBegin: 55,
          animationDuration: 600,
          animationEasing: 'ease-out',
        }),
        React.createElement(Radar, {
          key: `radar-cmp-b-${cycle}`,
          name: `Run B: ${compareRunB.title}`,
          dataKey: 'runBAfter',
          stroke: 'var(--accent-primary)',
          strokeWidth: 2.6,
          fill: 'var(--accent-primary)',
          fillOpacity: 0.25,
          dot: {
            r: 4,
            fill: 'var(--accent-primary)',
            stroke: 'var(--bg-card)',
            strokeWidth: 1.5,
          },
          isAnimationActive: true,
          animationBegin: 100,
          animationDuration: 680,
          animationEasing: 'ease-out',
        }),
        React.createElement(Tooltip, {
          contentStyle: {
            borderRadius: '14px',
            border: '1px solid var(--border-card)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--text-main)',
            fontSize: '12px',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
          },
        }),
        React.createElement(Legend, {
          wrapperStyle: {
            fontSize: '11px',
            paddingTop: '6px',
          },
        })
      );

      this.reactRoot.render(compareRadarElement);
      return;
    }

    if (mode === 'history') {
      if (historyRows.length < 3 || historySessions.length < 3) return;
      const [s1, s2, s3] = historySessions;

      const historyData: RechartsRadarDatum[] = historyRows.map((row) => ({
        id: row.id,
        metric: `${row.shortLabel} (${row.s3})`,
        fullLabel: row.label,
        before: row.s1,
        after: row.s3,
        delta: row.totalGain,
        session1: row.s1,
        session2: row.s2,
        session3: row.s3,
        fullMark: 100,
      }));

      const historyRadarElement = React.createElement(
        RadarChart,
        {
          width: 390,
          height: 320,
          cx: '50%',
          cy: '52%',
          outerRadius: 104,
          data: historyData,
        },
        React.createElement(PolarGrid, {
          stroke: 'var(--border-card)',
          strokeDasharray: '3 3',
        }),
        React.createElement(PolarAngleAxis, {
          dataKey: 'metric',
          tick: {
            fill: 'var(--text-main)',
            fontSize: 11,
            fontWeight: 600,
          },
        }),
        React.createElement(PolarRadiusAxis, {
          angle: 90,
          domain: [0, 100],
          tickCount: 5,
          tick: {
            fill: 'var(--text-muted)',
            fontSize: 9,
          },
        }),
        React.createElement(Radar, {
          key: `radar-hist-s1-${cycle}`,
          name: `1. ${s1.title}`,
          dataKey: 'session1',
          stroke: '#94a3b8',
          strokeWidth: 1.6,
          strokeDasharray: '5 4',
          fill: '#94a3b8',
          fillOpacity: 0.14,
          isAnimationActive: true,
          animationBegin: 15,
          animationDuration: 520,
          animationEasing: 'ease-out',
        }),
        React.createElement(Radar, {
          key: `radar-hist-s2-${cycle}`,
          name: `2. ${s2.title}`,
          dataKey: 'session2',
          stroke: '#0ea5e9',
          strokeWidth: 2,
          strokeDasharray: '3 2',
          fill: '#0ea5e9',
          fillOpacity: 0.18,
          isAnimationActive: true,
          animationBegin: 65,
          animationDuration: 600,
          animationEasing: 'ease-out',
        }),
        React.createElement(Radar, {
          key: `radar-hist-s3-${cycle}`,
          name: `3. ${s3.title}`,
          dataKey: 'session3',
          stroke: 'var(--accent-primary)',
          strokeWidth: 2.6,
          fill: 'var(--accent-primary)',
          fillOpacity: 0.25,
          dot: {
            r: 4,
            fill: 'var(--accent-primary)',
            stroke: 'var(--bg-card)',
            strokeWidth: 1.5,
          },
          isAnimationActive: true,
          animationBegin: 115,
          animationDuration: 680,
          animationEasing: 'ease-out',
        }),
        React.createElement(Tooltip, {
          contentStyle: {
            borderRadius: '14px',
            border: '1px solid var(--border-card)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--text-main)',
            fontSize: '12px',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
          },
        }),
        React.createElement(Legend, {
          wrapperStyle: {
            fontSize: '11px',
            paddingTop: '6px',
          },
        })
      );

      this.reactRoot.render(historyRadarElement);
      return;
    }

    if (axes.length < 3) return;

    const chartData: RechartsRadarDatum[] = axes.map((axis) => ({
      id: axis.id,
      metric: `${axis.shortLabel} (${axis.after})`,
      fullLabel: axis.label,
      before: axis.before,
      after: axis.after,
      delta: axis.delta,
      fullMark: 100,
    }));

    const radarElement = React.createElement(
      RadarChart,
      {
        width: 390,
        height: 320,
        cx: '50%',
        cy: '52%',
        outerRadius: 104,
        data: chartData,
      },
      React.createElement(PolarGrid, {
        stroke: 'var(--border-card)',
        strokeDasharray: '3 3',
      }),
      React.createElement(PolarAngleAxis, {
        dataKey: 'metric',
        tick: {
          fill: 'var(--text-main)',
          fontSize: 11,
          fontWeight: 600,
        },
      }),
      React.createElement(PolarRadiusAxis, {
        angle: 90,
        domain: [0, 100],
        tickCount: 5,
        tick: {
          fill: 'var(--text-muted)',
          fontSize: 9,
        },
      }),
      React.createElement(Radar, {
        key: `radar-before-${mode}-${cycle}`,
        name: 'Before (Baseline)',
        dataKey: 'before',
        stroke: '#94a3b8',
        strokeWidth: 1.8,
        strokeDasharray: '5 4',
        fill: '#94a3b8',
        fillOpacity: 0.18,
        isAnimationActive: true,
        animationBegin: 20,
        animationDuration: 560,
        animationEasing: 'ease-out',
      }),
      React.createElement(Radar, {
        key: `radar-after-${mode}-${cycle}`,
        name: `After (${selectedCount} Selected Commits)`,
        dataKey: 'after',
        stroke: 'var(--accent-primary)',
        strokeWidth: 2.5,
        fill: 'var(--accent-primary)',
        fillOpacity: 0.26,
        dot: {
          r: 4,
          fill: 'var(--accent-primary)',
          stroke: 'var(--bg-card)',
          strokeWidth: 1.5,
        },
        isAnimationActive: true,
        animationBegin: 70,
        animationDuration: 680,
        animationEasing: 'ease-out',
      }),
      React.createElement(Tooltip, {
        contentStyle: {
          borderRadius: '14px',
          border: '1px solid var(--border-card)',
          backgroundColor: 'var(--bg-card)',
          color: 'var(--text-main)',
          fontSize: '12px',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
        },
      }),
      React.createElement(Legend, {
        wrapperStyle: {
          fontSize: '11px',
          paddingTop: '6px',
        },
      })
    );

    this.reactRoot.render(radarElement);
  }
}
