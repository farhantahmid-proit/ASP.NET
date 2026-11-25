import { TestBed } from '@angular/core/testing';
import {
  SavedAuditsDrawerComponent,
  filterSavedAuditRecords
} from './saved-audits-drawer.component';
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
});
