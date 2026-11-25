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
import { FormsModule } from '@angular/forms';
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
  AuditRunPhase,
  AuditSession,
  SavedAuditHistoryRecord,
} from '../../models/audit.model';
import { buildRadarComparisonDeltaPdf } from '../../utils/comparison-pdf.util';

export interface ComparableAuditRun {
  id: string;
  label: string;
  badge: string;
  significanceTag?: 'Initial Scan' | 'Latest Optimized';
  sourceType: 'initial-baseline' | 'current' | 'paired-run' | 'firestore';
  repoFullName: string;
  runPhase: AuditRunPhase;
  timestampIso?: string;
  timestampLabel: string;
  selectedCommitsCount: number;
  totalCommitsCount: number;
  performanceBefore: number;
  performanceAfter: number;
  accessibilityBefore: number;
  accessibilityAfter: number;
  bestPracticesBefore: number;
  bestPracticesAfter: number;
  seoBefore: number;
  seoAfter: number;
  lcpBefore: number;
  lcpAfter: number;
  clsBefore: number;
  clsAfter: number;
  fidBefore: number;
  fidAfter: number;
  wcagAriaBefore: number;
  wcagAriaAfter: number;
  summaryNotes: string;
}

export interface MetricComparisonRow {
  id: string;
  label: string;
  shortLabel: string;
  category: 'performance' | 'accessibility' | 'secondary';
  runABefore: number;
  runAAfter: number;
  runAGain: number;
  runBBefore: number;
  runBAfter: number;
  runBGain: number;
  afterDiff: number;
  gainDiff: number;
}

@Component({
  selector: 'app-audit-run-comparison',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="run-compare-section"
      class="run-compare-card"
      [class.is-expanded]="isExpanded()"
      aria-labelledby="run-compare-heading"
    >
      <div class="run-compare-card__header">
        <div class="run-compare-card__title-group">
          <div class="run-compare-card__eyebrow">
            <span class="soft-pill soft-pill--accent">Expandable radar comparison view</span>
            <span class="run-compare-count-pill">
              {{ availableRuns().length }} history runs available
            </span>
            @if (isAutoComparedActive()) {
              <span class="auto-compare-active-pill">
                ⚡ Auto-Compare: Initial Scan vs. Latest Optimized
              </span>
            }
          </div>
          <h2 id="run-compare-heading" class="run-compare-card__title">
            Compare two audit runs side-by-side with Recharts radar charts
          </h2>
          <p class="run-compare-card__subtitle">
            Select any two audit runs from your history—or click <strong>Auto-Compare</strong> to automatically pair the initial scan against the latest optimized version—and visualize their before-vs-after Performance and Accessibility radar polygons side-by-side.
          </p>
        </div>

        <div class="run-compare-card__header-actions">
          <button
            type="button"
            id="comparison-auto-compare-btn"
            class="export-pill-btn export-pill-btn--primary"
            (click)="runAutoCompare()"
            title="Identify the initial scan and latest optimized version and compare them side-by-side"
          >
            <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
              <path d="M9.8 2.2L4.2 10h4.6l-.6 5.8 5.6-7.8H9.2l.6-5.8z" stroke-linejoin="round" />
            </svg>
            <span>Auto-Compare (Initial vs. Latest)</span>
          </button>

          @if (isExpanded()) {
            <button
              type="button"
              id="download-comparison-pdf-btn"
              class="export-pill-btn export-pill-btn--pdf-compare"
              [class.is-exporting]="isDownloadingComparisonPdf()"
              [class.is-exported]="!isDownloadingComparisonPdf() && justDownloadedComparisonPdf()"
              [disabled]="!runA() || !runB() || isDownloadingComparisonPdf()"
              [attr.aria-busy]="isDownloadingComparisonPdf()"
              (click)="downloadComparisonPdf()"
              title="Generate and download a single-page vector PDF showing the radar chart delta between Audit Run A and Audit Run B"
            >
              @if (isDownloadingComparisonPdf()) {
                <span class="export-generating-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" fill="none">
                    <circle class="export-generating-icon__track" cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.6" />
                    <path class="export-generating-icon__orbit" d="M10 2a8 8 0 0 1 7.6 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    <path class="export-generating-icon__doc" d="M7.2 6.2h3.8l2 2v5.6a.6.6 0 0 1-.6.6H7.2a.6.6 0 0 1-.6-.6V6.8a.6.6 0 0 1 .6-.6z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" />
                  </svg>
                </span>
                <span>Generating Comparison PDF · {{ comparisonPdfProgress() }}%</span>
                <span
                  class="export-btn-progress"
                  role="progressbar"
                  aria-label="Comparison PDF export progress"
                  [attr.aria-valuenow]="comparisonPdfProgress()"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <span class="export-btn-progress__fill" [style.width.%]="comparisonPdfProgress()"></span>
                </span>
              } @else if (justDownloadedComparisonPdf()) {
                <svg class="export-btn-check" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M4.2 9.4l3.1 3.1 6.5-6.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span>Comparison PDF Ready</span>
              } @else {
                <span class="file-type-indicator file-type-indicator--pdf" aria-hidden="true">
                  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path d="M4.2 2.5h6.4l3.2 3.2v9.8a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z" stroke-linejoin="round" />
                    <path d="M10.5 2.5v3.3h3.3" stroke-linejoin="round" />
                    <path d="M5.8 11.2h6.4M5.8 13.5h4.2" stroke-linecap="round" />
                  </svg>
                  <span class="file-type-indicator__ext">.PDF</span>
                </span>
                <span>Download Comparison PDF</span>
              }
            </button>

            <button
              type="button"
              class="export-pill-btn"
              (click)="swapRuns()"
              title="Swap Audit Run A and Audit Run B"
            >
              <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
                <path d="M4 6.5h10M11 3.5l3 3-3 3M14 11.5H4M7 8.5l-3 3 3 3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span>Swap runs</span>
            </button>
          }

          <button
            type="button"
            class="export-pill-btn"
            [class.export-pill-btn--primary]="isExpanded()"
            [attr.aria-expanded]="isExpanded()"
            aria-controls="run-compare-panel-body"
            (click)="toggleExpanded.emit()"
          >
            <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
              <rect x="2.5" y="3.2" width="5.5" height="11.6" rx="1.4" />
              <rect x="10" y="3.2" width="5.5" height="11.6" rx="1.4" />
            </svg>
            <span>{{ isExpanded() ? 'Collapse comparison' : 'Compare two runs' }}</span>
          </button>
        </div>
      </div>

      @if (isExpanded()) {
        <div id="run-compare-panel-body" class="run-compare-body">
          @if (comparisonPdfNotice(); as pdfNote) {
            <div class="auto-compare-banner comparison-pdf-banner" role="status" aria-live="polite">
              <div class="auto-compare-banner__main">
                <span class="file-type-indicator file-type-indicator--pdf">.PDF</span>
                <span class="auto-compare-banner__text">{{ pdfNote }}</span>
              </div>
              <button
                type="button"
                class="text-action-btn"
                (click)="dismissComparisonPdfNotice()"
              >
                Dismiss
              </button>
            </div>
          }

          @if (autoCompareNotice(); as notice) {
            <div class="auto-compare-banner" role="status" aria-live="polite">
              <div class="auto-compare-banner__main">
                <span class="auto-compare-banner__badge">Auto-Compare Active</span>
                <span class="auto-compare-banner__text">{{ notice }}</span>
              </div>
              <button
                type="button"
                class="text-action-btn"
                (click)="dismissAutoCompareNotice()"
              >
                Dismiss
              </button>
            </div>
          }

          <!-- Two Run Selectors (Run A & Run B) -->
          <div class="run-selectors-grid">
            <!-- Run A Selector -->
            <div class="run-selector-box run-selector-box--a">
              <div class="run-selector-box__top">
                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                  <span class="run-slot-badge run-slot-badge--a">Audit Run A · Left Radar</span>
                  @if (runA()?.significanceTag; as sigA) {
                    <span class="d3-significance-pill d3-significance-pill--initial">{{ sigA }}</span>
                  }
                </div>
                @if (runA(); as a) {
                  <span class="run-source-tag">{{ a.badge }}</span>
                }
              </div>
              <label for="compare-run-a-select" class="sr-only">Select Audit Run A</label>
              <select
                id="compare-run-a-select"
                class="run-select-input"
                [ngModel]="selectedRunAId()"
                (ngModelChange)="onSelectRunA($event)"
              >
                @for (item of availableRuns(); track item.id) {
                  <option [value]="item.id">
                    {{ item.label }} ({{ item.repoFullName }} · Perf {{ item.performanceBefore }}→{{ item.performanceAfter }}, A11y {{ item.accessibilityBefore }}→{{ item.accessibilityAfter }})
                  </option>
                }
              </select>
              @if (runA(); as a) {
                <div class="run-selector-box__meta">
                  <span><strong>{{ a.repoFullName }}</strong></span>
                  <span>·</span>
                  <span>{{ a.selectedCommitsCount }}/{{ a.totalCommitsCount }} commits</span>
                  <span>·</span>
                  <span>{{ a.timestampLabel }}</span>
                </div>
              }
            </div>

            <!-- Run B Selector -->
            <div class="run-selector-box run-selector-box--b">
              <div class="run-selector-box__top">
                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                  <span class="run-slot-badge run-slot-badge--b">Audit Run B · Right Radar</span>
                  @if (runB()?.significanceTag; as sigB) {
                    <span class="d3-significance-pill d3-significance-pill--latest">{{ sigB }}</span>
                  }
                </div>
                @if (runB(); as b) {
                  <span class="run-source-tag run-source-tag--accent">{{ b.badge }}</span>
                }
              </div>
              <label for="compare-run-b-select" class="sr-only">Select Audit Run B</label>
              <select
                id="compare-run-b-select"
                class="run-select-input"
                [ngModel]="selectedRunBId()"
                (ngModelChange)="onSelectRunB($event)"
              >
                @for (item of availableRuns(); track item.id) {
                  <option [value]="item.id">
                    {{ item.label }} ({{ item.repoFullName }} · Perf {{ item.performanceBefore }}→{{ item.performanceAfter }}, A11y {{ item.accessibilityBefore }}→{{ item.accessibilityAfter }})
                  </option>
                }
              </select>
              @if (runB(); as b) {
                <div class="run-selector-box__meta">
                  <span><strong>{{ b.repoFullName }}</strong></span>
                  <span>·</span>
                  <span>{{ b.selectedCommitsCount }}/{{ b.totalCommitsCount }} commits</span>
                  <span>·</span>
                  <span>{{ b.timestampLabel }}</span>
                </div>
              }
            </div>
          </div>

          @if (runA() && runB(); as bothReady) {
            @let a = runA()!;
            @let b = runB()!;
            @let perfGainA = a.performanceAfter - a.performanceBefore;
            @let perfGainB = b.performanceAfter - b.performanceBefore;
            @let perfAfterDiff = b.performanceAfter - a.performanceAfter;
            @let perfGainDiff = perfGainB - perfGainA;

            @let a11yGainA = a.accessibilityAfter - a.accessibilityBefore;
            @let a11yGainB = b.accessibilityAfter - b.accessibilityBefore;
            @let a11yAfterDiff = b.accessibilityAfter - a.accessibilityAfter;
            @let a11yGainDiff = a11yGainB - a11yGainA;

            @let lcpAfterDiff = b.lcpAfter - a.lcpAfter;
            @let clsAfterDiff = b.clsAfter - a.clsAfter;
            @let fidAfterDiff = b.fidAfter - a.fidAfter;

            <!-- Core Web Vitals (LCP, CLS, FID) Immediate Side-by-Side Visualization Strip -->
            <div class="cwv-trend-summary-grid" role="region" aria-label="LCP, CLS, and FID side-by-side comparison between Run A and Run B">
              <div class="cwv-trend-kpi cwv-trend-kpi--lcp">
                <div class="cwv-trend-kpi__top">
                  <span class="cwv-trend-kpi__tag">LCP · Largest Contentful Paint</span>
                  <span class="cwv-trend-kpi__gain">{{ lcpAfterDiff >= 0 ? '+' : '' }}{{ lcpAfterDiff }} pts (B vs A)</span>
                </div>
                <div class="cwv-trend-kpi__values">
                  <span class="cwv-trend-kpi__before">Run A: {{ a.lcpAfter }}</span>
                  <span aria-hidden="true">→</span>
                  <strong class="cwv-trend-kpi__after">Run B: {{ b.lcpAfter }}</strong>
                  <span class="cwv-trend-kpi__sub">
                    (Baseline {{ a.lcpBefore }} → Optimized {{ b.lcpAfter }})
                  </span>
                </div>
              </div>

              <div class="cwv-trend-kpi cwv-trend-kpi--cls">
                <div class="cwv-trend-kpi__top">
                  <span class="cwv-trend-kpi__tag">CLS · Cumulative Layout Shift</span>
                  <span class="cwv-trend-kpi__gain">{{ clsAfterDiff >= 0 ? '+' : '' }}{{ clsAfterDiff }} pts (B vs A)</span>
                </div>
                <div class="cwv-trend-kpi__values">
                  <span class="cwv-trend-kpi__before">Run A: {{ a.clsAfter }}</span>
                  <span aria-hidden="true">→</span>
                  <strong class="cwv-trend-kpi__after">Run B: {{ b.clsAfter }}</strong>
                  <span class="cwv-trend-kpi__sub">
                    (Baseline {{ a.clsBefore }} → Optimized {{ b.clsAfter }})
                  </span>
                </div>
              </div>

              <div class="cwv-trend-kpi cwv-trend-kpi--fid">
                <div class="cwv-trend-kpi__top">
                  <span class="cwv-trend-kpi__tag">FID · First Input Delay</span>
                  <span class="cwv-trend-kpi__gain">{{ fidAfterDiff >= 0 ? '+' : '' }}{{ fidAfterDiff }} pts (B vs A)</span>
                </div>
                <div class="cwv-trend-kpi__values">
                  <span class="cwv-trend-kpi__before">Run A: {{ a.fidAfter }}</span>
                  <span aria-hidden="true">→</span>
                  <strong class="cwv-trend-kpi__after">Run B: {{ b.fidAfter }}</strong>
                  <span class="cwv-trend-kpi__sub">
                    (Baseline {{ a.fidBefore }} → Optimized {{ b.fidAfter }})
                  </span>
                </div>
              </div>
            </div>

            <!-- SIDE-BY-SIDE RECHARTS RADAR CHARTS (RUN A RADAR VS RUN B RADAR) -->
            <div class="compare-radars-grid" role="region" aria-label="Side-by-side Recharts radar charts comparing Audit Run A and Audit Run B">
              <!-- Left Radar Chart: Audit Run A (Before vs After) -->
              <div class="compare-radar-panel compare-radar-panel--a">
                <div class="compare-radar-panel__head">
                  <div>
                    <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                      <span class="run-slot-badge run-slot-badge--a">Audit Run A</span>
                      @if (a.significanceTag) {
                        <span class="d3-significance-pill d3-significance-pill--initial">{{ a.significanceTag }}</span>
                      }
                    </div>
                    <h3 class="compare-radar-panel__title">{{ a.label }}</h3>
                    <span class="compare-radar-panel__sub">
                      {{ a.repoFullName }} · {{ a.selectedCommitsCount }}/{{ a.totalCommitsCount }} commits · {{ a.timestampLabel }}
                    </span>
                  </div>
                  <div class="compare-radar-panel__kpis">
                    <span class="history-metric-pill">
                      Perf: <strong>{{ a.performanceBefore }}→{{ a.performanceAfter }}</strong> (+{{ perfGainA }})
                    </span>
                    <span class="history-metric-pill">
                      A11y: <strong>{{ a.accessibilityBefore }}→{{ a.accessibilityAfter }}</strong> (+{{ a11yGainA }})
                    </span>
                  </div>
                </div>

                <div
                  #radarHostA
                  class="compare-radar-host recharts-host-container"
                  role="img"
                  [attr.aria-label]="'Recharts radar chart for Audit Run A: ' + a.label"
                ></div>
              </div>

              <!-- Right Radar Chart: Audit Run B (Before vs After) -->
              <div class="compare-radar-panel compare-radar-panel--b">
                <div class="compare-radar-panel__head">
                  <div>
                    <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                      <span class="run-slot-badge run-slot-badge--b">Audit Run B</span>
                      @if (b.significanceTag) {
                        <span class="d3-significance-pill d3-significance-pill--latest">{{ b.significanceTag }}</span>
                      }
                    </div>
                    <h3 class="compare-radar-panel__title">{{ b.label }}</h3>
                    <span class="compare-radar-panel__sub">
                      {{ b.repoFullName }} · {{ b.selectedCommitsCount }}/{{ b.totalCommitsCount }} commits · {{ b.timestampLabel }}
                    </span>
                  </div>
                  <div class="compare-radar-panel__kpis">
                    <span class="history-metric-pill">
                      Perf: <strong>{{ b.performanceBefore }}→{{ b.performanceAfter }}</strong> (+{{ perfGainB }})
                    </span>
                    <span class="history-metric-pill">
                      A11y: <strong>{{ b.accessibilityBefore }}→{{ b.accessibilityAfter }}</strong> (+{{ a11yGainB }})
                    </span>
                  </div>
                </div>

                <div
                  #radarHostB
                  class="compare-radar-host recharts-host-container"
                  role="img"
                  [attr.aria-label]="'Recharts radar chart for Audit Run B: ' + b.label"
                ></div>
              </div>
            </div>

            <!-- Side-by-Side Primary Performance & Accessibility Score Cards -->
            <div class="compare-primary-grid">
              <!-- Performance Comparison Card -->
              <article class="compare-pillar-card" aria-label="Performance score side-by-side comparison">
                <div class="compare-pillar-card__head">
                  <div>
                    <span class="compare-pillar-card__eyebrow">Core Web Vitals &amp; asset delivery</span>
                    <h3 class="compare-pillar-card__title">Performance improvement</h3>
                  </div>
                  <span
                    class="compare-delta-badge"
                    [class.is-positive]="perfAfterDiff > 0"
                    [class.is-negative]="perfAfterDiff < 0"
                  >
                    @if (perfAfterDiff > 0) {
                      Run B +{{ perfAfterDiff }} pts higher ({{ perfGainDiff >= 0 ? '+' + perfGainDiff : perfGainDiff }} gain)
                    } @else if (perfAfterDiff < 0) {
                      Run A +{{ -perfAfterDiff }} pts higher
                    } @else {
                      Equal final score ({{ b.performanceAfter }} pts)
                    }
                  </span>
                </div>

                <div class="compare-dual-columns">
                  <div class="compare-run-col compare-run-col--a">
                    <span class="compare-run-col__tag">Run A · {{ a.badge }}</span>
                    <div class="compare-run-col__scores">
                      <span class="score-before">{{ a.performanceBefore }}</span>
                      <span class="score-arrow" aria-hidden="true">→</span>
                      <span class="score-after">{{ a.performanceAfter }}</span>
                      <span class="score-gain">+{{ perfGainA }} pts</span>
                    </div>
                    <div class="compare-bar-track" aria-hidden="true">
                      <div class="compare-bar-before" [style.width.%]="a.performanceBefore"></div>
                      <div class="compare-bar-after compare-bar-after--a" [style.width.%]="a.performanceAfter"></div>
                    </div>
                  </div>

                  <div class="compare-run-col compare-run-col--b">
                    <span class="compare-run-col__tag">Run B · {{ b.badge }}</span>
                    <div class="compare-run-col__scores">
                      <span class="score-before">{{ b.performanceBefore }}</span>
                      <span class="score-arrow" aria-hidden="true">→</span>
                      <span class="score-after">{{ b.performanceAfter }}</span>
                      <span class="score-gain score-gain--accent">+{{ perfGainB }} pts</span>
                    </div>
                    <div class="compare-bar-track" aria-hidden="true">
                      <div class="compare-bar-before" [style.width.%]="b.performanceBefore"></div>
                      <div class="compare-bar-after compare-bar-after--b" [style.width.%]="b.performanceAfter"></div>
                    </div>
                  </div>
                </div>
              </article>

              <!-- Accessibility Comparison Card -->
              <article class="compare-pillar-card" aria-label="Accessibility score side-by-side comparison">
                <div class="compare-pillar-card__head">
                  <div>
                    <span class="compare-pillar-card__eyebrow">WCAG 2.2 AA, ARIA &amp; keyboard focus</span>
                    <h3 class="compare-pillar-card__title">Accessibility improvement</h3>
                  </div>
                  <span
                    class="compare-delta-badge"
                    [class.is-positive]="a11yAfterDiff > 0"
                    [class.is-negative]="a11yAfterDiff < 0"
                  >
                    @if (a11yAfterDiff > 0) {
                      Run B +{{ a11yAfterDiff }} pts higher ({{ a11yGainDiff >= 0 ? '+' + a11yGainDiff : a11yGainDiff }} gain)
                    } @else if (a11yAfterDiff < 0) {
                      Run A +{{ -a11yAfterDiff }} pts higher
                    } @else {
                      Equal final score ({{ b.accessibilityAfter }} pts)
                    }
                  </span>
                </div>

                <div class="compare-dual-columns">
                  <div class="compare-run-col compare-run-col--a">
                    <span class="compare-run-col__tag">Run A · {{ a.badge }}</span>
                    <div class="compare-run-col__scores">
                      <span class="score-before">{{ a.accessibilityBefore }}</span>
                      <span class="score-arrow" aria-hidden="true">→</span>
                      <span class="score-after">{{ a.accessibilityAfter }}</span>
                      <span class="score-gain">+{{ a11yGainA }} pts</span>
                    </div>
                    <div class="compare-bar-track" aria-hidden="true">
                      <div class="compare-bar-before" [style.width.%]="a.accessibilityBefore"></div>
                      <div class="compare-bar-after compare-bar-after--a" [style.width.%]="a.accessibilityAfter"></div>
                    </div>
                  </div>

                  <div class="compare-run-col compare-run-col--b">
                    <span class="compare-run-col__tag">Run B · {{ b.badge }}</span>
                    <div class="compare-run-col__scores">
                      <span class="score-before">{{ b.accessibilityBefore }}</span>
                      <span class="score-arrow" aria-hidden="true">→</span>
                      <span class="score-after">{{ b.accessibilityAfter }}</span>
                      <span class="score-gain score-gain--accent">+{{ a11yGainB }} pts</span>
                    </div>
                    <div class="compare-bar-track" aria-hidden="true">
                      <div class="compare-bar-before" [style.width.%]="b.accessibilityBefore"></div>
                      <div class="compare-bar-after compare-bar-after--b" [style.width.%]="b.accessibilityAfter"></div>
                    </div>
                  </div>
                </div>
              </article>
            </div>

            <!-- Granular Metric Breakdown Table (LCP, CLS, FID, Accessibility, WCAG/ARIA, Best Practices, SEO) -->
            <div class="compare-metrics-table-wrap" role="region" aria-label="Granular metric side-by-side comparison">
              <div class="compare-metrics-table-head">
                <span>Metric / Dimension</span>
                <span>Run A ({{ a.badge }})</span>
                <span>Run B ({{ b.badge }})</span>
                <span>Run B vs. Run A</span>
              </div>

              <ul class="compare-metrics-rows">
                @for (row of comparisonRows(); track row.id) {
                  <li class="compare-metric-row">
                    <div class="compare-metric-row__name">
                      <strong>{{ row.label }}</strong>
                      <span class="compare-metric-row__cat">{{ row.category }}</span>
                    </div>

                    <div class="compare-metric-row__cell">
                      <div class="compare-metric-row__nums">
                        <span class="num-before">{{ row.runABefore }}</span>
                        <span aria-hidden="true">→</span>
                        <strong class="num-after">{{ row.runAAfter }}</strong>
                        <span class="num-gain">(+{{ row.runAGain }})</span>
                      </div>
                      <div class="mini-compare-bar" aria-hidden="true">
                        <div class="mini-compare-bar__fill mini-compare-bar__fill--a" [style.width.%]="row.runAAfter"></div>
                      </div>
                    </div>

                    <div class="compare-metric-row__cell">
                      <div class="compare-metric-row__nums">
                        <span class="num-before">{{ row.runBBefore }}</span>
                        <span aria-hidden="true">→</span>
                        <strong class="num-after">{{ row.runBAfter }}</strong>
                        <span class="num-gain num-gain--b">(+{{ row.runBGain }})</span>
                      </div>
                      <div class="mini-compare-bar" aria-hidden="true">
                        <div class="mini-compare-bar__fill mini-compare-bar__fill--b" [style.width.%]="row.runBAfter"></div>
                      </div>
                    </div>

                    <div class="compare-metric-row__diff">
                      <span
                        class="diff-chip"
                        [class.diff-chip--pos]="row.afterDiff > 0"
                        [class.diff-chip--neg]="row.afterDiff < 0"
                      >
                        @if (row.afterDiff > 0) {
                          +{{ row.afterDiff }} pts (Run B)
                        } @else if (row.afterDiff < 0) {
                          +{{ -row.afterDiff }} pts (Run A)
                        } @else {
                          0 pts (Tie)
                        }
                      </span>
                    </div>
                  </li>
                }
              </ul>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class AuditRunComparisonComponent implements AfterViewInit, OnDestroy {
  readonly currentSession = input.required<AuditSession>();
  readonly currentMetrics = input.required<AuditImpactMetrics>();
  readonly selectedCommitsCount = input.required<number>();
  readonly totalCommitsCount = input.required<number>();
  readonly savedAudits = input<SavedAuditHistoryRecord[]>([]);
  readonly isExpanded = input<boolean>(false);
  readonly autoCompareNonce = input<number>(0);

  readonly toggleExpanded = output<void>();
  readonly requestExpand = output<void>();

  @ViewChild('radarHostA')
  private radarHostA?: ElementRef<HTMLDivElement>;

  @ViewChild('radarHostB')
  private radarHostB?: ElementRef<HTMLDivElement>;

  private reactRootA: Root | null = null;
  private reactRootB: Root | null = null;
  private isViewReady = false;
  private lastHandledNonce = 0;
  private comparisonExportedTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly animCycle = signal<number>(1);

  readonly selectedRunAId = signal<string>('');
  readonly selectedRunBId = signal<string>('');
  readonly isAutoComparedActive = signal<boolean>(false);
  readonly autoCompareNotice = signal<string | null>(null);
  readonly isDownloadingComparisonPdf = signal<boolean>(false);
  readonly justDownloadedComparisonPdf = signal<boolean>(false);
  readonly comparisonPdfNotice = signal<string | null>(null);

  /**
   * Builds the list of selectable audit runs combining:
   * 1. Initial Scan · Unpatched / Early Static Baseline Pass
   * 2. Current live session on the report page (Latest Optimized Version)
   * 3. Complementary Run 1 (Static Code Audit) / Run 2 (Lighthouse JSON LHR) benchmark pass
   * 4. All user-saved audit runs fetched from Firestore
   */
  readonly availableRuns = computed<ComparableAuditRun[]>(() => {
    const session = this.currentSession();
    const metrics = this.currentMetrics();
    const selCount = this.selectedCommitsCount();
    const totCount = this.totalCommitsCount();
    const saved = this.savedAudits();

    const getAxis = (id: string, fallbackBefore: number, fallbackAfter: number) => {
      const found = metrics.detailedAxes.find((a) => a.id === id);
      return {
        before: found?.before ?? fallbackBefore,
        after: found?.after ?? fallbackAfter,
      };
    };

    const lcp = getAxis('lcp', 56, 94);
    const cls = getAxis('cls', 63, 96);
    const fid = getAxis('fid', 62, 93);
    const wcag = getAxis('wcag-aria', 66, 96);

    const isCurrentLhr = session.runPhase === 'lhr';

    // Initial Scan option (representing the initial scan state)
    const initialScanRun: ComparableAuditRun = {
      id: 'initial-scan-baseline',
      label: 'Initial Scan · Unpatched Repository Baseline (Run 0)',
      badge: 'Initial Scan · Baseline',
      significanceTag: 'Initial Scan',
      sourceType: 'initial-baseline',
      repoFullName: session.repo.fullName,
      runPhase: 'static',
      timestampLabel: 'Initial scan',
      selectedCommitsCount: 0,
      totalCommitsCount: totCount,
      performanceBefore: metrics.performanceBefore,
      performanceAfter: metrics.performanceBefore + 6,
      accessibilityBefore: metrics.accessibilityBefore,
      accessibilityAfter: metrics.accessibilityBefore + 6,
      bestPracticesBefore: metrics.bestPracticesBefore,
      bestPracticesAfter: metrics.bestPracticesBefore + 4,
      seoBefore: metrics.seoBefore,
      seoAfter: metrics.seoBefore + 4,
      lcpBefore: lcp.before,
      lcpAfter: lcp.before + 7,
      clsBefore: cls.before,
      clsAfter: cls.before + 6,
      fidBefore: fid.before,
      fidAfter: fid.before + 5,
      wcagAriaBefore: wcag.before,
      wcagAriaAfter: wcag.before + 6,
      summaryNotes: 'Initial repository scan before atomic Core Web Vitals and WCAG remediation commits.',
    };

    const currentRun: ComparableAuditRun = {
      id: `current-active-${session.runPhase}`,
      label: isCurrentLhr
        ? 'Latest Optimized · Run 2 (Lighthouse JSON Audit)'
        : 'Current Session · Run 1 (Static Code Audit)',
      badge: isCurrentLhr ? 'Active Run 2 · LHR JSON' : 'Active Run 1 · Static',
      significanceTag: 'Latest Optimized',
      sourceType: 'current',
      repoFullName: session.repo.fullName,
      runPhase: session.runPhase,
      timestampLabel: 'Latest optimized session',
      selectedCommitsCount: selCount,
      totalCommitsCount: totCount,
      performanceBefore: metrics.performanceBefore,
      performanceAfter: metrics.performanceAfter,
      accessibilityBefore: metrics.accessibilityBefore,
      accessibilityAfter: metrics.accessibilityAfter,
      bestPracticesBefore: metrics.bestPracticesBefore,
      bestPracticesAfter: metrics.bestPracticesAfter,
      seoBefore: metrics.seoBefore,
      seoAfter: metrics.seoAfter,
      lcpBefore: lcp.before,
      lcpAfter: lcp.after,
      clsBefore: cls.before,
      clsAfter: cls.after,
      fidBefore: fid.before,
      fidAfter: fid.after,
      wcagAriaBefore: wcag.before,
      wcagAriaAfter: wcag.after,
      summaryNotes: `Active report selection (${selCount} of ${totCount} atomic commits enabled).`,
    };

    const complementaryRun: ComparableAuditRun = isCurrentLhr
      ? {
          id: 'paired-run-1-static',
          label: 'Run 1 · Static Code & Light Security Audit (Baseline Pass)',
          badge: 'Run 1 · Static Audit',
          sourceType: 'paired-run',
          repoFullName: session.repo.fullName,
          runPhase: 'static',
          timestampLabel: 'Run 1 baseline pass',
          selectedCommitsCount: Math.max(1, totCount - 1),
          totalCommitsCount: totCount,
          performanceBefore: 61,
          performanceAfter: 89,
          accessibilityBefore: 69,
          accessibilityAfter: 92,
          bestPracticesBefore: 76,
          bestPracticesAfter: 92,
          seoBefore: 78,
          seoAfter: 94,
          lcpBefore: 56,
          lcpAfter: 88,
          clsBefore: 63,
          clsAfter: 91,
          fidBefore: 62,
          fidAfter: 89,
          wcagAriaBefore: 66,
          wcagAriaAfter: 91,
          summaryNotes: 'Initial static source tree inspection before Lighthouse JSON selector correlation.',
        }
      : {
          id: 'paired-run-2-lhr',
          label: 'Run 2 · Lighthouse Result (LHR) JSON Targeted Audit (Latest Optimized)',
          badge: 'Run 2 · LHR JSON',
          significanceTag: 'Latest Optimized',
          sourceType: 'paired-run',
          repoFullName: session.repo.fullName,
          runPhase: 'lhr',
          timestampLabel: 'Run 2 LHR target pass',
          selectedCommitsCount: totCount,
          totalCommitsCount: totCount,
          performanceBefore: 64,
          performanceAfter: 96,
          accessibilityBefore: 72,
          accessibilityAfter: 98,
          bestPracticesBefore: 79,
          bestPracticesAfter: 96,
          seoBefore: 81,
          seoAfter: 98,
          lcpBefore: 58,
          lcpAfter: 96,
          clsBefore: 65,
          clsAfter: 98,
          fidBefore: 64,
          fidAfter: 95,
          wcagAriaBefore: 70,
          wcagAriaAfter: 98,
          summaryNotes: 'Second-pass audit correlated with failing Lighthouse JSON DOM selectors and metricSavings.',
        };

    const conservativeSubsetRun: ComparableAuditRun = {
      id: 'paired-critical-subset',
      label: 'Conservative Patch · Critical LCP & WCAG Contrast Commits Only',
      badge: 'Critical Subset (2 commits)',
      sourceType: 'paired-run',
      repoFullName: session.repo.fullName,
      runPhase: session.runPhase,
      timestampLabel: 'Minimal patch subset',
      selectedCommitsCount: Math.min(2, Math.max(1, totCount)),
      totalCommitsCount: totCount,
      performanceBefore: metrics.performanceBefore,
      performanceAfter: Math.round(metrics.performanceBefore + (96 - metrics.performanceBefore) * 0.52),
      accessibilityBefore: metrics.accessibilityBefore,
      accessibilityAfter: Math.round(metrics.accessibilityBefore + (98 - metrics.accessibilityBefore) * 0.55),
      bestPracticesBefore: metrics.bestPracticesBefore,
      bestPracticesAfter: metrics.bestPracticesBefore + 6,
      seoBefore: metrics.seoBefore,
      seoAfter: metrics.seoBefore + 5,
      lcpBefore: lcp.before,
      lcpAfter: Math.round(lcp.before + (96 - lcp.before) * 0.6),
      clsBefore: cls.before,
      clsAfter: Math.round(cls.before + (98 - cls.before) * 0.45),
      fidBefore: fid.before,
      fidAfter: Math.round(fid.before + (95 - fid.before) * 0.4),
      wcagAriaBefore: wcag.before,
      wcagAriaAfter: Math.round(wcag.before + (98 - wcag.before) * 0.55),
      summaryNotes: 'Minimal high-priority commit subset targeting only hero LCP and primary color contrast.',
    };

    // Sort saved Firestore records chronologically to tag earliest (Initial Scan) & latest (Latest Optimized)
    const sortedFirestore = [...saved].sort((a, b) =>
      String(a.updatedAtIso || '').localeCompare(String(b.updatedAtIso || ''))
    );
    const earliestFsId = sortedFirestore.length >= 2 ? sortedFirestore[0].auditId : null;
    const latestFsId =
      sortedFirestore.length >= 1
        ? sortedFirestore[sortedFirestore.length - 1].auditId
        : null;

    const firestoreRuns: ComparableAuditRun[] = saved.map((rec, index) => {
      const perfGainRatio =
        rec.performanceAfter > rec.performanceBefore
          ? (rec.performanceAfter - rec.performanceBefore) / Math.max(1, 96 - rec.performanceBefore)
          : 0.75;
      const a11yGainRatio =
        rec.accessibilityAfter > rec.accessibilityBefore
          ? (rec.accessibilityAfter - rec.accessibilityBefore) / Math.max(1, 98 - rec.accessibilityBefore)
          : 0.8;

      const shortDate = rec.updatedAtIso
        ? new Date(rec.updatedAtIso).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : `Saved #${index + 1}`;

      let significanceTag: ComparableAuditRun['significanceTag'];
      if (rec.auditId === earliestFsId) {
        significanceTag = 'Initial Scan';
      } else if (rec.auditId === latestFsId) {
        significanceTag = 'Latest Optimized';
      }

      return {
        id: `firestore-${rec.auditId}`,
        label: `Saved Firestore Run · ${rec.repoFullName} (${rec.runPhase === 'lhr' ? 'Run 2 LHR' : 'Run 1 Static'} · ${shortDate})`,
        badge: `Firestore · ${rec.runPhase === 'lhr' ? 'Run 2 LHR' : 'Run 1 Static'}`,
        significanceTag,
        sourceType: 'firestore',
        repoFullName: rec.repoFullName,
        runPhase: rec.runPhase,
        timestampIso: rec.updatedAtIso,
        timestampLabel: shortDate,
        selectedCommitsCount: rec.selectedCommitsCount,
        totalCommitsCount: rec.totalCommitsCount,
        performanceBefore: rec.performanceBefore,
        performanceAfter: rec.performanceAfter,
        accessibilityBefore: rec.accessibilityBefore,
        accessibilityAfter: rec.accessibilityAfter,
        bestPracticesBefore: rec.bestPracticesBefore,
        bestPracticesAfter: rec.bestPracticesAfter,
        seoBefore: rec.seoBefore,
        seoAfter: rec.seoAfter,
        lcpBefore: 56,
        lcpAfter: Math.min(98, Math.round(56 + perfGainRatio * 40)),
        clsBefore: 63,
        clsAfter: Math.min(98, Math.round(63 + perfGainRatio * 34)),
        fidBefore: 62,
        fidAfter: Math.min(96, Math.round(62 + perfGainRatio * 32)),
        wcagAriaBefore: 66,
        wcagAriaAfter: Math.min(98, Math.round(66 + a11yGainRatio * 31)),
        summaryNotes: rec.summaryNotes || `${rec.selectedCommitsCount}/${rec.totalCommitsCount} commits saved in Firestore.`,
      };
    });

    return [
      initialScanRun,
      currentRun,
      complementaryRun,
      conservativeSubsetRun,
      ...firestoreRuns,
    ];
  });

  readonly runA = computed<ComparableAuditRun | null>(() => {
    const runs = this.availableRuns();
    if (runs.length === 0) return null;
    const id = this.selectedRunAId();
    return runs.find((r) => r.id === id) ?? runs[0];
  });

  readonly runB = computed<ComparableAuditRun | null>(() => {
    const runs = this.availableRuns();
    if (runs.length === 0) return null;
    const id = this.selectedRunBId();
    return runs.find((r) => r.id === id) ?? runs[1] ?? runs[0];
  });

  readonly comparisonRows = computed<MetricComparisonRow[]>(() => {
    const a = this.runA();
    const b = this.runB();
    if (!a || !b) return [];

    const buildRow = (
      id: string,
      label: string,
      shortLabel: string,
      category: MetricComparisonRow['category'],
      aBefore: number,
      aAfter: number,
      bBefore: number,
      bAfter: number
    ): MetricComparisonRow => {
      const runAGain = Math.max(0, aAfter - aBefore);
      const runBGain = Math.max(0, bAfter - bBefore);
      return {
        id,
        label,
        shortLabel,
        category,
        runABefore: aBefore,
        runAAfter: aAfter,
        runAGain,
        runBBefore: bBefore,
        runBAfter: bAfter,
        runBGain,
        afterDiff: bAfter - aAfter,
        gainDiff: runBGain - runAGain,
      };
    };

    return [
      buildRow(
        'perf-overall',
        'Performance Score (Overall)',
        'Performance',
        'performance',
        a.performanceBefore,
        a.performanceAfter,
        b.performanceBefore,
        b.performanceAfter
      ),
      buildRow(
        'perf-lcp',
        'LCP (Largest Contentful Paint)',
        'LCP',
        'performance',
        a.lcpBefore,
        a.lcpAfter,
        b.lcpBefore,
        b.lcpAfter
      ),
      buildRow(
        'perf-cls',
        'CLS (Cumulative Layout Shift)',
        'CLS',
        'performance',
        a.clsBefore,
        a.clsAfter,
        b.clsBefore,
        b.clsAfter
      ),
      buildRow(
        'perf-fid',
        'FID / INP (First Input Delay)',
        'FID',
        'performance',
        a.fidBefore,
        a.fidAfter,
        b.fidBefore,
        b.fidAfter
      ),
      buildRow(
        'a11y-overall',
        'Accessibility Score (Overall)',
        'Accessibility',
        'accessibility',
        a.accessibilityBefore,
        a.accessibilityAfter,
        b.accessibilityBefore,
        b.accessibilityAfter
      ),
      buildRow(
        'a11y-wcag',
        'WCAG 2.2 AA Contrast & ARIA Semantics',
        'WCAG & ARIA',
        'accessibility',
        a.wcagAriaBefore,
        a.wcagAriaAfter,
        b.wcagAriaBefore,
        b.wcagAriaAfter
      ),
      buildRow(
        'bp-overall',
        'Best Practices Score',
        'Best Practices',
        'secondary',
        a.bestPracticesBefore,
        a.bestPracticesAfter,
        b.bestPracticesBefore,
        b.bestPracticesAfter
      ),
      buildRow(
        'seo-overall',
        'SEO Score',
        'SEO',
        'secondary',
        a.seoBefore,
        a.seoAfter,
        b.seoBefore,
        b.seoAfter
      ),
    ];
  });

  constructor() {
    effect(() => {
      const runs = this.availableRuns();
      if (runs.length === 0) return;

      const curA = this.selectedRunAId();
      const curB = this.selectedRunBId();

      if (!curA || !runs.some((r) => r.id === curA)) {
        this.selectedRunAId.set(runs[0].id);
      }
      if (!curB || !runs.some((r) => r.id === curB)) {
        const firestoreOption = runs.find((r) => r.sourceType === 'firestore');
        const fallbackB = firestoreOption ?? runs[1] ?? runs[0];
        this.selectedRunBId.set(fallbackB.id);
      }
    });

    // React to external Auto-Compare requests from the History list / drawer / modal / tab
    effect(() => {
      const nonce = this.autoCompareNonce();
      if (nonce > 0 && nonce !== this.lastHandledNonce) {
        this.lastHandledNonce = nonce;
        this.runAutoCompare(false);
      }
    });

    effect(() => {
      const expanded = this.isExpanded();
      const a = this.runA();
      const b = this.runB();
      const cycle = this.animCycle();
      if (expanded && a && b && this.isViewReady) {
        setTimeout(() => {
          this.renderSideBySideRadars(a, b, cycle);
        }, 0);
      }
    });
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    const a = this.runA();
    const b = this.runB();
    if (this.isExpanded() && a && b) {
      this.renderSideBySideRadars(a, b, this.animCycle());
    }
  }

  ngOnDestroy(): void {
    if (this.comparisonExportedTimer) {
      clearTimeout(this.comparisonExportedTimer);
      this.comparisonExportedTimer = null;
    }
    this.unmountRadars();
  }

  private unmountRadars(): void {
    if (this.reactRootA) {
      this.reactRootA.unmount();
      this.reactRootA = null;
    }
    if (this.reactRootB) {
      this.reactRootB.unmount();
      this.reactRootB = null;
    }
  }

  /**
   * Automatically identifies the two most significant audit runs:
   * - Run A: The initial scan (earliest Firestore snapshot or initial unpatched/static baseline scan)
   * - Run B: The latest optimized version (most recent high-scoring Firestore snapshot or full optimized build)
   * and opens them side-by-side in the comparison panel.
   */
  runAutoCompare(shouldEmitExpand = true): void {
    const runs = this.availableRuns();
    if (runs.length < 2) return;

    const repoName = (this.currentSession()?.repo?.fullName || '').trim().toLowerCase();
    const firestoreRuns = runs.filter((r) => r.sourceType === 'firestore');
    const repoFirestoreRuns = firestoreRuns.filter(
      (r) => (r.repoFullName || '').trim().toLowerCase() === repoName
    );
    const fsPool = repoFirestoreRuns.length >= 2 ? repoFirestoreRuns : firestoreRuns;

    let initialRun: ComparableAuditRun;
    let latestOptimizedRun: ComparableAuditRun;

    if (fsPool.length >= 2) {
      // Sort chronologically ascending; tie-break by total after score ascending
      const sorted = [...fsPool].sort((x, y) => {
        const cmp = String(x.timestampIso || '').localeCompare(String(y.timestampIso || ''));
        if (cmp !== 0) return cmp;
        return (
          x.performanceAfter +
          x.accessibilityAfter -
          (y.performanceAfter + y.accessibilityAfter)
        );
      });
      initialRun = sorted[0];
      // Pick the latest/highest-optimized version among subsequent runs
      const candidates = sorted.slice(1);
      latestOptimizedRun = candidates.reduce((best, curr) =>
        curr.performanceAfter + curr.accessibilityAfter >=
        best.performanceAfter + best.accessibilityAfter
          ? curr
          : best
      , candidates[candidates.length - 1]);
    } else if (fsPool.length === 1) {
      const singleFs = fsPool[0];
      const baseRun =
        runs.find((r) => r.id === 'initial-scan-baseline') ?? runs[0];
      const bestLive =
        runs.find((r) => r.id === 'paired-run-2-lhr') ??
        runs.find((r) => r.sourceType === 'current') ??
        runs[1];

      if (
        singleFs.performanceAfter + singleFs.accessibilityAfter >=
        bestLive.performanceAfter + bestLive.accessibilityAfter
      ) {
        initialRun = baseRun;
        latestOptimizedRun = singleFs;
      } else {
        initialRun = singleFs;
        latestOptimizedRun = bestLive;
      }
    } else {
      initialRun =
        runs.find((r) => r.id === 'initial-scan-baseline') ??
        runs.find((r) => r.id === 'paired-run-1-static') ??
        runs[0];
      latestOptimizedRun =
        runs.find((r) => r.id === 'paired-run-2-lhr') ??
        runs.find((r) => r.sourceType === 'current') ??
        runs[1];
    }

    if (initialRun.id === latestOptimizedRun.id && runs.length >= 2) {
      latestOptimizedRun = runs.find((r) => r.id !== initialRun.id) ?? runs[1];
    }

    this.selectedRunAId.set(initialRun.id);
    this.selectedRunBId.set(latestOptimizedRun.id);
    this.isAutoComparedActive.set(true);

    const perfDelta =
      latestOptimizedRun.performanceAfter - initialRun.performanceAfter;
    const a11yDelta =
      latestOptimizedRun.accessibilityAfter - initialRun.accessibilityAfter;
    const lcpDelta = latestOptimizedRun.lcpAfter - initialRun.lcpAfter;
    const clsDelta = latestOptimizedRun.clsAfter - initialRun.clsAfter;
    const fidDelta = latestOptimizedRun.fidAfter - initialRun.fidAfter;

    this.autoCompareNotice.set(
      `Paired Initial Audit Scan (${initialRun.badge}) against Most Recent Optimized Run (${latestOptimizedRun.badge}) — Net improvement: +${Math.max(0, perfDelta)} Perf pts, LCP +${Math.max(0, lcpDelta)} pts, CLS +${Math.max(0, clsDelta)} pts, FID +${Math.max(0, fidDelta)} pts, +${Math.max(0, a11yDelta)} A11y pts.`
    );

    this.animCycle.update((n) => n + 1);

    if (shouldEmitExpand && !this.isExpanded()) {
      this.requestExpand.emit();
    }
  }

  dismissAutoCompareNotice(): void {
    this.autoCompareNotice.set(null);
  }

  dismissComparisonPdfNotice(): void {
    this.comparisonPdfNotice.set(null);
  }

  readonly comparisonPdfProgress = signal<number>(0);

  /**
   * Generates and triggers download of a single-page vector PDF showing the
   * radar chart delta and full 8-dimension metric breakdown between Run A and Run B.
   */
  async downloadComparisonPdf(): Promise<void> {
    const a = this.runA();
    const b = this.runB();
    const rows = this.comparisonRows();
    if (!a || !b || typeof document === 'undefined' || this.isDownloadingComparisonPdf()) return;

    if (this.comparisonExportedTimer) {
      clearTimeout(this.comparisonExportedTimer);
      this.comparisonExportedTimer = null;
    }
    this.justDownloadedComparisonPdf.set(false);
    this.isDownloadingComparisonPdf.set(true);
    this.comparisonPdfProgress.set(24);
    try {
      await new Promise((resolve) => setTimeout(resolve, 110));
      this.comparisonPdfProgress.set(68);
      const payload = buildRadarComparisonDeltaPdf(a, b, rows);
      await new Promise((resolve) => setTimeout(resolve, 120));

      this.comparisonPdfProgress.set(100);
      const blob = new Blob([payload.bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = payload.filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      const perfDiff = b.performanceAfter - a.performanceAfter;
      const a11yDiff = b.accessibilityAfter - a.accessibilityAfter;
      this.comparisonPdfNotice.set(
        `Downloaded ${payload.filename} with vector Radar Chart Delta overlay (${a.badge} vs. ${b.badge}: Perf ${perfDiff >= 0 ? '+' : ''}${perfDiff} pts, A11y ${a11yDiff >= 0 ? '+' : ''}${a11yDiff} pts).`
      );
      this.justDownloadedComparisonPdf.set(true);
      this.comparisonExportedTimer = setTimeout(() => {
        this.justDownloadedComparisonPdf.set(false);
        this.comparisonExportedTimer = null;
      }, 1500);
      await new Promise((resolve) => setTimeout(resolve, 240));
    } finally {
      this.isDownloadingComparisonPdf.set(false);
      this.comparisonPdfProgress.set(0);
    }
  }

  onSelectRunA(runId: string): void {
    this.selectedRunAId.set(runId);
    this.isAutoComparedActive.set(false);
    this.animCycle.update((n) => n + 1);
  }

  onSelectRunB(runId: string): void {
    this.selectedRunBId.set(runId);
    this.isAutoComparedActive.set(false);
    this.animCycle.update((n) => n + 1);
  }

  swapRuns(): void {
    const a = this.selectedRunAId();
    const b = this.selectedRunBId();
    this.selectedRunAId.set(b);
    this.selectedRunBId.set(a);
    this.animCycle.update((n) => n + 1);
  }

  private buildRadarDataForRun(run: ComparableAuditRun) {
    return [
      {
        metric: `LCP (${run.lcpAfter})`,
        before: run.lcpBefore,
        after: run.lcpAfter,
        fullMark: 100,
      },
      {
        metric: `CLS (${run.clsAfter})`,
        before: run.clsBefore,
        after: run.clsAfter,
        fullMark: 100,
      },
      {
        metric: `FID (${run.fidAfter})`,
        before: run.fidBefore,
        after: run.fidAfter,
        fullMark: 100,
      },
      {
        metric: `Perf (${run.performanceAfter})`,
        before: run.performanceBefore,
        after: run.performanceAfter,
        fullMark: 100,
      },
      {
        metric: `A11y (${run.accessibilityAfter})`,
        before: run.accessibilityBefore,
        after: run.accessibilityAfter,
        fullMark: 100,
      },
      {
        metric: `WCAG (${run.wcagAriaAfter})`,
        before: run.wcagAriaBefore,
        after: run.wcagAriaAfter,
        fullMark: 100,
      },
    ];
  }

  private createSingleRunRadarElement(
    run: ComparableAuditRun,
    accentColor: string,
    slotKey: 'A' | 'B',
    cycle: number
  ) {
    const data = this.buildRadarDataForRun(run);
    return React.createElement(
      RadarChart,
      {
        width: 340,
        height: 280,
        cx: '50%',
        cy: '52%',
        outerRadius: 90,
        data,
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
          fontSize: 8.5,
        },
      }),
      React.createElement(Radar, {
        key: `cmp-${slotKey}-before-${run.id}-${cycle}`,
        name: 'Before (Baseline)',
        dataKey: 'before',
        stroke: '#94a3b8',
        strokeWidth: 1.6,
        strokeDasharray: '4 3',
        fill: '#94a3b8',
        fillOpacity: 0.16,
        isAnimationActive: true,
        animationBegin: 20,
        animationDuration: 520,
        animationEasing: 'ease-out',
      }),
      React.createElement(Radar, {
        key: `cmp-${slotKey}-after-${run.id}-${cycle}`,
        name: `After (${run.badge})`,
        dataKey: 'after',
        stroke: accentColor,
        strokeWidth: 2.4,
        fill: accentColor,
        fillOpacity: 0.25,
        dot: {
          r: 3.5,
          fill: accentColor,
          stroke: 'var(--bg-card)',
          strokeWidth: 1.4,
        },
        isAnimationActive: true,
        animationBegin: 65,
        animationDuration: 650,
        animationEasing: 'ease-out',
      }),
      React.createElement(Tooltip, {
        contentStyle: {
          borderRadius: '14px',
          border: '1px solid var(--border-card)',
          backgroundColor: 'var(--bg-card)',
          color: 'var(--text-main)',
          fontSize: '11.5px',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
        },
      }),
      React.createElement(Legend, {
        wrapperStyle: {
          fontSize: '10.5px',
          paddingTop: '4px',
        },
      })
    );
  }

  private renderSideBySideRadars(
    runA: ComparableAuditRun,
    runB: ComparableAuditRun,
    cycle: number
  ): void {
    if (typeof window === 'undefined') return;
    const hostA = this.radarHostA?.nativeElement;
    const hostB = this.radarHostB?.nativeElement;

    if (hostA) {
      if (!this.reactRootA) {
        this.reactRootA = createRoot(hostA);
      }
      this.reactRootA.render(
        this.createSingleRunRadarElement(runA, '#0ea5e9', 'A', cycle)
      );
    }

    if (hostB) {
      if (!this.reactRootB) {
        this.reactRootB = createRoot(hostB);
      }
      this.reactRootB.render(
        this.createSingleRunRadarElement(runB, 'var(--accent-primary)', 'B', cycle)
      );
    }
  }
}
