import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LocalSavedAuditRecord } from '../../models/audit.model';
import {
  LiveAuditIntegrationsService,
  WebVitalReading
} from '../../services/live-audit-integrations.service';

export type LiveSuiteTab = 'pagespeed' | 'axe-vitals' | 'playwright' | 'extension';

@Component({
  selector: 'app-live-audit-suite',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="live-audit-suite-panel"
      class="ast-worker-panel"
      aria-labelledby="live-audit-suite-heading"
    >
      <!-- Header & Tab Selector -->
      <div class="ast-worker-panel__head">
        <div>
          <p class="biz-audit-kicker">
            <span>Live Auditing Integrations</span>
            <span aria-hidden="true">·</span>
            <span>PageSpeed Insights · axe-core · web-vitals · Playwright · Chrome MV3</span>
          </p>
          <h2 id="live-audit-suite-heading" class="biz-audit-title">
            Live Browser, Cloud Lighthouse &amp; Staging Audit Suite
          </h2>
          <p class="biz-audit-subtitle">
            Run Google-hosted Lighthouse (LHR) on any public URL with zero local Chromium, execute real WCAG 2.2 accessibility scans with <code>axe-core</code>, capture Core Web Vitals via <code>web-vitals</code>, generate multi-page Playwright journeys, or import logged-in tab audits from the Companion Chrome Extension.
          </p>
        </div>

        <div class="dashboard-segmented" role="tablist" aria-label="Live audit integration engine">
          <button
            type="button"
            role="tab"
            id="live-suite-tab-pagespeed"
            class="dashboard-segmented__btn"
            [class.is-active]="activeTab() === 'pagespeed'"
            [attr.aria-selected]="activeTab() === 'pagespeed'"
            (click)="activeTab.set('pagespeed')"
          >
            PageSpeed API
          </button>
          <button
            type="button"
            role="tab"
            id="live-suite-tab-axe"
            class="dashboard-segmented__btn"
            [class.is-active]="activeTab() === 'axe-vitals'"
            [attr.aria-selected]="activeTab() === 'axe-vitals'"
            (click)="activeTab.set('axe-vitals')"
          >
            axe-core + Vitals
          </button>
          <button
            type="button"
            role="tab"
            id="live-suite-tab-playwright"
            class="dashboard-segmented__btn"
            [class.is-active]="activeTab() === 'playwright'"
            [attr.aria-selected]="activeTab() === 'playwright'"
            (click)="activeTab.set('playwright')"
          >
            Playwright
          </button>
          <button
            type="button"
            role="tab"
            id="live-suite-tab-extension"
            class="dashboard-segmented__btn"
            [class.is-active]="activeTab() === 'extension'"
            [attr.aria-selected]="activeTab() === 'extension'"
            (click)="activeTab.set('extension')"
          >
            Chrome Ext
          </button>
        </div>
      </div>

      <!-- TAB 1: GOOGLE PAGESPEED INSIGHTS API -->
      @if (activeTab() === 'pagespeed') {
        <div role="tabpanel" aria-labelledby="live-suite-tab-pagespeed" class="mt-4 space-y-4">
          <form [formGroup]="pageSpeedForm" (ngSubmit)="onRunPageSpeed()" class="flex flex-col gap-3 md:flex-row md:items-end">
            <div class="flex-1">
              <label for="pagespeed-target-url" class="block text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Public URL for Google-Hosted Lighthouse (PageSpeed Insights v5)
              </label>
              <input
                id="pagespeed-target-url"
                type="url"
                formControlName="targetUrl"
                placeholder="https://web.dev"
                class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              />
            </div>

            <div class="flex items-center gap-2">
              <div class="dashboard-segmented" role="group" aria-label="Device strategy">
                <button
                  type="button"
                  class="dashboard-segmented__btn"
                  [class.is-active]="pageSpeedStrategy() === 'mobile'"
                  (click)="pageSpeedStrategy.set('mobile')"
                >
                  Mobile
                </button>
                <button
                  type="button"
                  class="dashboard-segmented__btn"
                  [class.is-active]="pageSpeedStrategy() === 'desktop'"
                  (click)="pageSpeedStrategy.set('desktop')"
                >
                  Desktop
                </button>
              </div>

              <button
                type="submit"
                id="pagespeed-run-btn"
                class="primary-flow-btn ast-worker-btn inline-flex items-center gap-1.5"
                [disabled]="integrations.isRunningPageSpeed()"
              >
                <svg class="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path d="M3.5 14a6.5 6.5 0 1 1 13 0M10 10l3-3" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span>
                  {{ integrations.isRunningPageSpeed() ? 'Running Cloud Lighthouse…' : 'Run PageSpeed Audit' }}
                </span>
              </button>
            </div>
          </form>

          @if (integrations.pageSpeedError(); as psiErr) {
            <p class="biz-audit-error" role="alert">{{ psiErr }}</p>
          }

          @if (integrations.latestPageSpeed(); as psi) {
            <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="text-xs font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Google Lighthouse v{{ psi.lighthouseVersion }} · {{ psi.strategy }}
                  </p>
                  <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-100 break-all">
                    {{ psi.finalUrl }}
                  </h3>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  @if (psi.savedRecord; as rec) {
                    <button
                      type="button"
                      class="dashboard-inline-btn dashboard-inline-btn--primary inline-flex items-center gap-1"
                      (click)="openSavedAudit.emit(rec)"
                    >
                      <span>Open Saved Report</span>
                    </button>
                  }
                  <button
                    type="button"
                    class="dashboard-inline-btn inline-flex items-center gap-1"
                    (click)="onSendLhrToRun2()"
                  >
                    <span>{{ lhrLoadedNotice() ? 'Loaded into Run 2 LHR' : 'Send LHR to Run 2' }}</span>
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
                  <span class="block text-[11px] font-mono uppercase text-slate-500">Performance</span>
                  <strong class="text-xl font-bold text-slate-900 dark:text-white">{{ psi.scores.performance }}</strong>
                </div>
                <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
                  <span class="block text-[11px] font-mono uppercase text-slate-500">Accessibility</span>
                  <strong class="text-xl font-bold text-slate-900 dark:text-white">{{ psi.scores.accessibility }}</strong>
                </div>
                <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
                  <span class="block text-[11px] font-mono uppercase text-slate-500">Best Practices</span>
                  <strong class="text-xl font-bold text-slate-900 dark:text-white">{{ psi.scores.bestPractices }}</strong>
                </div>
                <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
                  <span class="block text-[11px] font-mono uppercase text-slate-500">SEO</span>
                  <strong class="text-xl font-bold text-slate-900 dark:text-white">{{ psi.scores.seo }}</strong>
                </div>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
                <div class="rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-2.5 py-2">
                  <span class="text-slate-500 block">LCP</span>
                  <strong class="text-slate-900 dark:text-slate-100">{{ psi.coreWebVitals.lcpDisplay }}</strong>
                </div>
                <div class="rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-2.5 py-2">
                  <span class="text-slate-500 block">FCP</span>
                  <strong class="text-slate-900 dark:text-slate-100">{{ psi.coreWebVitals.fcpDisplay }}</strong>
                </div>
                <div class="rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-2.5 py-2">
                  <span class="text-slate-500 block">CLS</span>
                  <strong class="text-slate-900 dark:text-slate-100">{{ psi.coreWebVitals.clsDisplay }}</strong>
                </div>
                <div class="rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-2.5 py-2">
                  <span class="text-slate-500 block">TBT</span>
                  <strong class="text-slate-900 dark:text-slate-100">{{ psi.coreWebVitals.tbtDisplay }}</strong>
                </div>
                <div class="rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-2.5 py-2">
                  <span class="text-slate-500 block">INP (Field)</span>
                  <strong class="text-slate-900 dark:text-slate-100">{{ psi.coreWebVitals.inpDisplay }}</strong>
                </div>
              </div>

              @if (psi.failingAudits.length > 0) {
                <div class="space-y-1.5">
                  <p class="text-xs font-mono uppercase tracking-wider text-slate-500">
                    Top Failing Lighthouse Diagnostics ({{ psi.failingAudits.length }})
                  </p>
                  <ul class="space-y-1.5 max-h-48 overflow-y-auto">
                    @for (auditItem of psi.failingAudits.slice(0, 8); track auditItem.id) {
                      <li class="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs">
                        <div class="min-w-0">
                          <span class="font-mono uppercase text-[10px] text-emerald-700 dark:text-emerald-400 mr-2">{{ auditItem.category }}</span>
                          <span class="font-medium text-slate-900 dark:text-slate-100">{{ auditItem.title }}</span>
                        </div>
                        <span class="font-mono shrink-0 text-slate-500">
                          {{ auditItem.displayValue || (auditItem.score + '/100') }}
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- TAB 2: AXE-CORE WCAG + LIVE WEB-VITALS -->
      @if (activeTab() === 'axe-vitals') {
        <div role="tabpanel" aria-labelledby="live-suite-tab-axe" class="mt-4 space-y-4">
          <!-- Real-Time web-vitals Strip -->
          <div>
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p class="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Live Core Web Vitals (<code>web-vitals</code> RUM Observer)
              </p>
              <button
                type="button"
                id="save-web-vitals-snapshot-btn"
                class="dashboard-inline-btn inline-flex items-center gap-1"
                (click)="onSaveWebVitals()"
              >
                <span>Save Vitals Snapshot</span>
              </button>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              @for (vital of webVitalsList(); track vital.name) {
                <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
                  <div class="flex items-center justify-between gap-1">
                    <span class="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">{{ vital.name }}</span>
                    <span
                      class="text-[10px] font-mono uppercase"
                      [class.text-emerald-600]="vital.rating === 'good'"
                      [class.text-amber-600]="vital.rating === 'needs-improvement'"
                      [class.text-rose-600]="vital.rating === 'poor'"
                      [class.text-slate-400]="vital.rating === 'pending'"
                    >
                      {{ vital.rating }}
                    </span>
                  </div>
                  <strong class="block mt-1 text-base font-bold text-slate-900 dark:text-white font-mono">
                    {{ vital.displayValue }}
                  </strong>
                  <span class="block text-[11px] text-slate-500 truncate">{{ vital.label }}</span>
                </div>
              }
            </div>

            @if (integrations.webVitalsNotice(); as vitalsMsg) {
              <p class="mt-2 text-xs text-emerald-700 dark:text-emerald-400" role="status" aria-live="polite">
                {{ vitalsMsg }}
              </p>
            }
          </div>

          <!-- Real axe-core WCAG 2.1/2.2 Engine -->
          <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Real <code>axe-core</code> WCAG 2.1 / 2.2 AA Engine
                </h3>
                <p class="text-xs text-slate-600 dark:text-slate-400">
                  Evaluates the rendered DOM against Deque's official WCAG 2A, 2AA, 2.1AA, 2.2AA, and best-practice rules and persists findings to offline history.
                </p>
              </div>
              <button
                type="button"
                id="run-axe-core-btn"
                class="primary-flow-btn ast-worker-btn inline-flex items-center gap-1.5"
                [disabled]="integrations.isRunningAxe()"
                (click)="onRunAxeCore()"
              >
                <svg class="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <circle cx="10" cy="4.5" r="1.5" />
                  <path d="M4.5 7.5h11M10 7.5v4.5m0 0l-2.5 4.5m2.5-4.5l2.5 4.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span>{{ integrations.isRunningAxe() ? 'Scanning DOM with axe-core…' : 'Run axe-core WCAG Scan' }}</span>
              </button>
            </div>

            @if (integrations.axeError(); as axeErr) {
              <p class="biz-audit-error" role="alert">{{ axeErr }}</p>
            }

            @if (integrations.latestAxe(); as axeRes) {
              <div class="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div class="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div class="flex flex-wrap gap-3">
                    <span>Score: <strong>{{ axeRes.accessibilityScore }}/100</strong></span>
                    <span>Passed: <strong>{{ axeRes.passesCount }}</strong></span>
                    <span>Violations: <strong>{{ axeRes.violations.length }}</strong></span>
                    <span>Review: <strong>{{ axeRes.incompleteCount }}</strong></span>
                  </div>
                  <button
                    type="button"
                    class="dashboard-inline-btn dashboard-inline-btn--primary inline-flex items-center gap-1"
                    (click)="openSavedAudit.emit(axeRes.savedRecord)"
                  >
                    <span>Open axe-core Report</span>
                  </button>
                </div>

                @if (axeRes.violations.length === 0) {
                  <p class="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                    Zero WCAG 2.1/2.2 AA violations detected across {{ axeRes.passesCount }} evaluated axe-core rules.
                  </p>
                } @else {
                  <ul class="space-y-1.5 max-h-52 overflow-y-auto">
                    @for (v of axeRes.violations; track v.id) {
                      <li class="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2.5 text-xs">
                        <div class="flex items-center justify-between gap-2">
                          <strong class="text-slate-900 dark:text-slate-100">{{ v.help }}</strong>
                          <span class="font-mono uppercase text-[10px] text-amber-700 dark:text-amber-400 shrink-0">
                            {{ v.impact }} · {{ v.nodesCount }} node{{ v.nodesCount === 1 ? '' : 's' }}
                          </span>
                        </div>
                        <p class="mt-1 text-slate-600 dark:text-slate-400 font-mono text-[11px] truncate">
                          Rule: {{ v.id }} · Target: {{ v.sampleSelector }}
                        </p>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </div>
        </div>
      }

      <!-- TAB 3: PLAYWRIGHT + PLAYWRIGHT-LIGHTHOUSE MULTI-PAGE / AUTH STAGING -->
      @if (activeTab() === 'playwright') {
        <div role="tabpanel" aria-labelledby="live-suite-tab-playwright" class="mt-4 space-y-4">
          <form [formGroup]="playwrightForm" class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label for="pw-urls-input" class="block text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">
                Multi-Page Journey URLs (one per line or comma-separated)
              </label>
              <textarea
                id="pw-urls-input"
                rows="3"
                formControlName="urls"
                class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              ></textarea>
            </div>
            <div class="flex flex-col justify-between gap-2">
              <div>
                <label for="pw-storage-state" class="block text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">
                  Optional Auth Storage State JSON (for logged-in staging)
                </label>
                <input
                  id="pw-storage-state"
                  type="text"
                  formControlName="storageState"
                  placeholder="playwright-auth.json"
                  class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                />
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  id="pw-copy-cli-btn"
                  class="primary-flow-btn ast-worker-btn inline-flex items-center gap-1.5"
                  (click)="onCopyPlaywrightCommand()"
                >
                  <span>{{ playwrightCopied() ? 'Copied CLI Command' : 'Copy CLI Command' }}</span>
                </button>
                <button
                  type="button"
                  id="pw-download-script-btn"
                  class="secondary-flow-btn ast-worker-btn inline-flex items-center gap-1.5"
                  (click)="onDownloadPlaywrightScript()"
                >
                  <span>Download Runner (.mjs)</span>
                </button>
              </div>
            </div>
          </form>

          <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 p-3.5 font-mono text-xs overflow-x-auto">
            <div class="text-slate-400 mb-1"># 1. Install Playwright + playwright-lighthouse + &#64;axe-core/playwright</div>
            <div class="mb-2">npm install -D playwright playwright-lighthouse &#64;axe-core/playwright &amp;&amp; npx playwright install chromium</div>
            <div class="text-slate-400 mb-1"># 2. Run authenticated multi-page journey &amp; output Fresnel JSON</div>
            <div class="text-emerald-400">{{ playwrightCliCommand() }}</div>
          </div>
        </div>
      }

      <!-- TAB 4: COMPANION CHROME EXTENSION (MANIFEST V3) -->
      @if (activeTab() === 'extension') {
        <div role="tabpanel" aria-labelledby="live-suite-tab-extension" class="mt-4 space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-2 text-xs">
              <p class="font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Manifest V3 Package · /chrome-extension/
              </p>
              <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Audit Logged-In Browser Tabs Directly
              </h3>
              <ol class="list-decimal list-inside space-y-1.5 text-slate-600 dark:text-slate-300">
                <li>Open <code>chrome://extensions</code> and enable <strong>Developer mode</strong>.</li>
                <li>Click <strong>Load unpacked</strong> and select this project's <code>chrome-extension/</code> folder.</li>
                <li>Open any authenticated tab, click <strong>Fresnel Live Tab Auditor</strong>, and run the scan.</li>
                <li>Click <strong>Download Fresnel Audit JSON</strong> or <strong>Copy JSON</strong> and import it on the right.</li>
              </ol>
            </div>

            <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 space-y-3">
              <form [formGroup]="extensionForm" (ngSubmit)="onImportExtensionJson()" class="space-y-2.5">
                <label for="ext-json-textarea" class="block text-xs font-mono uppercase tracking-wider text-slate-500">
                  Paste Chrome Extension Fresnel JSON Export
                </label>
                <textarea
                  id="ext-json-textarea"
                  rows="4"
                  formControlName="jsonPayload"
                  placeholder='{"format": "fresnel-audit-json/v1", "record": { ... }}'
                  class="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                ></textarea>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    id="ext-import-json-btn"
                    class="primary-flow-btn ast-worker-btn inline-flex items-center gap-1.5"
                  >
                    <span>Import Extension JSON</span>
                  </button>
                  @if (integrations.lastImportedExtensionRecord(); as importedRec) {
                    <button
                      type="button"
                      class="dashboard-inline-btn dashboard-inline-btn--primary"
                      (click)="openSavedAudit.emit(importedRec)"
                    >
                      Open Imported Audit
                    </button>
                  }
                </div>
              </form>

              @if (integrations.extensionError(); as extErr) {
                <p class="biz-audit-error" role="alert">{{ extErr }}</p>
              } @else if (integrations.extensionStatus()) {
                <p class="text-xs text-emerald-700 dark:text-emerald-400" role="status" aria-live="polite">
                  {{ integrations.extensionStatus() }}
                </p>
              }
            </div>
          </div>
        </div>
      }
    </section>
  `
})
export class LiveAuditSuiteComponent {
  readonly integrations = inject(LiveAuditIntegrationsService);

  readonly openSavedAudit = output<LocalSavedAuditRecord>();

  readonly activeTab = signal<LiveSuiteTab>('pagespeed');
  readonly pageSpeedStrategy = signal<'mobile' | 'desktop'>('mobile');
  readonly lhrLoadedNotice = signal<boolean>(false);
  readonly playwrightCopied = signal<boolean>(false);

  readonly pageSpeedForm = new FormGroup({
    targetUrl: new FormControl<string>('https://web.dev', {
      nonNullable: true,
      validators: [Validators.required]
    })
  });

  readonly playwrightForm = new FormGroup({
    urls: new FormControl<string>(
      'https://staging.example.com/\nhttps://staging.example.com/dashboard\nhttps://staging.example.com/checkout',
      { nonNullable: true }
    ),
    storageState: new FormControl<string>('playwright-auth.json', { nonNullable: true })
  });

  readonly extensionForm = new FormGroup({
    jsonPayload: new FormControl<string>('', { nonNullable: true })
  });

  readonly webVitalsList = computed<WebVitalReading[]>(() => {
    const map = this.integrations.webVitals();
    return [map.LCP, map.INP, map.CLS, map.FCP, map.TTFB];
  });

  playwrightCliCommand(): string {
    return this.integrations.buildPlaywrightCliCommand(
      this.playwrightForm.controls.urls.value,
      this.playwrightForm.controls.storageState.value
    );
  }

  async onRunPageSpeed(): Promise<void> {
    this.lhrLoadedNotice.set(false);
    await this.integrations.runPageSpeedAudit(
      this.pageSpeedForm.controls.targetUrl.value,
      this.pageSpeedStrategy()
    );
  }

  onSendLhrToRun2(): void {
    const ok = this.integrations.loadPageSpeedLhrIntoRun2();
    if (ok) {
      this.lhrLoadedNotice.set(true);
    }
  }

  async onRunAxeCore(): Promise<void> {
    await this.integrations.runInBrowserAxeAudit();
  }

  async onSaveWebVitals(): Promise<void> {
    await this.integrations.saveLiveWebVitalsSnapshot();
  }

  async onCopyPlaywrightCommand(): Promise<void> {
    const cmd = this.playwrightCliCommand();
    try {
      await navigator.clipboard.writeText(cmd);
      this.playwrightCopied.set(true);
      setTimeout(() => this.playwrightCopied.set(false), 2400);
    } catch {
      // Clipboard fallback ignored silently
    }
  }

  onDownloadPlaywrightScript(): void {
    this.integrations.downloadCustomPlaywrightRunner(
      this.playwrightForm.controls.urls.value,
      this.playwrightForm.controls.storageState.value
    );
  }

  onImportExtensionJson(): void {
    const raw = this.extensionForm.controls.jsonPayload.value;
    const imported = this.integrations.importExtensionJson(raw);
    if (imported) {
      this.extensionForm.controls.jsonPayload.setValue('');
    }
  }
}
