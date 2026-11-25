import { TestBed } from '@angular/core/testing';
import {
  SavedAuditsDrawerComponent,
  extractRepoOwner,
  filterSavedAuditRecords,
  groupSavedAuditsByOwner
} from './saved-audits-drawer.component';
import { buildRepositoryTrendSeries } from './saved-audit-trend-chart.component';
import {
  parseLocalAuditRecords,
  serializeConsolidatedAuditHistoryJson
} from '../../services/local-audit-storage.service';
import { LocalSavedAuditRecord, UserSessionState } from '../../models/audit.model';

const SIGNED_OUT_USER_SESSION: UserSessionState = {
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
  savedAuditsCount: 0
};

const MOCK_LOCAL_AUDITS: LocalSavedAuditRecord[] = [
  {
    auditId: 'local-audit-1',
    ownerId: 'local',
    repoFullName: 'acme/web-portal',
    repoUrl: 'https://github.com/acme/web-portal',
    branch: 'main',
    runPhase: 'static',
    mode: 'live',
    totalCommitsCount: 15,
    selectedCommitsCount: 12,
    performanceBefore: 64,
    performanceAfter: 91,
    accessibilityBefore: 70,
    accessibilityAfter: 94,
    bestPracticesBefore: 78,
    bestPracticesAfter: 95,
    seoBefore: 82,
    seoAfter: 96,
    securityBefore: 74,
    securityAfter: 92,
    summaryNotes: 'Static AST accessibility and LCP fixes',
    commitTitles: ['a11y: add aria-label to icon buttons'],
    createdAtIso: '2026-10-01T08:00:00.000Z',
    updatedAtIso: '2026-10-01T08:10:00.000Z',
    storageSource: 'local',
    savedFormat: 'json'
  },
  {
    auditId: 'local-audit-2',
    ownerId: 'local',
    repoFullName: 'fresnel-sandbox/lumina-web-app',
    repoUrl: 'https://github.com/fresnel-sandbox/lumina-web-app',
    branch: 'feat/lhr-pass',
    runPhase: 'lhr',
    mode: 'demo',
    totalCommitsCount: 6,
    selectedCommitsCount: 6,
    performanceBefore: 72,
    performanceAfter: 95,
    accessibilityBefore: 76,
    accessibilityAfter: 97,
    bestPracticesBefore: 82,
    bestPracticesAfter: 96,
    seoBefore: 84,
    seoAfter: 98,
    securityBefore: 80,
    securityAfter: 94,
    summaryNotes: 'Lighthouse LHR JSON targeted CLS fix',
    commitTitles: ['perf: set explicit image width and height'],
    createdAtIso: '2026-10-04T12:00:00.000Z',
    updatedAtIso: '2026-10-04T12:05:00.000Z',
    storageSource: 'imported',
    savedFormat: 'toon'
  }
];

describe('SavedAuditsDrawerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SavedAuditsDrawerComponent]
    }).compileComponents();
  });

  it('filters and sorts local and imported audits by query, phase, source, date, and repo name', () => {
    const mixedRecords = [
      ...MOCK_LOCAL_AUDITS,
      {
        ...MOCK_LOCAL_AUDITS[0],
        auditId: 'firestore-audit-3',
        ownerId: 'uid-1',
        repoFullName: 'zeta-org/app-shell',
        updatedAtIso: '2026-10-02T09:00:00.000Z',
        createdAtIso: '2026-10-02T09:00:00.000Z',
        storageSource: 'firestore' as const
      }
    ];

    const dateDesc = filterSavedAuditRecords(mixedRecords, '', 'all', 'date-desc');
    expect(dateDesc.map((r) => r.auditId)).toEqual([
      'local-audit-2',
      'firestore-audit-3',
      'local-audit-1'
    ]);

    const dateAsc = filterSavedAuditRecords(mixedRecords, '', 'all', 'date-asc');
    expect(dateAsc.map((r) => r.auditId)).toEqual([
      'local-audit-1',
      'firestore-audit-3',
      'local-audit-2'
    ]);

    const repoAsc = filterSavedAuditRecords(mixedRecords, '', 'all', 'repo-asc');
    expect(repoAsc.map((r) => r.repoFullName)).toEqual([
      'acme/web-portal',
      'fresnel-sandbox/lumina-web-app',
      'zeta-org/app-shell'
    ]);

    const repoDesc = filterSavedAuditRecords(mixedRecords, '', 'all', 'repo-desc');
    expect(repoDesc.map((r) => r.repoFullName)).toEqual([
      'zeta-org/app-shell',
      'fresnel-sandbox/lumina-web-app',
      'acme/web-portal'
    ]);

    const localOnly = filterSavedAuditRecords(mixedRecords, '', 'all', 'date-desc', 'local');
    expect(localOnly.map((r) => r.auditId)).toEqual(['local-audit-2', 'local-audit-1']);

    const firestoreOnly = filterSavedAuditRecords(mixedRecords, '', 'all', 'date-desc', 'firestore');
    expect(firestoreOnly.map((r) => r.auditId)).toEqual(['firestore-audit-3']);

    const lhrOnly = filterSavedAuditRecords(MOCK_LOCAL_AUDITS, '', 'lhr');
    expect(lhrOnly.map((r) => r.auditId)).toEqual(['local-audit-2']);

    const formatMatch = filterSavedAuditRecords(MOCK_LOCAL_AUDITS, 'toon', 'all');
    expect(formatMatch.map((r) => r.auditId)).toEqual(['local-audit-2']);
  });

  it('updates rendered card order when user selects repository or oldest-first sort', () => {
    const fixture = TestBed.createComponent(SavedAuditsDrawerComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('savedAudits', MOCK_LOCAL_AUDITS);
    fixture.componentRef.setInput('userSession', SIGNED_OUT_USER_SESSION);
    fixture.detectChanges();

    const getCardRepos = (): string[] =>
      Array.from(
        fixture.nativeElement.querySelectorAll('.saved-audit-card__repo') as NodeListOf<HTMLElement>
      ).map((el) => (el.textContent || '').trim());

    expect(getCardRepos()).toEqual(['fresnel-sandbox/lumina-web-app', 'acme/web-portal']);

    const sortSelect: HTMLSelectElement | null = fixture.nativeElement.querySelector('#drawer-audit-sort');
    expect(sortSelect).not.toBeNull();
    if (sortSelect) {
      sortSelect.value = 'repo-asc';
      sortSelect.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    expect(getCardRepos()).toEqual(['acme/web-portal', 'fresnel-sandbox/lumina-web-app']);
  });

  it('renders local JSON and TOON scans even when signed out and emits load/export/format events', () => {
    const fixture = TestBed.createComponent(SavedAuditsDrawerComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('savedAudits', MOCK_LOCAL_AUDITS);
    fixture.componentRef.setInput('userSession', SIGNED_OUT_USER_SESSION);
    fixture.componentRef.setInput('preferredFormat', 'toon');
    fixture.detectChanges();

    const aside: HTMLElement | null = fixture.nativeElement.querySelector('#saved-audits-drawer');
    expect(aside?.classList.contains('is-open')).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('fresnel-sandbox/lumina-web-app');
    expect(fixture.nativeElement.textContent).toContain('Imported TOON');
    expect(fixture.nativeElement.textContent).toContain('Local JSON');

    const loadedSpy = jasmine.createSpy('openSavedAudit');
    const exportSpy = jasmine.createSpy('exportRecord');
    const formatSpy = jasmine.createSpy('formatChange');
    const closeSpy = jasmine.createSpy('closeDrawer');

    fixture.componentInstance.openSavedAudit.subscribe(loadedSpy);
    fixture.componentInstance.exportRecord.subscribe(exportSpy);
    fixture.componentInstance.formatChange.subscribe(formatSpy);
    fixture.componentInstance.closeDrawer.subscribe(closeSpy);

    const loadBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '.saved-audit-card__actions .dashboard-inline-btn--primary'
    );
    loadBtn?.click();
    expect(loadedSpy).toHaveBeenCalledTimes(1);
    expect(loadedSpy.calls.mostRecent().args[0].auditId).toBe('local-audit-2');

    const exportBtns: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll(
      '.saved-audit-export-chip'
    );
    expect(exportBtns.length).toBeGreaterThanOrEqual(3);
    exportBtns[1].click(); // .toon
    expect(exportSpy).toHaveBeenCalledWith({
      record: MOCK_LOCAL_AUDITS[1],
      format: 'toon'
    });

    const mdBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector('#drawer-format-md-btn');
    mdBtn?.click();
    expect(formatSpy).toHaveBeenCalledWith('markdown');

    fixture.componentInstance.onEscapeKey();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('filters and groups saved audits by GitHub organization or repository owner', () => {
    const multiOrgAudits: LocalSavedAuditRecord[] = [
      ...MOCK_LOCAL_AUDITS,
      {
        ...MOCK_LOCAL_AUDITS[0],
        auditId: 'local-audit-3',
        repoFullName: 'acme/design-system',
        updatedAtIso: '2026-10-06T11:00:00.000Z',
        createdAtIso: '2026-10-06T11:00:00.000Z'
      }
    ];

    expect(extractRepoOwner(multiOrgAudits[0])).toBe('acme');
    expect(extractRepoOwner(multiOrgAudits[1])).toBe('fresnel-sandbox');

    const acmeOnly = filterSavedAuditRecords(multiOrgAudits, '', 'all', 'date-desc', 'all', 'acme');
    expect(acmeOnly.map((r) => r.auditId)).toEqual(['local-audit-3', 'local-audit-1']);

    const groups = groupSavedAuditsByOwner(multiOrgAudits, 'date-desc');
    expect(groups.map((g) => g.owner)).toEqual(['acme', 'fresnel-sandbox']);
    expect(groups[0].count).toBe(2);
    expect(groups[0].repoCount).toBe(2);

    const fixture = TestBed.createComponent(SavedAuditsDrawerComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('savedAudits', multiOrgAudits);
    fixture.componentRef.setInput('userSession', SIGNED_OUT_USER_SESSION);
    fixture.detectChanges();

    const ownerSelect: HTMLSelectElement | null =
      fixture.nativeElement.querySelector('#drawer-owner-filter');
    expect(ownerSelect).not.toBeNull();
    if (ownerSelect) {
      ownerSelect.value = 'acme';
      ownerSelect.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    const renderedRepos = Array.from(
      fixture.nativeElement.querySelectorAll('.saved-audit-card__repo') as NodeListOf<HTMLElement>
    ).map((el) => (el.textContent || '').trim());
    expect(renderedRepos).toEqual(['acme/design-system', 'acme/web-portal']);
  });

  it('renders a D3.js trend line chart for Performance and Accessibility across multiple runs of a repository', () => {
    const multiRunAudits: LocalSavedAuditRecord[] = [
      {
        ...MOCK_LOCAL_AUDITS[0],
        auditId: 'acme-run-1',
        performanceBefore: 58,
        performanceAfter: 78,
        accessibilityBefore: 66,
        accessibilityAfter: 82,
        updatedAtIso: '2026-10-01T08:00:00.000Z',
        createdAtIso: '2026-10-01T08:00:00.000Z'
      },
      {
        ...MOCK_LOCAL_AUDITS[0],
        auditId: 'acme-run-2',
        performanceBefore: 70,
        performanceAfter: 94,
        accessibilityBefore: 78,
        accessibilityAfter: 96,
        updatedAtIso: '2026-10-08T08:00:00.000Z',
        createdAtIso: '2026-10-08T08:00:00.000Z'
      }
    ];

    const series = buildRepositoryTrendSeries(multiRunAudits, 'acme/web-portal');
    expect(series.length).toBe(2);
    expect(series[0].performanceAfter).toBe(78);
    expect(series[1].performanceAfter).toBe(94);

    const fixture = TestBed.createComponent(SavedAuditsDrawerComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('savedAudits', multiRunAudits);
    fixture.componentRef.setInput('userSession', SIGNED_OUT_USER_SESSION);
    fixture.detectChanges();

    const perfPath = fixture.nativeElement.querySelector(
      '#drawer-d3-trend-chart svg path.drawer-trend-line--perf'
    );
    const a11yPath = fixture.nativeElement.querySelector(
      '#drawer-d3-trend-chart svg path.drawer-trend-line--a11y'
    );
    expect(perfPath).not.toBeNull();
    expect(a11yPath).not.toBeNull();
  });

  it('exports full Saved Audits history as a consolidated JSON report and supports round-trip re-import', () => {
    const jsonPayload = serializeConsolidatedAuditHistoryJson(MOCK_LOCAL_AUDITS);
    const parsedBundle = JSON.parse(jsonPayload);

    expect(parsedBundle.format).toBe('fresnel-audit-history-bundle/v1');
    expect(parsedBundle.summary.totalAudits).toBe(2);
    expect(parsedBundle.summary.uniqueRepositories).toBe(2);
    expect(parsedBundle.summary.cumulativePerformanceLift).toBe(50); // (91-64) + (95-72) = 27 + 23
    expect(parsedBundle.summary.cumulativeAccessibilityLift).toBe(45); // (94-70) + (97-76) = 24 + 21
    expect(parsedBundle.records.length).toBe(2);

    const restored = parseLocalAuditRecords('fresnel-saved-audits-history-backup.json', jsonPayload);
    expect(restored.length).toBe(2);
    expect(restored.map((r) => r.repoFullName)).toEqual([
      'fresnel-sandbox/lumina-web-app',
      'acme/web-portal'
    ]);

    const fixture = TestBed.createComponent(SavedAuditsDrawerComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('savedAudits', MOCK_LOCAL_AUDITS);
    fixture.componentRef.setInput('userSession', SIGNED_OUT_USER_SESSION);
    fixture.detectChanges();

    const exportAllSpy = jasmine.createSpy('exportAllJson');
    fixture.componentInstance.exportAllJson.subscribe(exportAllSpy);

    const exportAllBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '#drawer-export-all-json-btn'
    );
    expect(exportAllBtn).not.toBeNull();
    exportAllBtn?.click();
    expect(exportAllSpy).toHaveBeenCalledTimes(1);
  });

  it('filters saved audits by URL keyword, inline date range syntax, and From/To date inputs', () => {
    const customUrlAudits: LocalSavedAuditRecord[] = [
      {
        ...MOCK_LOCAL_AUDITS[0],
        auditId: 'url-audit-1',
        repoFullName: 'enterprise/checkout-portal',
        repoUrl: 'https://git.enterprise-corp.io/payments/checkout-portal',
        updatedAtIso: '2026-10-02T10:00:00.000Z',
        createdAtIso: '2026-10-02T10:00:00.000Z'
      },
      {
        ...MOCK_LOCAL_AUDITS[1],
        auditId: 'url-audit-2',
        repoFullName: 'fresnel-sandbox/lumina-web-app',
        repoUrl: 'https://github.com/fresnel-sandbox/lumina-web-app',
        updatedAtIso: '2026-10-18T15:30:00.000Z',
        createdAtIso: '2026-10-18T15:30:00.000Z'
      }
    ];

    // Match by URL keyword (domain / path not present in repoFullName)
    const byUrlKeyword = filterSavedAuditRecords(customUrlAudits, 'enterprise-corp.io/payments', 'all');
    expect(byUrlKeyword.map((r) => r.auditId)).toEqual(['url-audit-1']);

    // Match by @owner / org: / owner: syntax or organization name
    expect(filterSavedAuditRecords(customUrlAudits, '@enterprise', 'all').map((r) => r.auditId)).toEqual([
      'url-audit-1'
    ]);
    expect(
      filterSavedAuditRecords(customUrlAudits, 'org:fresnel-sandbox', 'all').map((r) => r.auditId)
    ).toEqual(['url-audit-2']);
    expect(
      filterSavedAuditRecords(customUrlAudits, 'owner:enterprise', 'all').map((r) => r.auditId)
    ).toEqual(['url-audit-1']);

    // Match by inline date range token inside the search query
    const byInlineRange = filterSavedAuditRecords(
      customUrlAudits,
      '2026-10-10..2026-10-25',
      'all'
    );
    expect(byInlineRange.map((r) => r.auditId)).toEqual(['url-audit-2']);

    // Match by explicit From / To date range inputs in the drawer component
    const fixture = TestBed.createComponent(SavedAuditsDrawerComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('savedAudits', customUrlAudits);
    fixture.componentRef.setInput('userSession', SIGNED_OUT_USER_SESSION);
    fixture.detectChanges();

    const fromInput: HTMLInputElement | null = fixture.nativeElement.querySelector('#drawer-date-from');
    const toInput: HTMLInputElement | null = fixture.nativeElement.querySelector('#drawer-date-to');
    expect(fromInput).not.toBeNull();
    expect(toInput).not.toBeNull();

    if (fromInput && toInput) {
      fromInput.value = '2026-10-01';
      fromInput.dispatchEvent(new Event('change'));
      toInput.value = '2026-10-05';
      toInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }

    const renderedRepos = Array.from(
      fixture.nativeElement.querySelectorAll('.saved-audit-card__repo') as NodeListOf<HTMLElement>
    ).map((el) => (el.textContent || '').trim());
    expect(renderedRepos).toEqual(['enterprise/checkout-portal']);
  });
});
