import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  AuditDashboardComponent,
  computeCategoryFindingsDistribution,
  computeDashboardSummary,
  sortSavedAuditsByDateDesc,
  summarizeRecentRepositories
} from './audit-dashboard.component';
import {
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord,
  UserSessionState
} from '../../models/audit.model';
import { AppComponent } from '../../app.component';
import { AuditService } from '../../services/audit.service';

const MOCK_RECORDS: SavedAuditHistoryRecord[] = [
  {
    auditId: 'run-older',
    ownerId: 'uid-1',
    repoFullName: 'acme/storefront',
    repoUrl: 'https://github.com/acme/storefront',
    branch: 'main',
    mode: 'live',
    runPhase: 'static',
    performanceBefore: 60,
    performanceAfter: 82,
    accessibilityBefore: 70,
    accessibilityAfter: 90,
    bestPracticesBefore: 75,
    bestPracticesAfter: 92,
    seoBefore: 80,
    seoAfter: 95,
    securityBefore: 72,
    securityAfter: 90,
    totalCommitsCount: 10,
    selectedCommitsCount: 6,
    summaryNotes: 'Initial static scan',
    commitTitles: ['perf: preload LCP image'],
    createdAtIso: '2026-10-01T10:00:00.000Z',
    updatedAtIso: '2026-10-01T10:05:00.000Z'
  },
  {
    auditId: 'run-latest',
    ownerId: 'uid-1',
    repoFullName: 'acme/storefront',
    repoUrl: 'https://github.com/acme/storefront',
    branch: 'feat/perf',
    mode: 'live',
    runPhase: 'lhr',
    performanceBefore: 82,
    performanceAfter: 94,
    accessibilityBefore: 90,
    accessibilityAfter: 96,
    bestPracticesBefore: 92,
    bestPracticesAfter: 98,
    seoBefore: 95,
    seoAfter: 99,
    securityBefore: 88,
    securityAfter: 95,
    totalCommitsCount: 5,
    selectedCommitsCount: 4,
    summaryNotes: 'Targeted LHR pass',
    commitTitles: ['perf(lhr): defer non-critical CSS'],
    createdAtIso: '2026-10-05T14:20:00.000Z',
    updatedAtIso: '2026-10-05T14:25:00.000Z'
  },
  {
    auditId: 'run-other-repo',
    ownerId: 'uid-1',
    repoFullName: 'fresnel-sandbox/lumina-web-app',
    repoUrl: 'https://github.com/fresnel-sandbox/lumina-web-app',
    branch: 'main',
    mode: 'demo',
    runPhase: 'static',
    performanceBefore: 64,
    performanceAfter: 90,
    accessibilityBefore: 72,
    accessibilityAfter: 94,
    bestPracticesBefore: 78,
    bestPracticesAfter: 95,
    seoBefore: 80,
    seoAfter: 96,
    securityBefore: 74,
    securityAfter: 92,
    totalCommitsCount: 18,
    selectedCommitsCount: 18,
    summaryNotes: 'Sandbox verification',
    commitTitles: ['a11y: add skip link'],
    createdAtIso: '2026-10-03T08:00:00.000Z',
    updatedAtIso: '2026-10-03T08:02:00.000Z'
  }
];

describe('AuditDashboardComponent & Aggregation Helpers', () => {
  let httpMock: HttpTestingController;
  let auditService: AuditService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuditDashboardComponent, AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    auditService = TestBed.inject(AuditService);
  });

  afterEach(() => {
    auditService.stopPolling();
    const pendingConfig = httpMock.match('/api/config');
    for (const req of pendingConfig) {
      req.flush({ liveLighthouseAvailable: false });
    }
    httpMock.verify();
  });

  it('sorts saved audits chronologically descending by updatedAtIso/createdAtIso', () => {
    const sorted = sortSavedAuditsByDateDesc(MOCK_RECORDS);
    expect(sorted.map((r) => r.auditId)).toEqual(['run-latest', 'run-other-repo', 'run-older']);
  });

  it('computes aggregate dashboard metrics across Firestore runs', () => {
    const summary = computeDashboardSummary(MOCK_RECORDS);
    expect(summary.totalRuns).toBe(3);
    expect(summary.uniqueRepositoriesCount).toBe(2);
    expect(summary.latestAuditDateIso).toBe('2026-10-05T14:25:00.000Z');
    // Perf lifts: (82-60)=22, (94-82)=12, (90-64)=26 -> avg = 20
    expect(summary.avgPerfLift).toBe(20);
    // A11y lifts: (90-70)=20, (96-90)=6, (94-72)=22 -> avg = 16
    expect(summary.avgA11yLift).toBe(16);
    expect(summary.totalCommitsSelected).toBe(28);
  });

  it('groups recent repositories with run count and latest audit metadata', () => {
    const repos = summarizeRecentRepositories(MOCK_RECORDS);
    expect(repos.length).toBe(2);
    expect(repos[0].repoFullName).toBe('acme/storefront');
    expect(repos[0].runCount).toBe(2);
    expect(repos[0].latestBranch).toBe('feat/perf');
    expect(repos[0].latestAuditDateIso).toBe('2026-10-05T14:25:00.000Z');
    expect(repos[1].repoFullName).toBe('fresnel-sandbox/lumina-web-app');
    expect(repos[1].runCount).toBe(1);
  });

  it('computes category findings distribution across saved audits', () => {
    const dist = computeCategoryFindingsDistribution(MOCK_RECORDS);
    expect(dist.map((d) => d.category)).toEqual([
      'performance',
      'accessibility',
      'best-practices',
      'seo',
      'security'
    ]);
    const totalCount = dist.reduce((s, d) => s + d.count, 0);
    // selectedCommitsCount sum across MOCK_RECORDS: 6 + 4 + 18 = 28
    expect(totalCount).toBe(28);
    const perf = dist.find((d) => d.category === 'performance');
    const a11y = dist.find((d) => d.category === 'accessibility');
    expect(perf?.count).toBeGreaterThan(0);
    expect(a11y?.count).toBeGreaterThan(0);
    expect(perf?.avgLift).toBe(20);
    expect(a11y?.avgLift).toBe(16);
  });

  it('renders the D3 category findings chart in Bars and Donut modes when saved audits exist', () => {
    const session: UserSessionState = {
      isAuthenticated: false,
      isAuthReady: true,
      uid: null,
      displayName: null,
      githubUsername: null,
      photoURL: null,
      providerId: null,
      githubAccessToken: null,
      projectId: 'gen-lang-client-0302885452',
      authDomain: 'gen-lang-client-0302885452.firebaseapp.com',
      firestoreDatabaseId: 'ai-studio-remixwebsiteacce-334cf058-42df-4c31-b0a6-a4c02f726262',
      profilePath: null,
      savedAuditsCount: MOCK_RECORDS.length
    };
    const localRecords: LocalSavedAuditRecord[] = MOCK_RECORDS.map((r) => ({
      ...r,
      storageSource: 'local',
      savedFormat: 'json'
    }));

    const fixture = TestBed.createComponent(AuditDashboardComponent);
    fixture.componentRef.setInput('savedAudits', localRecords);
    fixture.componentRef.setInput('userSession', session);
    fixture.detectChanges();

    const chartSvg: SVGSVGElement | null = fixture.nativeElement.querySelector(
      '#dashboard-category-d3-chart svg.dashboard-d3-svg'
    );
    expect(chartSvg).not.toBeNull();
    const bars = fixture.nativeElement.querySelectorAll('g.d3-cat-bar-row');
    expect(bars.length).toBe(5);

    const donutBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector('#dashboard-chart-donut-btn');
    donutBtn?.click();
    fixture.detectChanges();

    const slices = fixture.nativeElement.querySelectorAll('path.d3-cat-slice');
    expect(slices.length).toBeGreaterThan(0);
  });

  it('visualizes findings by category from mixed local .toon/.md and Firestore records and supports Local Files scope', () => {
    const session: UserSessionState = {
      isAuthenticated: true,
      isAuthReady: true,
      uid: 'uid-1',
      displayName: 'Sabit',
      githubUsername: 'sabit',
      photoURL: null,
      providerId: 'github.com',
      githubAccessToken: null,
      projectId: 'gen-lang-client-0302885452',
      authDomain: 'gen-lang-client-0302885452.firebaseapp.com',
      firestoreDatabaseId: 'ai-studio-remixwebsiteacce-334cf058-42df-4c31-b0a6-a4c02f726262',
      profilePath: 'users/uid-1',
      savedAuditsCount: 2
    };

    const importedToonRecord: LocalSavedAuditRecord = {
      ...MOCK_RECORDS[0],
      auditId: 'imp-toon-1',
      storageSource: 'imported',
      savedFormat: 'toon',
      snapshotSession: {
        id: 'imp-toon-1',
        interactionId: 'local-imp-toon-1',
        mode: 'live',
        runPhase: 'static',
        status: 'completed',
        progressPercent: 100,
        repo: {
          owner: 'acme',
          repo: 'storefront',
          fullName: 'acme/storefront',
          url: 'https://github.com/acme/storefront'
        },
        branch: 'main',
        categories: ['accessibility', 'seo'],
        currentStep: {
          index: 0,
          phase: 'Restored',
          category: 'Local Snapshot',
          headline: 'Loaded',
          narrative: 'Loaded'
        },
        steps: [],
        totalSteps: 1,
        commits: [
          {
            id: 'c1',
            sha: '111aaaa',
            fullSha: '111aaaa000000000000000000000000000000000',
            category: 'accessibility',
            categoryLabel: 'Accessibility',
            ruleId: 'button-name',
            title: 'Add aria-label',
            commitMessage: 'a11y: add aria-label',
            summary: 'Aria label',
            files: ['src/app/btn.html'],
            additions: 2,
            deletions: 1,
            author: 'Fresnel',
            date: '2026-10-05',
            body: '',
            diff: ''
          },
          {
            id: 'c2',
            sha: '222bbbb',
            fullSha: '222bbbb000000000000000000000000000000000',
            category: 'seo',
            categoryLabel: 'SEO',
            ruleId: 'meta-description',
            title: 'Add meta description',
            commitMessage: 'seo: add meta description',
            summary: 'Meta tag',
            files: ['src/index.html'],
            additions: 1,
            deletions: 0,
            author: 'Fresnel',
            date: '2026-10-05',
            body: '',
            diff: ''
          }
        ],
        totalCommits: 2,
        pr: null
      }
    };

    const fixture = TestBed.createComponent(AuditDashboardComponent);
    fixture.componentRef.setInput('savedAudits', [importedToonRecord, MOCK_RECORDS[1]]);
    fixture.componentRef.setInput('userSession', session);
    fixture.detectChanges();

    const localScopeBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '#dashboard-chart-scope-local-btn'
    );
    expect(localScopeBtn).not.toBeNull();
    localScopeBtn?.click();
    fixture.detectChanges();

    const dist = fixture.componentInstance.categoryDistribution();
    expect(dist.find((d) => d.category === 'accessibility')?.count).toBe(1);
    expect(dist.find((d) => d.category === 'seo')?.count).toBe(1);
    expect(dist.find((d) => d.category === 'performance')?.count).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('(local files only)');
  });

  it('starts on Dashboard (Step 0) and switches cleanly to New Audit (Step 1)', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    expect(auditService.step()).toBe(0);

    component.openNewAudit();
    expect(auditService.step()).toBe(1);

    component.onBack();
    expect(auditService.step()).toBe(0);

    component.onReAuditFromDashboard(MOCK_RECORDS[1].repoUrl);
    expect(auditService.step()).toBe(1);
    expect(component.repoUrl()).toBe('https://github.com/acme/storefront');
  });
});
