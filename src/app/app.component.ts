import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuditService } from './services/audit.service';
import { AuthService } from './services/auth.service';
import { FirebaseAuthService } from './services/firebase-auth.service';
import { LocalAuditStorageService } from './services/local-audit-storage.service';
import { FresnelLogoComponent } from './components/fresnel-logo/fresnel-logo.component';
import { ImpactRadarChartComponent } from './components/impact-radar-chart/impact-radar-chart.component';
import { RepoContextBarComponent } from './components/repo-context-bar/repo-context-bar.component';
import { AuditRunComparisonComponent } from './components/audit-run-comparison/audit-run-comparison.component';
import { CommitDiffViewerComponent } from './components/commit-diff-viewer/commit-diff-viewer.component';
import { AuditDashboardComponent } from './components/audit-dashboard/audit-dashboard.component';
import { SavedAuditsDrawerComponent } from './components/saved-audits-drawer/saved-audits-drawer.component';
import { GithubSshGuideComponent } from './components/github-ssh-guide/github-ssh-guide.component';
import { GitPushFailureModalComponent } from './components/git-push-failure-modal/git-push-failure-modal.component';
import {
  CachedRepositoryAuditEntry,
  GitHubRepoIssue,
  GitHubRepoIssuesResponse,
  LighthouseCategory,
  LocalAuditFormat,
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord
} from './models/audit.model';

export interface CategoryTabItem {
  key: LighthouseCategory;
  label: string;
  contextBadge?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    FormsModule,
    FresnelLogoComponent,
    ImpactRadarChartComponent,
    RepoContextBarComponent,
    AuditRunComparisonComponent,
    CommitDiffViewerComponent,
    AuditDashboardComponent,
    SavedAuditsDrawerComponent,
    GithubSshGuideComponent,
    GitPushFailureModalComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown)': 'onGlobalKeyDown($event)',
    '(document:click)': 'onDocumentClick($event)'
  }
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly audit = inject(AuditService);
  readonly authService = inject(AuthService);
  readonly fbAuth = inject(FirebaseAuthService);
  readonly localAuditStorage = inject(LocalAuditStorageService);
  readonly repoUrl = signal<string>('');
  readonly drawerImportError = signal<string | null>(null);
  readonly copiedKey = signal<string | null>(null);
  readonly isComparisonPanelOpen = signal<boolean>(true);
  readonly autoCompareNonce = signal<number>(0);
  readonly radarViewMode = signal<'detailed' | 'categories' | 'history' | 'compare'>('detailed');
  readonly isReportHistoryTabActive = computed<boolean>(() => this.radarViewMode() === 'history');
  readonly isReportIssuesTabActive = signal<boolean>(false);
  readonly repoIssuesResponse = signal<GitHubRepoIssuesResponse | null>(null);
  readonly isLoadingRepoIssues = signal<boolean>(false);
  readonly issuesCategoryFilter = signal<LighthouseCategory>('all');
  private lastLoadedIssuesRepo = '';

  readonly openRepoIssues = computed<GitHubRepoIssue[]>(() => {
    return this.repoIssuesResponse()?.issues ?? [];
  });

  readonly openRepoIssuesCount = computed<number>(() => {
    const resp = this.repoIssuesResponse();
    if (!resp) return 6;
    return resp.issues.length;
  });

  readonly filteredRepoIssues = computed<GitHubRepoIssue[]>(() => {
    const all = this.openRepoIssues();
    const filter = this.issuesCategoryFilter();
    if (filter === 'all') return all;
    return all.filter((iss) => iss.relatedCategory === filter);
  });

  readonly reportListAnimCycle = signal<number>(1);
  readonly isReportListEntering = signal<boolean>(true);
  readonly shortcutNotice = signal<string | null>(null);
  readonly loadingDrawerAuditId = signal<string | null>(null);
  readonly defaultSshEmail = computed<string>(() => this.fbAuth.currentUser()?.email || '');
  private reportListAnimTimer: ReturnType<typeof setTimeout> | null = null;
  private shortcutNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== 'undefined' && this.localAuditStorage.localAudits().length === 0) {
      this.localAuditStorage.seedSampleAuditsIfEmpty();
    }

    effect(() => {
      const repoMeta = this.audit.session()?.repo;
      const fullName = repoMeta?.fullName ?? '';
      if (fullName && fullName !== this.lastLoadedIssuesRepo) {
        this.lastLoadedIssuesRepo = fullName;
        void this.fetchRepoOpenIssues(repoMeta?.owner || 'fresnel-sandbox', repoMeta?.repo || 'lumina-web-app');
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.shortcutNoticeTimer) {
        clearTimeout(this.shortcutNoticeTimer);
        this.shortcutNoticeTimer = null;
      }
    });
  }

  private showShortcutNotice(message: string): void {
    if (this.shortcutNoticeTimer) {
      clearTimeout(this.shortcutNoticeTimer);
      this.shortcutNoticeTimer = null;
    }
    this.shortcutNotice.set(message);
    this.shortcutNoticeTimer = setTimeout(() => {
      this.shortcutNotice.set(null);
      this.shortcutNoticeTimer = null;
    }, 2400);
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest('[contenteditable="true"]'));
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.authService.isAccountMenuOpen()) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('#account-dropdown-root')) {
      return;
    }
    this.authService.closeAccountMenu();
  }

  onGlobalKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.authService.isAccountMenuOpen()) {
      event.preventDefault();
      this.authService.closeAccountMenu();
      return;
    }

    if (event.key === 'Escape' && this.audit.isSummaryModalOpen()) {
      event.preventDefault();
      this.audit.dismissSummaryModal();
      return;
    }

    const currentStep = this.audit.step();
    if (currentStep !== 3 && currentStep !== 7) return;
    if (
      this.audit.isSummaryModalOpen() ||
      this.fbAuth.isHistoryModalOpen() ||
      this.fbAuth.isHistoryDrawerOpen()
    ) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (this.isEditableTarget(event.target)) return;

    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      this.audit.selectAllCommits();
      this.showShortcutNotice(`Shortcut [S]: Selected all ${this.audit.totalCommitsCount()} commits`);
    } else if (key === 'c') {
      event.preventDefault();
      this.audit.clearAllCommits();
      this.showShortcutNotice('Shortcut [C]: Cleared commit selections');
    } else if (key === 'm') {
      event.preventDefault();
      this.showShortcutNotice('Shortcut [M]: Exporting Markdown (.md)');
      void this.audit.exportReportAsMarkdown();
    } else if (key === 'p') {
      event.preventDefault();
      this.showShortcutNotice('Shortcut [P]: Exporting PDF (.pdf)');
      void this.audit.exportReportAsPdf();
    }
  }

  readonly allSavedAudits = computed<(SavedAuditHistoryRecord | LocalSavedAuditRecord)[]>(() => {
    const merged = new Map<string, SavedAuditHistoryRecord | LocalSavedAuditRecord>();
    for (const cloudRec of this.authService.syncedAccountAudits()) {
      merged.set(cloudRec.auditId, cloudRec);
    }
    for (const localRec of this.localAuditStorage.localAudits()) {
      const existing = merged.get(localRec.auditId);
      if (!existing || localRec.snapshotSession) {
        merged.set(localRec.auditId, localRec);
      }
    }
    return Array.from(merged.values()).sort((a, b) => {
      const tA = new Date(a.updatedAtIso || a.createdAtIso || 0).getTime();
      const tB = new Date(b.updatedAtIso || b.createdAtIso || 0).getTime();
      return (Number.isFinite(tB) ? tB : 0) - (Number.isFinite(tA) ? tA : 0);
    });
  });

  /**
   * Identifies the two most significant saved audit runs in the user's history:
   * - initialAuditId: the earliest / initial scan
   * - latestAuditId: the latest optimized version
   */
  readonly significantAuditPairIds = computed<{
    initialAuditId: string | null;
    latestAuditId: string | null;
  }>(() => {
    const saved = this.allSavedAudits();
    if (!saved || saved.length === 0) {
      return { initialAuditId: null, latestAuditId: null };
    }
    if (saved.length === 1) {
      return { initialAuditId: null, latestAuditId: saved[0].auditId };
    }

    const sorted = [...saved].sort((a, b) => {
      const cmp = String(a.updatedAtIso || '').localeCompare(String(b.updatedAtIso || ''));
      if (cmp !== 0) return cmp;
      return (
        a.performanceAfter +
        a.accessibilityAfter -
        (b.performanceAfter + b.accessibilityAfter)
      );
    });

    const initial = sorted[0];
    const candidates = sorted.slice(1);
    const latest = candidates.reduce(
      (best, curr) =>
        curr.performanceAfter + curr.accessibilityAfter >=
        best.performanceAfter + best.accessibilityAfter
          ? curr
          : best,
      candidates[candidates.length - 1]
    );

    return {
      initialAuditId: initial.auditId,
      latestAuditId: latest.auditId
    };
  });

  readonly allCategories: CategoryTabItem[] = [
    { key: 'all', label: 'All' },
    { key: 'performance', label: 'Performance' },
    { key: 'accessibility', label: 'Accessibility' },
    { key: 'best-practices', label: 'Best practices' },
    { key: 'seo', label: 'SEO' },
    {
      key: 'security',
      label: 'Web application security findings',
      contextBadge: 'Light'
    }
  ];

  /**
   * Excludes 'security' (Web application security findings) when running the
   * Lighthouse-specific JSON report audit (Run 2), since Lighthouse does not include it.
   */
  readonly visibleCategories = computed<CategoryTabItem[]>(() => {
    const isLhrRun = this.audit.session()?.runPhase === 'lhr';
    if (isLhrRun) {
      return this.allCategories.filter((cat) => cat.key !== 'security');
    }
    return this.allCategories;
  });

  readonly categoriesImprovedList = computed(() => {
    const session = this.audit.session();
    if (!session) return [];
    if (session.categoriesImproved && session.categoriesImproved.length > 0) {
      return session.categoriesImproved;
    }
    const commits = session.commits ?? [];
    const isLhr = session.runPhase === 'lhr';
    const base = [
      { id: 'performance', label: 'Performance' },
      { id: 'accessibility', label: 'Accessibility' },
      { id: 'best-practices', label: 'Best practices' },
      { id: 'seo', label: 'SEO' },
      ...(isLhr ? [] : [{ id: 'security', label: 'Web application security findings (light)' }])
    ];
    return base
      .map((item) => {
        const count = commits.filter((c) => c.category === item.id).length;
        return {
          id: item.id,
          label: item.label,
          improved: count > 0,
          commitsCount: count
        };
      })
      .filter((item) => item.improved);
  });

  readonly currentPrCliCommand = computed<string>(() => {
    const pr = this.audit.prResult();
    if (!pr) return '';
    return this.audit.prCliMode() === 'inline'
      ? pr.terminalCommand ?? ''
      : pr.shortTerminalCommand ?? '';
  });

  onSelectCategoryFilter(category: LighthouseCategory): void {
    this.isReportIssuesTabActive.set(false);
    this.audit.categoryFilter.set(category);
    if (this.radarViewMode() === 'history') {
      this.radarViewMode.set('detailed');
    }
    this.triggerReportListStagger();
  }

  onSelectReportHistoryTab(): void {
    this.isReportIssuesTabActive.set(false);
    this.radarViewMode.set('history');
    void this.fbAuth.fetchSavedAuditsFromFirestore();
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const el = document.getElementById('radar-impact-heading');
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    }
  }

  onSelectReportIssuesTab(): void {
    this.isReportIssuesTabActive.set(true);
    if (this.radarViewMode() === 'history') {
      this.radarViewMode.set('detailed');
    }
    const repoMeta = this.audit.session()?.repo;
    if (!this.repoIssuesResponse() && !this.isLoadingRepoIssues()) {
      void this.fetchRepoOpenIssues(
        repoMeta?.owner || 'fresnel-sandbox',
        repoMeta?.repo || 'lumina-web-app'
      );
    }
  }

  refreshRepoIssues(): void {
    const repoMeta = this.audit.session()?.repo;
    void this.fetchRepoOpenIssues(
      repoMeta?.owner || 'fresnel-sandbox',
      repoMeta?.repo || 'lumina-web-app'
    );
  }

  setIssuesCategoryFilter(category: LighthouseCategory): void {
    this.issuesCategoryFilter.set(category);
  }

  onJumpToCategoryFromIssue(issue: GitHubRepoIssue): void {
    const targetCat: LighthouseCategory = issue.relatedCategory ?? 'all';
    const isLhrRun = this.audit.session()?.runPhase === 'lhr';
    const resolvedCat: LighthouseCategory =
      isLhrRun && targetCat === 'security' ? 'all' : targetCat;
    this.onSelectCategoryFilter(resolvedCat);
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const listEl = document.querySelector('.report-list');
        listEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }

  async fetchRepoOpenIssues(owner: string, repo: string): Promise<void> {
    this.isLoadingRepoIssues.set(true);
    try {
      const resp = await firstValueFrom(
        this.http.get<GitHubRepoIssuesResponse>(
          `/api/github/repo-issues?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`
        )
      );
      if (resp && Array.isArray(resp.issues)) {
        this.repoIssuesResponse.set(resp);
      }
    } catch {
      // Keep any existing issues response
    } finally {
      this.isLoadingRepoIssues.set(false);
    }
  }

  formatIssueRelativeTime(isoString: string): string {
    if (!isoString) return 'recently';
    const ts = new Date(isoString).getTime();
    if (Number.isNaN(ts)) return 'recently';
    const diffHours = Math.max(1, Math.round((Date.now() - ts) / (3600 * 1000)));
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays}d ago`;
  }

  formatIssueCategoryLabel(cat: GitHubRepoIssue['relatedCategory']): string {
    switch (cat) {
      case 'performance':
        return 'Performance';
      case 'accessibility':
        return 'Accessibility';
      case 'best-practices':
        return 'Best practices';
      case 'seo':
        return 'SEO';
      case 'security':
        return 'Security (Light)';
      default:
        return 'Audit Context';
    }
  }

  onRadarViewModeChanged(mode: 'detailed' | 'categories' | 'history' | 'compare'): void {
    this.radarViewMode.set(mode);
    if (mode === 'history') {
      this.isReportIssuesTabActive.set(false);
      void this.fbAuth.fetchSavedAuditsFromFirestore();
    }
  }

  toggleComparisonPanel(): void {
    this.isComparisonPanelOpen.update((v) => !v);
  }

  openComparisonPanel(): void {
    this.isComparisonPanelOpen.set(true);
  }

  isSignificantInitialAudit(record: SavedAuditHistoryRecord): boolean {
    return this.significantAuditPairIds().initialAuditId === record.auditId;
  }

  isSignificantLatestAudit(record: SavedAuditHistoryRecord): boolean {
    return this.significantAuditPairIds().latestAuditId === record.auditId;
  }

  /**
   * Auto-Compare handler invoked from any history list (History Drawer, Saved Audit History Modal,
   * View 4 Saved Audit History sub-view, or History tab). Identifies the two most significant
   * audit runs (initial scan vs. latest optimized version), ensures the report page is open,
   * expands the side-by-side comparison panel, and loads those two runs automatically.
   */
  async onAutoCompareFromHistory(): Promise<void> {
    this.fbAuth.isHistoryDrawerOpen.set(false);
    this.fbAuth.closeHistoryModal();
    this.fbAuth.setView4SubView('pr');

    const saved = this.allSavedAudits();
    const pair = this.significantAuditPairIds();
    const latestRec =
      saved.find((r) => r.auditId === pair.latestAuditId) ?? saved[0] ?? null;

    const currentStep = this.audit.step();
    const hasSession = !!this.audit.session();

    if (!hasSession) {
      if (latestRec) {
        this.repoUrl.set(latestRec.repoUrl);
        await this.audit.openSavedAuditReport(latestRec);
      } else {
        this.repoUrl.set('https://github.com/fresnel-sandbox/lumina-web-app');
        await this.audit.startAudit('https://github.com/fresnel-sandbox/lumina-web-app', 'demo');
        this.audit.skipToReport();
      }
    } else if (currentStep !== 3 && currentStep !== 7) {
      const targetStep = this.audit.session()?.runPhase === 'lhr' ? 7 : 3;
      this.audit.transitionToStep(targetStep);
    }

    this.isComparisonPanelOpen.set(true);
    this.autoCompareNonce.update((n) => n + 1);

    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const el = document.getElementById('run-compare-section');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }

  triggerReportListStagger(): void {
    if (this.reportListAnimTimer) {
      clearTimeout(this.reportListAnimTimer);
      this.reportListAnimTimer = null;
    }
    this.isReportListEntering.set(false);
    this.reportListAnimCycle.update((n) => n + 1);
    setTimeout(() => {
      this.isReportListEntering.set(true);
      this.reportListAnimTimer = setTimeout(() => {
        this.isReportListEntering.set(false);
      }, 850);
    }, 12);
  }

  async onStartLiveAudit(): Promise<void> {
    const url =
      this.repoUrl().trim() || 'https://github.com/fresnel-sandbox/lumina-web-app';
    await this.audit.startAudit(url, 'live');
  }

  async onStartDemoAudit(): Promise<void> {
    this.repoUrl.set('https://github.com/fresnel-sandbox/lumina-web-app');
    await this.audit.startAudit('https://github.com/fresnel-sandbox/lumina-web-app', 'demo');
  }

  onLhrFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    this.audit.lhrFileName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.audit.lhrJsonInput.set(reader.result);
      }
    };
    reader.readAsText(file);
  }

  async onStartLhrAudit(): Promise<void> {
    await this.audit.startLhrAudit();
  }

  async onRunLiveLighthouse(): Promise<void> {
    await this.audit.runLiveLighthouseUrl();
  }

  async onRunSearchGrounding(): Promise<void> {
    await this.audit.runSearchGrounding();
  }

  async onGoogleLoginClick(): Promise<void> {
    await this.authService.loginWithGoogle();
  }

  async onGithubLoginOrHistoryClick(): Promise<void> {
    if (this.authService.isAuthenticated()) {
      this.authService.toggleAccountMenu();
      return;
    }
    await this.authService.loginWithGitHub();
  }

  onAccountNavigateAuditHistory(): void {
    this.authService.closeAccountMenu();
    this.fbAuth.isHistoryDrawerOpen.set(false);
    this.audit.stopPolling();
    if (this.audit.step() !== 0) {
      this.audit.transitionToStep(0);
    }
    if (this.authService.isAuthenticated()) {
      void this.fbAuth.fetchSavedAuditsFromFirestore();
    }
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const heading = document.getElementById('all-runs-heading');
        if (heading) {
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          this.fbAuth.isHistoryDrawerOpen.set(true);
        }
      }, 140);
    }
  }

  onAccountNavigateSavedRepos(): void {
    this.authService.closeAccountMenu();
    this.fbAuth.isHistoryDrawerOpen.set(false);
    this.audit.stopPolling();
    if (this.audit.step() !== 0) {
      this.audit.transitionToStep(0);
    }
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const heading =
          document.getElementById('recent-repos-heading') ||
          document.getElementById('dashboard-recent-cache-strip');
        if (heading) {
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 140);
    }
  }

  async onAccountLogout(): Promise<void> {
    await this.authService.logout();
    this.showShortcutNotice('Signed out and cleared local Google profile cache.');
  }

  async onSaveAuditToAccount(): Promise<void> {
    const session = this.audit.session();
    if (!session) return;
    await this.fbAuth.saveAuditToAccount(
      session,
      this.audit.impactMetrics(),
      this.audit.selectedCommits()
    );
  }

  async onOpenSavedAudit(
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord
  ): Promise<void> {
    this.loadingDrawerAuditId.set(record.auditId);
    try {
      this.fbAuth.closeHistoryModal();
      this.fbAuth.setView4SubView('pr');
      this.repoUrl.set(record.repoUrl);
      await this.audit.openSavedAuditReport(record);
      this.fbAuth.isHistoryDrawerOpen.set(false);
    } finally {
      this.loadingDrawerAuditId.set(null);
    }
  }

  onSaveCurrentAuditLocally(format?: LocalAuditFormat): void {
    this.drawerImportError.set(null);
    this.audit.saveCurrentAuditLocally(format);
  }

  onImportLocalAuditFile(payload: { filename: string; content: string }): void {
    this.drawerImportError.set(null);
    try {
      this.localAuditStorage.importAuditFile(payload.filename, payload.content);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to parse the selected local audit file.';
      this.drawerImportError.set(msg);
    }
  }

  onExportSavedAuditRecord(payload: {
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord;
    format: LocalAuditFormat;
  }): void {
    const exported = this.localAuditStorage.exportRecordPayload(
      payload.record,
      payload.format
    );
    this.audit.triggerBrowserDownload(
      exported.filename,
      exported.content,
      undefined,
      exported.mimeType
    );
  }

  async onDeleteSavedAuditRecord(
    recordOrId: SavedAuditHistoryRecord | LocalSavedAuditRecord | string
  ): Promise<void> {
    const auditId = typeof recordOrId === 'string' ? recordOrId : recordOrId.auditId;
    this.localAuditStorage.deleteLocalAudit(auditId);

    const isCloudEligible =
      typeof recordOrId === 'string'
        ? this.fbAuth.savedAudits().some((r) => r.auditId === auditId)
        : !('storageSource' in recordOrId) || recordOrId.storageSource === 'firestore';

    if (isCloudEligible && this.fbAuth.isAuthenticated()) {
      await this.fbAuth.deleteSavedAudit(auditId);
    }
  }

  formatSavedDate(isoString: string): string {
    if (!isoString) return 'Just now';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return 'Recently';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  openDashboard(): void {
    this.audit.stopPolling();
    this.audit.transitionToStep(0);
  }

  openNewAudit(): void {
    this.audit.transitionToStep(1);
  }

  onReAuditFromDashboard(targetRepoUrl: string): void {
    this.repoUrl.set(targetRepoUrl || '');
    this.audit.transitionToStep(1);
  }

  onBack(): void {
    const current = this.audit.step();
    if (current === 1) {
      this.audit.transitionToStep(0);
    } else if (current === 2) {
      this.audit.stopPolling();
      this.audit.transitionToStep(1);
    } else if (current === 3) {
      this.audit.transitionToStep(1);
    } else if (current === 4) {
      this.audit.transitionToStep(this.audit.session()?.runPhase === 'lhr' ? 7 : 3);
    } else if (current === 5) {
      this.audit.transitionToStep(3);
    } else if (current === 6) {
      this.audit.stopPolling();
      this.audit.transitionToStep(5);
    } else if (current === 7) {
      this.audit.transitionToStep(5);
    }
  }

  isSelected(commitId: string): boolean {
    return this.audit.selectedCommitIds().has(commitId);
  }

  isDiffExpanded(commitId: string): boolean {
    return this.audit.expandedDiffIds().has(commitId);
  }

  splitDiffLines(diff: string): { text: string; type: 'meta' | 'hunk' | 'add' | 'del' | 'ctx' }[] {
    return diff.split('\n').map((line) => {
      if (
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ')
      ) {
        return { text: line, type: 'meta' };
      }
      if (line.startsWith('@@')) {
        return { text: line, type: 'hunk' };
      }
      if (line.startsWith('+')) {
        return { text: line, type: 'add' };
      }
      if (line.startsWith('-')) {
        return { text: line, type: 'del' };
      }
      return { text: line, type: 'ctx' };
    });
  }

  toCurlyQuotes(rawText: string | undefined | null): string {
    if (!rawText) return '';
    return rawText
      .replace(/(\w)'(\w)/g, '$1’$2')
      .replace(/(^|[\s(\[{<—–-])"(\S)/g, '$1“$2')
      .replace(/"/g, '”')
      .replace(/(^|[\s(\[{<—–-])'(\S)/g, '$1‘$2')
      .replace(/'/g, '’');
  }

  plainText(rawText: string | undefined | null): string {
    if (!rawText) return '';
    const cleaned = rawText
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/\*\*+/g, '')
      .replace(/__+/g, '')
      .replace(/`+/g, '')
      .replace(/(^|\s)\*+(\S)/g, '$1$2')
      .replace(/(\S)\*+(\s|$|[.,!?;:])/g, '$1$2')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/\b(?:powered\s+by|using|via|on|in)\s+(?:GCP\s+project\s+)?(?:Gemini\s*4\s*Argon(?:\s*EAP)?|gemini-4-argon|gemini-3\.8-flash|antigravity-[a-zA-Z0-9._-]+|phantom-gdemo-1)\b/gi, '')
      .replace(/\bGemini\s*4\s*Argon(?:\s*EAP)?\b/gi, '')
      .replace(/\b(?:gemini-4-argon|gemini-3\.8-flash)\b/gi, '')
      .replace(/\bantigravity-[a-zA-Z0-9._-]+\b/gi, '')
      .replace(/\bphantom-gdemo-1\b/gi, '')
      .replace(/\binteractions\/[a-zA-Z0-9._-]+\b/gi, '')
      .replace(/\/v1beta\/interactions\b/gi, '')
      .replace(/\/workspace\/[a-zA-Z0-9._-]+\//g, '')
      .replace(/\/workspace\b/g, 'the repository')
      .replace(/@import\s+font\s+stylesheets/gi, '@import stylesheets')
      .replace(/\bwith\s+display=swap\b/gi, 'with font-display:swap')
      .replace(/\(\s*\)/g, '')
      .replace(/\s+(?:using|on|via|with)\s*(?=[.,!?;:]|$)/gi, '')
      .replace(/\s+([.,!?;:])/g, '$1')
      .replace(/([a-z0-9%"'’”\]}>])([.!?])(["'‘“(\[{]*[A-Z])/g, '$1$2 $3')
      .replace(/([A-Z]{2,})([.!?])(["'‘“(\[{]*[A-Z])/g, '$1$2 $3')
      .replace(/\s+/g, ' ')
      .trim();
    return this.toCurlyQuotes(cleaned);
  }

  imperativeHeadline(rawText: string | undefined | null): string {
    const cleaned = this.plainText(rawText).replace(/[.!?]+$/, '').trim();
    if (!cleaned) return '';
    const map: Record<string, string> = {
      reading: 'Read',
      reads: 'Read',
      read: 'Read',
      inspecting: 'Inspect',
      inspects: 'Inspect',
      inspected: 'Inspect',
      scanning: 'Scan',
      scans: 'Scan',
      scanned: 'Scan',
      mapping: 'Map',
      maps: 'Map',
      mapped: 'Map',
      preparing: 'Prepare',
      prepares: 'Prepare',
      prepared: 'Prepare',
      parsing: 'Parse',
      parses: 'Parse',
      parsed: 'Parse',
      cloning: 'Clone',
      clones: 'Clone',
      cloned: 'Clone',
      classifying: 'Classify',
      classifies: 'Classify',
      classified: 'Classify',
      clearing: 'Clear',
      clears: 'Clear',
      cleared: 'Clear',
      closing: 'Close',
      closes: 'Close',
      closed: 'Close',
      adding: 'Add',
      adds: 'Add',
      added: 'Add',
      converting: 'Convert',
      converts: 'Convert',
      converted: 'Convert',
      replacing: 'Replace',
      replaces: 'Replace',
      replaced: 'Replace',
      splitting: 'Split',
      splits: 'Split',
      fixing: 'Fix',
      fixes: 'Fix',
      fixed: 'Fix',
      enforcing: 'Enforce',
      enforces: 'Enforce',
      enforced: 'Enforce',
      removing: 'Remove',
      removes: 'Remove',
      removed: 'Remove',
      validating: 'Validate',
      validates: 'Validate',
      validated: 'Validate',
      raising: 'Raise',
      raises: 'Raise',
      raised: 'Raise',
      generating: 'Generate',
      generates: 'Generate',
      generated: 'Generate',
      auditing: 'Audit',
      audits: 'Audit',
      audited: 'Audit',
      analyzing: 'Analyze',
      analyzes: 'Analyze',
      analyzed: 'Analyze',
      checking: 'Check',
      checks: 'Check',
      checked: 'Check',
      updating: 'Update',
      updates: 'Update',
      updated: 'Update',
      optimizing: 'Optimize',
      optimizes: 'Optimize',
      optimized: 'Optimize',
      securing: 'Secure',
      secures: 'Secure',
      secured: 'Secure',
      sanitizing: 'Sanitize',
      sanitizes: 'Sanitize',
      sanitized: 'Sanitize'
    };
    const m = cleaned.match(/^([A-Za-z]+)(\b[\s\S]*)$/);
    if (!m) return cleaned;
    const lower = m[1].toLowerCase();
    if (map[lower]) {
      return `${map[lower]}${m[2]}`;
    }
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  detailTense(
    rawText: string | undefined | null,
    mode: 'active' | 'done' = 'done',
    maxChars = 240
  ): string {
    const shortened = this.cleanSentences(rawText, maxChars);
    if (!shortened) return '';
    const thirdToPast: Record<string, string> = {
      adds: 'added',
      converts: 'converted',
      replaces: 'replaced',
      splits: 'split',
      fixes: 'fixed',
      enforces: 'enforced',
      removes: 'removed',
      validates: 'validated',
      raises: 'raised',
      generates: 'generated',
      creates: 'created',
      updates: 'updated',
      improves: 'improved',
      eliminates: 'eliminated',
      reduces: 'reduced',
      prevents: 'prevented',
      ensures: 'ensured',
      restores: 'restored',
      wires: 'wired',
      injects: 'injected',
      applies: 'applied',
      sets: 'set',
      wraps: 'wrapped',
      moves: 'moved',
      defers: 'deferred',
      preloads: 'preloaded',
      sanitizes: 'sanitized',
      escapes: 'escaped',
      blocks: 'blocked',
      restricts: 'restricted',
      hardens: 'hardened',
      reads: 'read',
      inspects: 'inspected',
      scans: 'scanned',
      maps: 'mapped',
      prepares: 'prepared',
      parses: 'parsed',
      traces: 'traced',
      correlates: 'correlated',
      identifies: 'identified',
      clones: 'cloned',
      classifies: 'classified',
      clears: 'cleared',
      closes: 'closed'
    };
    const baseToPast: Record<string, string> = {
      add: 'Added',
      convert: 'Converted',
      replace: 'Replaced',
      split: 'Split',
      fix: 'Fixed',
      enforce: 'Enforced',
      clone: 'Cloned',
      classify: 'Classified',
      clear: 'Cleared',
      close: 'Closed',
      remove: 'Removed',
      validate: 'Validated',
      raise: 'Raised',
      generate: 'Generated',
      create: 'Created',
      update: 'Updated',
      improve: 'Improved',
      eliminate: 'Eliminated',
      reduce: 'Reduced',
      prevent: 'Prevented',
      ensure: 'Ensured',
      restore: 'Restored',
      wire: 'Wired',
      inject: 'Injected',
      apply: 'Applied',
      set: 'Set',
      wrap: 'Wrapped',
      move: 'Moved',
      defer: 'Deferred',
      preload: 'Preloaded',
      sanitize: 'Sanitized',
      escape: 'Escaped',
      block: 'Blocked',
      restrict: 'Restricted',
      harden: 'Hardened',
      read: 'Read',
      inspect: 'Inspected',
      scan: 'Scanned',
      map: 'Mapped',
      prepare: 'Prepared',
      parse: 'Parsed',
      trace: 'Traced',
      correlate: 'Correlated',
      identify: 'Identified'
    };
    const baseToIng: Record<string, string> = {
      read: 'Reading',
      inspect: 'Inspecting',
      scan: 'Scanning',
      map: 'Mapping',
      prepare: 'Preparing',
      parse: 'Parsing',
      add: 'Adding',
      convert: 'Converting',
      replace: 'Replacing',
      split: 'Splitting',
      fix: 'Fixing',
      enforce: 'Enforcing',
      remove: 'Removing',
      validate: 'Validating',
      raise: 'Raising',
      generate: 'Generating',
      trace: 'Tracing',
      correlate: 'Correlating',
      identify: 'Identifying'
    };

    let result = shortened.replace(
      /\b(and|or|,)\s+([a-z]+s)\b/gi,
      (full, conj, verb) => {
        const mapped = thirdToPast[verb.toLowerCase()];
        return mapped ? `${conj} ${mapped}` : full;
      }
    );

    const m = result.match(/^([A-Za-z]+)(\b[\s\S]*)$/);
    if (!m) return result;
    const firstLower = m[1].toLowerCase();
    const rest = m[2];
    if (thirdToPast[firstLower]) {
      const p = thirdToPast[firstLower];
      return p.charAt(0).toUpperCase() + p.slice(1) + rest;
    }
    if (mode === 'active' && baseToIng[firstLower]) {
      return `${baseToIng[firstLower]}${rest}`;
    }
    if (baseToPast[firstLower]) {
      return `${baseToPast[firstLower]}${rest}`;
    }
    return result;
  }

  cleanSentences(rawText: string | undefined | null, maxChars = 240): string {
    const cleaned = this.plainText(rawText);
    if (!cleaned) return '';
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length === 0) return '';

    let result = '';
    for (const s of sentences) {
      const norm = /[.!?]$/.test(s) ? s : `${s}.`;
      if (!result) {
        result = norm;
      } else if (result.length + 1 + norm.length <= maxChars) {
        result = `${result} ${norm}`;
      } else {
        break;
      }
    }
    return result;
  }

  copyText(key: string, text: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      this.copiedKey.set(key);
      setTimeout(() => {
        if (this.copiedKey() === key) {
          this.copiedKey.set(null);
        }
      }, 1500);
    }
  }

  async onPushBranchClick(): Promise<void> {
    const pr = this.audit.prResult();
    const session = this.audit.session();
    const repoUrl = pr?.repoUrl || session?.repo?.url || '';
    const branch =
      pr?.headBranch ||
      (session?.runPhase === 'lhr' ? 'fresnel/lhr-fixes' : 'fresnel/code-audit');
    await this.audit.pushBranchToGithub(repoUrl, branch, this.fbAuth.githubAccessToken());
  }

  async onRetryPushFromModal(): Promise<void> {
    const pr = this.audit.prResult();
    const session = this.audit.session();
    const repoUrl = pr?.repoUrl || session?.repo?.url || '';
    const branch =
      pr?.headBranch ||
      (session?.runPhase === 'lhr' ? 'fresnel/lhr-fixes' : 'fresnel/code-audit');
    await this.audit.pushBranchToGithub(repoUrl, branch, this.fbAuth.githubAccessToken());
  }

  onOpenPushTroubleshooter(customError?: string): void {
    const defaultErr =
      customError ||
      'Failed to push commit to GitHub: Request contains an invalid argument.';
    this.audit.triggerPushFailure(defaultErr);
  }

  onLoadSampleAudits(): void {
    this.localAuditStorage.loadSampleAudits();
  }

  onResumeCachedAudit(entry: CachedRepositoryAuditEntry): void {
    this.audit.restoreCachedAudit(entry);
  }
}
