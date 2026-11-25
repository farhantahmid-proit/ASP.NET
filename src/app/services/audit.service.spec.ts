import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuditService } from './audit.service';
import { AuditCommit, AuditSession } from '../models/audit.model';

function createMockCommit(overrides: Partial<AuditCommit>): AuditCommit {
  return {
    id: overrides.id ?? 'oss-rule-1',
    sha: overrides.sha ?? 'abc1234',
    fullSha: overrides.fullSha ?? 'abc1234000000000000000000000000000000000',
    category: overrides.category ?? 'performance',
    categoryLabel: overrides.categoryLabel ?? 'Performance',
    ruleId: overrides.ruleId ?? 'largest-contentful-paint',
    impact: overrides.impact ?? 'High · LCP & CLS',
    analyzer: overrides.analyzer ?? 'parse5 + magic-string',
    fixConfidence: overrides.fixConfidence ?? 'auto-verified',
    patchVerified: true,
    title: overrides.title ?? 'Prioritize hero LCP media',
    commitMessage: overrides.commitMessage ?? 'perf(lcp): prioritize hero media',
    summary: overrides.summary ?? 'Adds fetchpriority="high" and explicit width/height.',
    files: overrides.files ?? ['src/app/app.component.html'],
    additions: overrides.additions ?? 3,
    deletions: overrides.deletions ?? 1,
    author: 'Fresnel OSS Engine <fresnel-oss@noreplies.github.com>',
    date: 'Sun, 22 Nov 2026 12:00:00 GMT',
    body: overrides.body ?? 'Deterministic AST fix.',
    diff:
      overrides.diff ??
      'diff --git a/src/app/app.component.html b/src/app/app.component.html\n@@ -1,1 +1,1 @@\n-<img src="/hero.jpg">\n+<img src="/hero.jpg" fetchpriority="high">'
  };
}

function createMockSession(
  commits: AuditCommit[],
  runPhase: 'static' | 'lhr' = 'static',
  id = 'session-1'
): AuditSession {
  return {
    id,
    interactionId: `interaction-${id}`,
    engineType: 'oss-ast-v2',
    liveLighthouseAvailable: false,
    scanDurationMs: 420,
    filesScanned: 8,
    workspaceSource: 'sandbox-workspace',
    deterministicMetrics: {
      performanceBefore: 64,
      performanceAfter: 96,
      accessibilityBefore: 70,
      accessibilityAfter: 98,
      bestPracticesBefore: 76,
      bestPracticesAfter: 96,
      seoBefore: 80,
      seoAfter: 98,
      securityBefore: 68,
      securityAfter: 95
    },
    mode: 'demo',
    runPhase,
    status: 'completed',
    progressPercent: 100,
    repo: {
      owner: 'fresnel-sandbox',
      repo: 'lumina-web-app',
      fullName: 'fresnel-sandbox/lumina-web-app',
      url: 'https://github.com/fresnel-sandbox/lumina-web-app',
      isDemo: true
    },
    branch: 'main',
    categories: ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
    currentStep: {
      index: 0,
      phase: 'Completed',
      category: 'Complete',
      headline: 'Audit complete',
      narrative: 'Generated verified patches.'
    },
    steps: [],
    totalSteps: 1,
    commits,
    totalCommits: commits.length,
    pr: null
  };
}

describe('AuditService', () => {
  let service: AuditService;
  let httpMock: HttpTestingController;

  const mockCommits: AuditCommit[] = [
    createMockCommit({
      id: 'perf-lcp',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'largest-contentful-paint',
      title: 'Prioritize hero LCP image with fetchpriority="high"',
      summary: 'Improves LCP hero discovery and locks width/height for CLS.'
    }),
    createMockCommit({
      id: 'perf-tbt',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'uses-rel-preconnect',
      title: 'Eliminate render-blocking CSS @import and add preconnect',
      summary: 'Reduces render-blocking waterfalls and improves FID/INP.'
    }),
    createMockCommit({
      id: 'a11y-contrast',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'target-size',
      title: 'Fix WCAG 2.2 AA color contrast and add aria-label',
      summary: 'Tunes contrast to >=4.5:1 via Culori and adds screen reader labels.'
    }),
    createMockCommit({
      id: 'bp-eslint',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'eslint-best-practices',
      analyzer: 'eslint + @typescript-eslint/parser',
      title: 'Auto-fix ESLint best-practice violations'
    }),
    createMockCommit({
      id: 'seo-meta',
      category: 'seo',
      categoryLabel: 'SEO',
      ruleId: 'meta-description',
      title: 'Add meta description and OpenGraph metadata'
    }),
    createMockCommit({
      id: 'sec-xss',
      category: 'security',
      categoryLabel: 'Web application security findings',
      ruleId: 'dom-xss-innerhtml',
      title: 'Replace unsanitized innerHTML sinks with textContent'
    })
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AuditService]
    });

    service = TestBed.inject(AuditService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    service.stopPolling();
    // Flush or verify any pending requests from constructor/init if triggered
    const pendingConfig = httpMock.match('/api/config');
    for (const req of pendingConfig) {
      req.flush({ liveLighthouseAvailable: false });
    }
    httpMock.verify();
  });

  it('filters commits by category and automatically resets categoryFilter on new session', () => {
    const session1 = createMockSession(mockCommits, 'static', 'sess-a');
    service.session.set(session1);

    expect(service.filteredCommits().length).toBe(6);

    service.categoryFilter.set('performance');
    expect(service.filteredCommits().map((c) => c.id)).toEqual(['perf-lcp', 'perf-tbt']);

    service.categoryFilter.set('best-practices');
    expect(service.filteredCommits().map((c) => c.id)).toEqual(['bp-eslint']);

    // Starting a new session automatically resets linkedSignal categoryFilter back to 'all'
    service.session.set(createMockSession(mockCommits, 'lhr', 'sess-b'));
    expect(service.categoryFilter()).toBe('all');
    expect(service.filteredCommits().length).toBe(6);
  });

  it('manages commit selection and diff expansion state deterministically', () => {
    service.session.set(createMockSession(mockCommits));
    service.selectedCommitIds.set(new Set(mockCommits.map((c) => c.id)));
    expect(service.selectedCount()).toBe(6);

    service.toggleCommitSelection('perf-lcp');
    expect(service.selectedCount()).toBe(5);
    expect(service.selectedCommitIds().has('perf-lcp')).toBeFalse();

    service.toggleDiff('bp-eslint');
    expect(service.expandedDiffIds().has('bp-eslint')).toBeTrue();
    service.toggleDiff('bp-eslint');
    expect(service.expandedDiffIds().has('bp-eslint')).toBeFalse();
  });

  it('computes deterministic Before/After impact metrics proportional to selected commits', () => {
    service.session.set(createMockSession(mockCommits, 'static'));

    // With 0 commits selected, After scores equal Before scores
    service.selectedCommitIds.set(new Set());
    const noneSelected = service.impactMetrics();
    expect(noneSelected.performanceAfter).toBe(noneSelected.performanceBefore);
    expect(noneSelected.accessibilityAfter).toBe(noneSelected.accessibilityBefore);
    expect(noneSelected.securityAfter).toBe(noneSelected.securityBefore);
    expect(noneSelected.categoryAxes.length).toBe(5);

    // With all commits selected, After scores reach deterministic target scores
    service.selectedCommitIds.set(new Set(mockCommits.map((c) => c.id)));
    const allSelected = service.impactMetrics();
    expect(allSelected.performanceAfter).toBe(96);
    expect(allSelected.accessibilityAfter).toBe(98);
    expect(allSelected.bestPracticesAfter).toBe(96);
    expect(allSelected.seoAfter).toBe(98);
    expect(allSelected.securityAfter).toBe(95);
    expect(allSelected.detailedAxes.map((a) => a.id)).toEqual([
      'lcp',
      'cls',
      'fid',
      'performance-score',
      'accessibility-score',
      'wcag-aria'
    ]);

    // With 1 of 2 performance commits selected, performanceAfter is midpoint (64 -> 80)
    service.selectedCommitIds.set(new Set(['perf-lcp']));
    const halfPerf = service.impactMetrics();
    expect(halfPerf.performanceAfter).toBe(80);
    expect(halfPerf.accessibilityAfter).toBe(70);
  });

  it('excludes Security category axis during Run 2 Lighthouse LHR mode', () => {
    service.session.set(createMockSession(mockCommits, 'lhr', 'sess-lhr'));
    service.selectedCommitIds.set(new Set(mockCommits.map((c) => c.id)));
    const metrics = service.impactMetrics();
    expect(metrics.categoryAxes.some((a) => a.group === 'security')).toBeFalse();
    expect(metrics.categoryAxes.length).toBe(4);
  });

  it('ranks Top 3 executive fixes prioritizing both Performance and Accessibility', () => {
    service.session.set(createMockSession(mockCommits, 'static'));
    service.selectedCommitIds.set(new Set(mockCommits.map((c) => c.id)));

    const top3 = service.topThreeExecutiveFixes();
    expect(top3.length).toBe(3);
    expect(top3[0].rank).toBe(1);
    expect(top3[0].priorityBadge).toBe('CRITICAL FIX #01');
    expect(top3.some((item) => item.commit.category === 'performance')).toBeTrue();
    expect(top3.some((item) => item.commit.category === 'accessibility')).toBeTrue();
  });

  it('fetches /api/config with x-client-id header on initialization and updates liveLighthouseAvailable', async () => {
    const req = httpMock.expectOne('/api/config');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.has('x-client-id')).toBeTrue();
    req.flush({ liveLighthouseAvailable: true });
    await Promise.resolve();
    expect(service.liveLighthouseAvailable()).toBeTrue();
  });

  it('tracks export progress and resets cleanly when generating Executive Summary PDF', async () => {
    service.session.set(createMockSession(mockCommits, 'static'));
    service.selectedCommitIds.set(new Set(mockCommits.map((c) => c.id)));
    spyOn(service, 'triggerBlobDownload').and.stub();

    const exportPromise = service.exportExecutiveSummaryPdf();
    expect(service.isExportingExecutivePdf()).toBeTrue();
    expect(service.isJustExportedExecutivePdf()).toBeFalse();
    expect(service.exportProgress()).toBeGreaterThan(0);

    await exportPromise;
    expect(service.exportingTarget()).toBeNull();
    expect(service.exportProgress()).toBe(0);
    expect(service.isJustExportedExecutivePdf()).toBeTrue();
    expect(service.lastExportNotice()).toContain('Documentation exported:');
    expect(service.triggerBlobDownload).toHaveBeenCalled();
    service.dismissExportNotice();
    expect(service.lastExportNotice()).toBeNull();
  });

  it('tracks export progress and completion notice when generating Markdown report', async () => {
    service.session.set(createMockSession(mockCommits, 'static'));
    service.selectedCommitIds.set(new Set(mockCommits.map((c) => c.id)));
    spyOn(service, 'triggerBrowserDownload').and.stub();
    spyOn(service, 'refreshExportBundle').and.resolveTo(null);

    const mdPromise = service.exportReportAsMarkdown();
    expect(service.isExportingMarkdown()).toBeTrue();
    expect(service.justExportedTarget()).toBeNull();
    expect(service.exportProgress()).toBeGreaterThan(0);

    await mdPromise;
    expect(service.exportingTarget()).toBeNull();
    expect(service.exportProgress()).toBe(0);
    expect(service.exportPreviewMode()).toBe('full');
    expect(service.isJustExportedMarkdown()).toBeTrue();
    expect(service.isJustExportedExecutivePdf()).toBeFalse();
    expect(service.lastExportNotice()).toContain('.md');
    expect(service.triggerBrowserDownload).toHaveBeenCalled();
    service.dismissExportNotice();
  });

  it('tracks export progress and completion flash when generating Full PDF report', async () => {
    service.session.set(createMockSession(mockCommits, 'static'));
    service.selectedCommitIds.set(new Set(mockCommits.map((c) => c.id)));
    spyOn(service, 'triggerBlobDownload').and.stub();
    spyOn(service, 'refreshExportBundle').and.resolveTo(null);

    const pdfPromise = service.exportReportAsPdf();
    expect(service.isExportingFullPdf()).toBeTrue();
    expect(service.justExportedTarget()).toBeNull();
    expect(service.exportProgress()).toBeGreaterThan(0);

    await pdfPromise;
    expect(service.exportingTarget()).toBeNull();
    expect(service.exportProgress()).toBe(0);
    expect(service.exportPreviewMode()).toBe('full');
    expect(service.isJustExportedFullPdf()).toBeTrue();
    expect(service.lastExportNotice()).toContain('.pdf');
    expect(service.triggerBlobDownload).toHaveBeenCalled();
    service.dismissExportNotice();
  });

  it('computes summary modal metrics and gates proceeding to the report/export screen', () => {
    service.session.set(createMockSession(mockCommits, 'static'));
    service.selectedCommitIds.set(new Set(mockCommits.map((c) => c.id)));
    service.step.set(2);

    const stats = service.auditSummaryStats();
    expect(stats).not.toBeNull();
    expect(stats!.commitsCount).toBe(6);
    expect(stats!.filesModifiedCount).toBe(1);
    expect(stats!.totalAdditions).toBe(18);
    expect(stats!.totalDeletions).toBe(6);

    service.openAuditSummaryModal(3);
    expect(service.isSummaryModalOpen()).toBeTrue();
    expect(service.pendingReportStep()).toBe(3);

    service.dismissSummaryModal();
    expect(service.isSummaryModalOpen()).toBeFalse();
    expect(service.step()).toBe(2);

    service.reopenSummaryModal();
    expect(service.isSummaryModalOpen()).toBeTrue();

    spyOn(service, 'transitionToStep').and.stub();
    service.confirmSummaryAndProceed(true);
    expect(service.isSummaryModalOpen()).toBeFalse();
    expect(service.isExportDrawerOpen()).toBeTrue();
    expect(service.transitionToStep).toHaveBeenCalledWith(3);
  });

  it('filters commits by file path or audit issue text query and calculates cumulative selection impact', () => {
    const customCommits = [
      createMockCommit({
        id: 'c1',
        category: 'performance',
        title: 'Preload hero banner image',
        files: ['src/index.html'],
        additions: 12,
        deletions: 3
      }),
      createMockCommit({
        id: 'c2',
        category: 'accessibility',
        categoryLabel: 'Accessibility',
        ruleId: 'button-name',
        title: 'Inject aria-label on icon buttons',
        files: ['src/app/toolbar.tsx', 'src/app/nav.tsx'],
        additions: 24,
        deletions: 6
      }),
      createMockCommit({
        id: 'c3',
        category: 'seo',
        categoryLabel: 'SEO',
        ruleId: 'meta-description',
        title: 'Add canonical meta description',
        files: ['src/index.html'],
        additions: 5,
        deletions: 0
      })
    ];

    service.session.set(createMockSession(customCommits, 'static', 'sess-filter'));
    service.selectedCommitIds.set(new Set(['c1', 'c2']));

    // Cumulative selection impact: 2/3 commits, (12+3)+(24+6) = 45 lines changed across 3 unique files
    const impact = service.selectionImpactStats();
    expect(impact.selectedCount).toBe(2);
    expect(impact.totalCount).toBe(3);
    expect(impact.selectionPercent).toBe(67);
    expect(impact.totalAdditions).toBe(36);
    expect(impact.totalDeletions).toBe(9);
    expect(impact.totalLinesChanged).toBe(45);
    expect(impact.filesTouchedCount).toBe(3);

    // Filter by file path
    service.setCommitSearchQuery('toolbar.tsx');
    expect(service.filteredCommits().map((c) => c.id)).toEqual(['c2']);

    // Filter by multi-word audit issue & file path
    service.setCommitSearchQuery('index.html canonical');
    expect(service.filteredCommits().map((c) => c.id)).toEqual(['c3']);

    // Reset clears both search query and category filter
    service.categoryFilter.set('seo');
    service.resetCommitFilters();
    expect(service.commitSearchQuery()).toBe('');
    expect(service.categoryFilter()).toBe('all');
    expect(service.filteredCommits().length).toBe(3);
  });
});
