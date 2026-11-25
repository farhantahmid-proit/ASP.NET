export type LighthouseCategory =
  | 'all'
  | 'performance'
  | 'accessibility'
  | 'best-practices'
  | 'seo'
  | 'security';

export type AuditMode = 'live' | 'demo';
export type AuditRunPhase = 'static' | 'lhr';

export type FlowStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface FresnelLore {
  name: string;
  pronunciation: string;
  origin: string;
  quote: string;
  explanation: string;
}

export interface RepoMetadata {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  isDemo?: boolean;
}

export interface AuditCommit {
  id: string;
  sha: string;
  fullSha: string;
  category: Exclude<LighthouseCategory, 'all'>;
  categoryLabel: string;
  securityContext?: string;
  securityPattern?: string;
  ruleId: string;
  ruleTitle?: string;
  impact?: string;
  analyzer?: string;
  fixConfidence?: 'auto-verified' | 'advisory-review';
  patchVerified?: boolean;
  lhrAuditTitle?: string;
  lhrDisplayValue?: string;
  lhrTargetSelector?: string;
  lhrAreaImproved?: string;
  title: string;
  commitMessage: string;
  summary: string;
  files: string[];
  additions: number;
  deletions: number;
  author: string;
  date: string;
  body: string;
  diff: string;
}

export interface TelemetryStep {
  index: number;
  phase: string;
  category: string;
  headline: string;
  narrative: string;
  commitId?: string | null;
  sha?: string;
  ruleId?: string;
}

export interface CategoryImprovedItem {
  id: string;
  label: string;
  focus?: string;
  improved: boolean;
  commitsCount: number;
  rules?: string[];
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface GroundingResult {
  model: string;
  query: string;
  summary: string;
  sources: GroundingSource[];
  groundedAt: string;
}

export interface ReportExportBundle {
  markdownFilename: string;
  pdfFilename: string;
  selectedCount: number;
  markdownContent: string;
  markdownDownloadUrl: string;
  pdfDownloadUrl: string;
}

export interface LinterRuleHit {
  ruleId: string;
  count: number;
}

export interface LinterToolDiagnostics {
  filesScanned: number;
  filesModified: number;
  violationsFound: number;
  autoFixedCount: number;
  remainingWarnings: number;
  rulesTriggered: LinterRuleHit[];
}

export interface LinterPipelineSummary {
  eslint: LinterToolDiagnostics;
  stylelint: LinterToolDiagnostics;
}

export interface JscodeshiftPipelineSummary {
  engine: string;
  transformsRun: number;
  commitsGenerated: number;
  a11yPropertiesInjected: number;
  domElementsUpdated: number;
}

export interface AuditSession {
  id: string;
  interactionId: string;
  engineType?: string;
  liveLighthouseAvailable?: boolean;
  scanDurationMs?: number;
  filesScanned?: number;
  workspaceSource?: string;
  jscodeshiftSummary?: JscodeshiftPipelineSummary | null;
  linterSummary?: LinterPipelineSummary | null;
  deterministicMetrics?: {
    performanceBefore: number;
    performanceAfter: number;
    accessibilityBefore: number;
    accessibilityAfter: number;
    bestPracticesBefore: number;
    bestPracticesAfter: number;
    seoBefore: number;
    seoAfter: number;
    securityBefore: number;
    securityAfter: number;
  } | null;
  mode: AuditMode;
  runPhase: AuditRunPhase;
  categoriesImproved?: CategoryImprovedItem[];
  lhrMeta?: {
    lighthouseVersion: string;
    requestedUrl: string;
    fetchTime: string;
  } | null;
  status: 'in_progress' | 'completed';
  progressPercent: number;
  estimatedRemainingMinutes?: number;
  estimatedRemainingSeconds?: number;
  estimatedTimeRemainingLabel?: string;
  groundingData?: GroundingResult | null;
  repo: RepoMetadata;
  branch: string;
  categories: string[];
  currentStep: TelemetryStep;
  steps: TelemetryStep[];
  totalSteps: number;
  commits: AuditCommit[];
  totalCommits: number;
  pr: PullRequestResult | null;
}

export interface PatchBundle {
  filename: string;
  selectedCount: number;
  patchContent: string;
  downloadUrl: string;
  instructions: {
    cloneCmd: string;
    branchCmd: string;
    applyAmCmd: string;
    applyDiffCmd: string;
    verifyCmd: string;
    pushCmd: string;
  };
}

export interface PullRequestResult {
  number: number;
  mode: AuditMode;
  runPhase?: AuditRunPhase;
  title: string;
  body?: string;
  url: string;
  compareUrl?: string;
  repoUrl: string;
  repoFullName: string;
  baseBranch: string;
  headBranch: string;
  patchFilename?: string;
  patchDownloadUrl?: string;
  terminalCommand?: string;
  shortTerminalCommand?: string;
  createdAt: string;
  selectedCommits: AuditCommit[];
  totalAdditions: number;
  totalDeletions: number;
  filesTouched: string[];
}

export interface RadarMetricAxis {
  id: string;
  label: string;
  shortLabel: string;
  group: 'performance' | 'accessibility' | 'best-practices' | 'seo' | 'security';
  before: number;
  after: number;
  delta: number;
  unit: string;
  description: string;
  contributingCommits: number;
}

export interface AuditImpactMetrics {
  performanceBefore: number;
  performanceAfter: number;
  accessibilityBefore: number;
  accessibilityAfter: number;
  bestPracticesBefore: number;
  bestPracticesAfter: number;
  seoBefore: number;
  seoAfter: number;
  securityBefore: number;
  securityAfter: number;
  detailedAxes: RadarMetricAxis[];
  categoryAxes: RadarMetricAxis[];
}

export interface SavedAuditHistoryRecord {
  auditId: string;
  ownerId: string;
  repoFullName: string;
  repoUrl: string;
  branch?: string;
  runPhase: AuditRunPhase;
  mode: AuditMode;
  totalCommitsCount: number;
  selectedCommitsCount: number;
  performanceBefore: number;
  performanceAfter: number;
  accessibilityBefore: number;
  accessibilityAfter: number;
  bestPracticesBefore: number;
  bestPracticesAfter: number;
  seoBefore: number;
  seoAfter: number;
  securityBefore: number;
  securityAfter: number;
  summaryNotes: string;
  commitTitles: string[];
  createdAtIso: string;
  updatedAtIso: string;
}

export interface UserSessionState {
  isAuthenticated: boolean;
  isAuthReady: boolean;
  uid: string | null;
  displayName: string | null;
  githubUsername: string | null;
  photoURL: string | null;
  providerId: 'github.com' | 'google.com' | null;
  githubAccessToken: string | null;
  projectId: string;
  authDomain: string;
  firestoreDatabaseId: string;
  profilePath: string | null;
  savedAuditsCount: number;
}

export interface GitHubRepoRealtimeStats {
  fullName: string;
  owner: string;
  repo: string;
  htmlUrl: string;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  defaultBranch: string;
  language: string;
  updatedAt: string;
  description: string;
  source: 'github-live' | 'sandbox-live' | 'github-fallback';
}

export interface GitHubRepoIssueLabel {
  name: string;
  color: string;
  description?: string;
}

export interface GitHubRepoIssue {
  id: number;
  number: number;
  title: string;
  state: 'open';
  htmlUrl: string;
  authorLogin: string;
  authorAvatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  commentsCount: number;
  bodyExcerpt: string;
  labels: GitHubRepoIssueLabel[];
  relatedCategory: Exclude<LighthouseCategory, 'all'>;
  matchedCommitRule?: string;
}

export interface GitHubRepoIssuesResponse {
  fullName: string;
  owner: string;
  repo: string;
  openIssuesTotal: number;
  source: 'github-api' | 'sandbox-live' | 'github-fallback';
  issues: GitHubRepoIssue[];
}

export interface GitHubSshDiagnosticStatus {
  status: 'ready' | 'missing_key' | 'agent_unloaded' | 'github_unregistered';
  missingSshKey: boolean;
  sshDirExists: boolean;
  detectedPublicKeys: string[];
  hasMatchingPrivateKey: boolean;
  agentLoadedCount: number | null;
  hasConfigFile: boolean;
  hasGithubConfigEntry: boolean;
  sshKeygenAvailable: boolean;
  gitAvailable: boolean;
  probeAttempted: boolean;
  probeAuthenticated: boolean | null;
  probeMessage: string | null;
  githubAccountKeysCount: number | null;
  checkedAtIso: string;
  recommendations: string[];
}

export type LocalAuditFormat = 'json' | 'toon' | 'markdown';

export interface LocalSavedAuditRecord extends SavedAuditHistoryRecord {
  storageSource: 'local' | 'imported' | 'firestore';
  savedFormat: LocalAuditFormat;
  snapshotSession?: AuditSession | null;
}

export interface CachedRepositoryAuditEntry {
  cacheKey: string;
  auditId: string;
  repoFullName: string;
  repoUrl: string;
  branch: string;
  mode: AuditMode;
  runPhase: AuditRunPhase;
  cachedAtIso: string;
  totalCommitsCount: number;
  selectedCommitIds: string[];
  categoryFilter: LighthouseCategory;
  performanceBefore: number;
  performanceAfter: number;
  accessibilityBefore: number;
  accessibilityAfter: number;
  bestPracticesBefore: number;
  bestPracticesAfter: number;
  seoBefore: number;
  seoAfter: number;
  securityBefore: number;
  securityAfter: number;
  session: AuditSession;
}

export interface ExecutiveSummaryImprovement {
  category: string;
  title: string;
  impact: string;
}

export interface ExecutiveSummaryResult {
  headline: string;
  summary: string;
  topImprovements: ExecutiveSummaryImprovement[];
  recommendedNextStep: string;
  model: string;
  generatedAtIso: string;
}


