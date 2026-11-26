import { TestBed } from '@angular/core/testing';
import {
  GlobalAuditDashboardComponent,
  buildGlobalCumulativeTimeline,
  buildGlobalRepoContributions,
  computeGlobalDashboardMetrics
} from './global-audit-dashboard.component';
import { LocalSavedAuditRecord } from '../../models/audit.model';

const MULTI_REPO_HISTORY: LocalSavedAuditRecord[] = [
  {
    auditId: 'run-alpha-1',
    ownerId: 'local',
    repoFullName: 'acme/checkout-web',
    repoUrl: 'https://github.com/acme/checkout-web',
    branch: 'main',
    runPhase: 'static',
    mode: 'live',
    totalCommitsCount: 10,
    selectedCommitsCount: 8,
    performanceBefore: 52,
    performanceAfter: 74, // +22
    accessibilityBefore: 60,
    accessibilityAfter: 80, // +20
    bestPracticesBefore: 75,
    bestPracticesAfter: 90,
    seoBefore: 80,
    seoAfter: 94,
    securityBefore: 70,
    securityAfter: 90,
    summaryNotes: 'Initial static scan for checkout-web',
    commitTitles: ['perf: defer third-party scripts'],
    createdAtIso: '2026-10-01T10:00:00.000Z',
    updatedAtIso: '2026-10-01T10:00:00.000Z',
    storageSource: 'local',
    savedFormat: 'json'
  },
  {
    auditId: 'run-beta-1',
    ownerId: 'local',
    repoFullName: 'fresnel-sandbox/lumina-store',
    repoUrl: 'https://github.com/fresnel-sandbox/lumina-store',
    branch: 'main',
    runPhase: 'lhr',
    mode: 'demo',
    totalCommitsCount: 8,
    selectedCommitsCount: 8,
    performanceBefore: 68,
    performanceAfter: 92, // +24 -> cumulative perf = 46
    accessibilityBefore: 72,
    accessibilityAfter: 96, // +24 -> cumulative a11y = 44
    bestPracticesBefore: 82,
    bestPracticesAfter: 96,
    seoBefore: 84,
    seoAfter: 98,
    securityBefore: 78,
    securityAfter: 92,
    summaryNotes: 'LHR JSON remediation for lumina-store',
    commitTitles: ['a11y: add landmark regions'],
    createdAtIso: '2026-10-05T14:00:00.000Z',
    updatedAtIso: '2026-10-05T14:00:00.000Z',
    storageSource: 'local',
    savedFormat: 'toon'
  },
  {
    auditId: 'run-alpha-2',
    ownerId: 'local',
    repoFullName: 'acme/checkout-web',
    repoUrl: 'https://github.com/acme/checkout-web',
    branch: 'feat/perf-pass',
    runPhase: 'static',
    mode: 'live',
    totalCommitsCount: 6,
    selectedCommitsCount: 6,
    performanceBefore: 74,
    performanceAfter: 96, // +22 -> cumulative perf = 68
    accessibilityBefore: 80,
    accessibilityAfter: 95, // +15 -> cumulative a11y = 59
    bestPracticesBefore: 90,
    bestPracticesAfter: 98,
    seoBefore: 94,
    seoAfter: 99,
    securityBefore: 90,
    securityAfter: 96,
    summaryNotes: 'Follow-up pass on checkout-web',
    commitTitles: ['perf: preload LCP hero image'],
    createdAtIso: '2026-10-09T09:00:00.000Z',
    updatedAtIso: '2026-10-09T09:00:00.000Z',
    storageSource: 'imported',
    savedFormat: 'markdown'
  }
];

describe('GlobalAuditDashboardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GlobalAuditDashboardComponent]
    }).compileComponents();
  });

  it('aggregates cumulative performance and accessibility lifts chronologically across all repositories', () => {
    const timeline = buildGlobalCumulativeTimeline(MULTI_REPO_HISTORY);
    expect(timeline.length).toBe(3);
    expect(timeline.map((p) => p.auditId)).toEqual(['run-alpha-1', 'run-beta-1', 'run-alpha-2']);
    expect(timeline.map((p) => p.cumulativePerfLift)).toEqual([22, 46, 68]);
    expect(timeline.map((p) => p.cumulativeA11yLift)).toEqual([20, 44, 59]);
    expect(timeline.map((p) => p.cumulativeReposCount)).toEqual([1, 2, 2]);

    const metrics = computeGlobalDashboardMetrics(timeline);
    expect(metrics.totalRuns).toBe(3);
    expect(metrics.uniqueRepos).toBe(2);
    expect(metrics.uniqueOrgs).toBe(2);
    expect(metrics.cumulativePerfLift).toBe(68);
    expect(metrics.cumulativeA11yLift).toBe(59);

    const acmeOnly = buildGlobalCumulativeTimeline(MULTI_REPO_HISTORY, 'acme', 'all');
    expect(acmeOnly.length).toBe(2);
    expect(acmeOnly[1].cumulativePerfLift).toBe(44);

    const lhrOnly = buildGlobalCumulativeTimeline(MULTI_REPO_HISTORY, 'all', 'lhr');
    expect(lhrOnly.length).toBe(1);
    expect(lhrOnly[0].repoFullName).toBe('fresnel-sandbox/lumina-store');
  });

  it('computes per-repository cumulative contribution rankings', () => {
    const contribs = buildGlobalRepoContributions(MULTI_REPO_HISTORY);
    expect(contribs.length).toBe(2);
    expect(contribs[0].repoFullName).toBe('acme/checkout-web');
    expect(contribs[0].runCount).toBe(2);
    expect(contribs[0].cumulativePerfLift).toBe(44);
    expect(contribs[0].cumulativeA11yLift).toBe(35);
    expect(contribs[1].repoFullName).toBe('fresnel-sandbox/lumina-store');
  });

  it('renders D3.js cumulative SVG curves and emits exportAllJson on click', () => {
    const fixture = TestBed.createComponent(GlobalAuditDashboardComponent);
    fixture.componentRef.setInput('savedAudits', MULTI_REPO_HISTORY);
    fixture.detectChanges();

    const perfLine = fixture.nativeElement.querySelector(
      '#global-audit-d3-chart svg path.global-d3-line--perf'
    );
    const a11yLine = fixture.nativeElement.querySelector(
      '#global-audit-d3-chart svg path.global-d3-line--a11y'
    );
    const perfDots = fixture.nativeElement.querySelectorAll(
      '#global-audit-d3-chart svg circle.global-d3-dot-perf'
    );
    expect(perfLine).not.toBeNull();
    expect(a11yLine).not.toBeNull();
    expect(perfDots.length).toBe(3);

    const exportSpy = jasmine.createSpy('exportAllJson');
    const exportCsvSpy = jasmine.createSpy('exportAllCsv');
    fixture.componentInstance.exportAllJson.subscribe(exportSpy);
    fixture.componentInstance.exportAllCsv.subscribe(exportCsvSpy);

    const exportBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '#global-dashboard-export-json-btn'
    );
    expect(exportBtn).not.toBeNull();
    exportBtn?.click();
    expect(exportSpy).toHaveBeenCalledTimes(1);

    const exportCsvBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '#global-dashboard-export-csv-btn'
    );
    expect(exportCsvBtn).not.toBeNull();
    expect(exportCsvBtn?.textContent?.trim()).toBe('Download as CSV');
    exportCsvBtn?.click();
    expect(exportCsvSpy).toHaveBeenCalledTimes(1);

    const avgBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '#global-view-average-btn'
    );
    avgBtn?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.viewMode()).toBe('average');
  });
});
