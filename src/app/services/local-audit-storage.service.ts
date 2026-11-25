import { Injectable, signal } from '@angular/core';
import {
  AuditCommit,
  AuditImpactMetrics,
  AuditMode,
  AuditRunPhase,
  AuditSession,
  LighthouseCategory,
  LocalAuditFormat,
  LocalSavedAuditRecord,
  SavedAuditHistoryRecord
} from '../models/audit.model';

export const LOCAL_SAVED_AUDITS_STORAGE_KEY = 'fresnel_local_saved_audits_v1';
const MAX_LOCAL_AUDITS = 20;

function sanitizeSlug(raw: string, fallback = 'repository'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

function sanitizeAuditId(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned || `local_${Date.now().toString(36)}`;
}

function sanitizeHttpUrl(raw: unknown, fallbackRepo: string): string {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (/^https?:\/\/[a-zA-Z0-9.-]+/i.test(val)) {
    return val.slice(0, 500);
  }
  return `https://github.com/${fallbackRepo}`;
}

function clampScore(val: unknown, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function clampCount(val: unknown, fallback = 0): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1000, Math.round(num)));
}

function normalizeIsoDate(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw.trim());
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function categoryLabelFor(category: Exclude<LighthouseCategory, 'all'>): string {
  switch (category) {
    case 'performance':
      return 'Performance';
    case 'accessibility':
      return 'Accessibility';
    case 'best-practices':
      return 'Best practices';
    case 'seo':
      return 'SEO';
    case 'security':
      return 'Web application security findings';
  }
}

function normalizeCategory(raw: unknown): Exclude<LighthouseCategory, 'all'> {
  const val = String(raw || '')
    .trim()
    .toLowerCase();
  if (val === 'performance' || val === 'perf') return 'performance';
  if (val === 'accessibility' || val === 'a11y') return 'accessibility';
  if (val === 'best-practices' || val === 'best practices') return 'best-practices';
  if (val === 'seo') return 'seo';
  if (val === 'security') return 'security';
  return 'performance';
}

function escapeToonScalar(raw: string): string {
  const s = String(raw ?? '').replace(/\r?\n/g, ' ').trim();
  if (!s) return '""';
  if (/[,"{}[\]:\\]|^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

function unquoteToonScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaping = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\' && inQuotes) {
      current += ch;
      escaping = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(unquoteToonScalar(current));
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(unquoteToonScalar(current));
  return cells;
}

function buildSynthesizedCommitsFromTitles(
  titles: string[],
  repoFullName: string
): AuditCommit[] {
  const cleanTitles = titles.length > 0 ? titles : [`Review remediation patch for ${repoFullName}`];
  return cleanTitles.slice(0, 25).map((title, idx) => {
    const lower = title.toLowerCase();
    let category: Exclude<LighthouseCategory, 'all'> = 'performance';
    if (
      lower.includes('a11y') ||
      lower.includes('aria') ||
      lower.includes('contrast') ||
      lower.includes('accessibility') ||
      lower.includes('focus')
    ) {
      category = 'accessibility';
    } else if (lower.includes('seo') || lower.includes('meta') || lower.includes('canonical')) {
      category = 'seo';
    } else if (
      lower.includes('security') ||
      lower.includes('xss') ||
      lower.includes('csp') ||
      lower.includes('sanitize')
    ) {
      category = 'security';
    } else if (lower.includes('eslint') || lower.includes('best-practice') || lower.includes('lint')) {
      category = 'best-practices';
    }
    const shaSeed = `${idx + 1}`.padStart(2, '0');
    const sha = `loc${shaSeed}a7`;
    return {
      id: `imported-commit-${idx + 1}`,
      sha,
      fullSha: `${sha}${'0'.repeat(33)}`,
      category,
      categoryLabel: categoryLabelFor(category),
      ruleId: `${category}-local-snapshot`,
      title,
      commitMessage: title,
      summary: `Restored from locally saved audit snapshot for ${repoFullName}.`,
      files: ['src/app/app.component.html'],
      additions: 4,
      deletions: 1,
      author: 'Fresnel Local Snapshot <fresnel@local>',
      date: new Date().toUTCString(),
      body: `Restored locally saved commit: ${title}`,
      diff: [
        'diff --git a/src/app/app.component.html b/src/app/app.component.html',
        '--- a/src/app/app.component.html',
        '+++ b/src/app/app.component.html',
        '@@ -1,1 +1,2 @@',
        ' <!-- Restored from local snapshot -->',
        `+<!-- ${title.replace(/-->/g, '--')} -->`
      ].join('\n')
    };
  });
}

export function buildSynthesizedSessionFromRecord(
  record: SavedAuditHistoryRecord,
  commitsOverride?: AuditCommit[]
): AuditSession {
  const parts = (record.repoFullName || 'owner/repository').split('/');
  const owner = parts[0] || 'owner';
  const repo = parts.slice(1).join('/') || 'repository';
  const commits =
    commitsOverride && commitsOverride.length > 0
      ? commitsOverride
      : buildSynthesizedCommitsFromTitles(record.commitTitles, record.repoFullName);

  return {
    id: record.auditId,
    interactionId: `local-${record.auditId}`,
    engineType: 'oss-local-snapshot',
    liveLighthouseAvailable: false,
    filesScanned: Math.max(commits.length * 2, 4),
    workspaceSource: 'local-saved-snapshot',
    deterministicMetrics: {
      performanceBefore: record.performanceBefore,
      performanceAfter: record.performanceAfter,
      accessibilityBefore: record.accessibilityBefore,
      accessibilityAfter: record.accessibilityAfter,
      bestPracticesBefore: record.bestPracticesBefore,
      bestPracticesAfter: record.bestPracticesAfter,
      seoBefore: record.seoBefore,
      seoAfter: record.seoAfter,
      securityBefore: record.securityBefore,
      securityAfter: record.securityAfter
    },
    mode: record.mode || 'live',
    runPhase: record.runPhase || 'static',
    status: 'completed',
    progressPercent: 100,
    repo: {
      owner,
      repo,
      fullName: record.repoFullName,
      url: record.repoUrl,
      isDemo: record.mode === 'demo'
    },
    branch: record.branch || 'main',
    categories:
      record.runPhase === 'lhr'
        ? ['performance', 'accessibility', 'best-practices', 'seo']
        : ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
    currentStep: {
      index: 0,
      phase: 'Restored',
      category: 'Local Snapshot',
      headline: `Loaded saved audit for ${record.repoFullName}`,
      narrative: record.summaryNotes || 'Restored from local storage.'
    },
    steps: [],
    totalSteps: 1,
    commits,
    totalCommits: commits.length,
    pr: null
  };
}

export function buildLocalSavedAuditRecord(
  session: AuditSession,
  impact: AuditImpactMetrics,
  selectedCommits: AuditCommit[],
  format: LocalAuditFormat = 'json',
  existingAuditId?: string
): LocalSavedAuditRecord {
  const repoFullName = (session.repo?.fullName || 'owner/repository').slice(0, 200);
  const repoUrl = sanitizeHttpUrl(session.repo?.url, repoFullName);
  const runPhase: AuditRunPhase = session.runPhase === 'lhr' ? 'lhr' : 'static';
  const mode: AuditMode = session.mode === 'demo' ? 'demo' : 'live';
  const nowIso = new Date().toISOString();
  const auditId = sanitizeAuditId(
    existingAuditId || `local_${session.id}_${runPhase}`
  );

  const chosen = selectedCommits.length > 0 ? selectedCommits : session.commits;
  const commitTitles = chosen.slice(0, 25).map((c) => String(c.title || 'Atomic commit').slice(0, 240));
  const perfBefore = clampScore(impact.performanceBefore, 64);
  const perfAfter = clampScore(impact.performanceAfter, 92);
  const a11yBefore = clampScore(impact.accessibilityBefore, 70);
  const a11yAfter = clampScore(impact.accessibilityAfter, 95);

  const summaryNotes = `${repoFullName} (${
    runPhase === 'lhr' ? 'Run 2 LHR JSON' : 'Run 1 Static Audit'
  }): ${chosen.length} of ${session.commits.length} commits selected. Performance +${Math.max(
    0,
    perfAfter - perfBefore
  )} pts, Accessibility +${Math.max(0, a11yAfter - a11yBefore)} pts.`.slice(0, 1000);

  const compactSession: AuditSession = {
    ...session,
    steps: [],
    commits: (session.commits || []).slice(0, 30)
  };

  return {
    auditId,
    ownerId: 'local',
    repoFullName,
    repoUrl,
    branch: (session.branch || 'main').slice(0, 100),
    runPhase,
    mode,
    totalCommitsCount: clampCount(session.commits.length, chosen.length),
    selectedCommitsCount: clampCount(chosen.length, 0),
    performanceBefore: perfBefore,
    performanceAfter: perfAfter,
    accessibilityBefore: a11yBefore,
    accessibilityAfter: a11yAfter,
    bestPracticesBefore: clampScore(impact.bestPracticesBefore, 76),
    bestPracticesAfter: clampScore(impact.bestPracticesAfter, 94),
    seoBefore: clampScore(impact.seoBefore, 80),
    seoAfter: clampScore(impact.seoAfter, 96),
    securityBefore: clampScore(impact.securityBefore, 72),
    securityAfter: clampScore(impact.securityAfter, 92),
    summaryNotes,
    commitTitles,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    storageSource: 'local',
    savedFormat: format,
    snapshotSession: compactSession
  };
}

export interface ConsolidatedRepoSummary {
  repoFullName: string;
  owner: string;
  repoUrl: string;
  runCount: number;
  latestAuditIso: string;
  earliestAuditIso: string;
  cumulativePerformanceLift: number;
  cumulativeAccessibilityLift: number;
  latestPerformanceBefore: number;
  latestPerformanceAfter: number;
  latestAccessibilityBefore: number;
  latestAccessibilityAfter: number;
}

export interface ConsolidatedAuditHistoryReport {
  format: 'fresnel-audit-history-bundle/v1';
  exportedAtIso: string;
  summary: {
    totalAudits: number;
    uniqueRepositories: number;
    uniqueOwners: number;
    avgPerformanceBefore: number;
    avgPerformanceAfter: number;
    avgPerformanceLift: number;
    cumulativePerformanceLift: number;
    avgAccessibilityBefore: number;
    avgAccessibilityAfter: number;
    avgAccessibilityLift: number;
    cumulativeAccessibilityLift: number;
    totalCommitsSelected: number;
    dateRange: {
      earliestIso: string | null;
      latestIso: string | null;
    };
  };
  repositories: ConsolidatedRepoSummary[];
  records: LocalSavedAuditRecord[];
}

export function toNormalizedLocalRecord(
  record: SavedAuditHistoryRecord | LocalSavedAuditRecord
): LocalSavedAuditRecord {
  if ('storageSource' in record) {
    return {
      ...record,
      savedFormat: record.savedFormat || 'json'
    };
  }
  return {
    ...record,
    storageSource: 'firestore',
    savedFormat: 'json',
    snapshotSession: buildSynthesizedSessionFromRecord(record)
  };
}

export function serializeAuditToJson(record: LocalSavedAuditRecord): string {
  const payload = {
    format: 'fresnel-audit-json/v1',
    savedAtIso: new Date().toISOString(),
    record: {
      ...record,
      savedFormat: 'json' as LocalAuditFormat
    }
  };
  return JSON.stringify(payload, null, 2);
}

export function buildConsolidatedAuditHistoryReport(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
): ConsolidatedAuditHistoryReport {
  const normalized = records
    .map((rec) => toNormalizedLocalRecord(rec))
    .sort((a, b) => {
      const tA = new Date(a.updatedAtIso || a.createdAtIso || 0).getTime();
      const tB = new Date(b.updatedAtIso || b.createdAtIso || 0).getTime();
      return (Number.isFinite(tB) ? tB : 0) - (Number.isFinite(tA) ? tA : 0);
    });

  const owners = new Set<string>();
  const repoMap = new Map<string, ConsolidatedRepoSummary>();

  let sumPerfBefore = 0;
  let sumPerfAfter = 0;
  let cumulativePerfLift = 0;
  let sumA11yBefore = 0;
  let sumA11yAfter = 0;
  let cumulativeA11yLift = 0;
  let totalCommitsSelected = 0;
  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  let earliestIso: string | null = null;
  let latestIso: string | null = null;

  for (const rec of normalized) {
    const repoName = (rec.repoFullName || 'owner/repository').trim();
    const owner = repoName.includes('/') ? repoName.split('/')[0].trim() || 'ungrouped' : 'ungrouped';
    owners.add(owner.toLowerCase());

    const perfBefore = clampScore(rec.performanceBefore, 0);
    const perfAfter = clampScore(rec.performanceAfter, 0);
    const a11yBefore = clampScore(rec.accessibilityBefore, 0);
    const a11yAfter = clampScore(rec.accessibilityAfter, 0);
    const perfLift = Math.max(0, perfAfter - perfBefore);
    const a11yLift = Math.max(0, a11yAfter - a11yBefore);

    sumPerfBefore += perfBefore;
    sumPerfAfter += perfAfter;
    cumulativePerfLift += perfLift;
    sumA11yBefore += a11yBefore;
    sumA11yAfter += a11yAfter;
    cumulativeA11yLift += a11yLift;
    totalCommitsSelected += Math.max(0, rec.selectedCommitsCount || 0);

    const recIso = rec.updatedAtIso || rec.createdAtIso || new Date().toISOString();
    const ts = new Date(recIso).getTime();
    if (Number.isFinite(ts)) {
      if (ts < earliestMs) {
        earliestMs = ts;
        earliestIso = recIso;
      }
      if (ts > latestMs) {
        latestMs = ts;
        latestIso = recIso;
      }
    }

    const repoKey = repoName.toLowerCase();
    const existing = repoMap.get(repoKey);
    if (!existing) {
      repoMap.set(repoKey, {
        repoFullName: repoName,
        owner,
        repoUrl: rec.repoUrl,
        runCount: 1,
        latestAuditIso: recIso,
        earliestAuditIso: recIso,
        cumulativePerformanceLift: perfLift,
        cumulativeAccessibilityLift: a11yLift,
        latestPerformanceBefore: perfBefore,
        latestPerformanceAfter: perfAfter,
        latestAccessibilityBefore: a11yBefore,
        latestAccessibilityAfter: a11yAfter
      });
    } else {
      existing.runCount += 1;
      existing.cumulativePerformanceLift += perfLift;
      existing.cumulativeAccessibilityLift += a11yLift;
      if (Number.isFinite(ts) && ts < new Date(existing.earliestAuditIso).getTime()) {
        existing.earliestAuditIso = recIso;
      }
    }
  }

  const count = normalized.length;
  const repositories = Array.from(repoMap.values()).sort(
    (a, b) =>
      b.cumulativePerformanceLift +
      b.cumulativeAccessibilityLift -
      (a.cumulativePerformanceLift + a.cumulativeAccessibilityLift)
  );

  return {
    format: 'fresnel-audit-history-bundle/v1',
    exportedAtIso: new Date().toISOString(),
    summary: {
      totalAudits: count,
      uniqueRepositories: repositories.length,
      uniqueOwners: owners.size,
      avgPerformanceBefore: count > 0 ? Math.round(sumPerfBefore / count) : 0,
      avgPerformanceAfter: count > 0 ? Math.round(sumPerfAfter / count) : 0,
      avgPerformanceLift: count > 0 ? Math.round(cumulativePerfLift / count) : 0,
      cumulativePerformanceLift: cumulativePerfLift,
      avgAccessibilityBefore: count > 0 ? Math.round(sumA11yBefore / count) : 0,
      avgAccessibilityAfter: count > 0 ? Math.round(sumA11yAfter / count) : 0,
      avgAccessibilityLift: count > 0 ? Math.round(cumulativeA11yLift / count) : 0,
      cumulativeAccessibilityLift: cumulativeA11yLift,
      totalCommitsSelected,
      dateRange: {
        earliestIso,
        latestIso
      }
    },
    repositories,
    records: normalized
  };
}

export function serializeConsolidatedAuditHistoryJson(
  records: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
): string {
  return JSON.stringify(buildConsolidatedAuditHistoryReport(records), null, 2);
}

export function serializeAuditToToon(record: LocalSavedAuditRecord): string {
  const commits = record.snapshotSession?.commits?.length
    ? record.snapshotSession.commits
    : buildSynthesizedCommitsFromTitles(record.commitTitles, record.repoFullName);

  const lines: string[] = [
    'format: fresnel-audit-toon/v1',
    `auditId: ${escapeToonScalar(record.auditId)}`,
    `repoFullName: ${escapeToonScalar(record.repoFullName)}`,
    `repoUrl: ${escapeToonScalar(record.repoUrl)}`,
    `branch: ${escapeToonScalar(record.branch || 'main')}`,
    `runPhase: ${record.runPhase}`,
    `mode: ${record.mode}`,
    `totalCommitsCount: ${record.totalCommitsCount}`,
    `selectedCommitsCount: ${record.selectedCommitsCount}`,
    `createdAtIso: ${escapeToonScalar(record.createdAtIso)}`,
    `updatedAtIso: ${escapeToonScalar(record.updatedAtIso)}`,
    `summaryNotes: ${escapeToonScalar(record.summaryNotes || '')}`,
    'scores:',
    `  performanceBefore: ${record.performanceBefore}`,
    `  performanceAfter: ${record.performanceAfter}`,
    `  accessibilityBefore: ${record.accessibilityBefore}`,
    `  accessibilityAfter: ${record.accessibilityAfter}`,
    `  bestPracticesBefore: ${record.bestPracticesBefore}`,
    `  bestPracticesAfter: ${record.bestPracticesAfter}`,
    `  seoBefore: ${record.seoBefore}`,
    `  seoAfter: ${record.seoAfter}`,
    `  securityBefore: ${record.securityBefore}`,
    `  securityAfter: ${record.securityAfter}`,
    `commitTitles[${record.commitTitles.length}]:`
  ];

  for (const t of record.commitTitles) {
    lines.push(`  - ${escapeToonScalar(t)}`);
  }

  lines.push(
    `commits[${commits.length}]{id,sha,category,ruleId,title,additions,deletions,files,summary}:`
  );
  for (const c of commits) {
    const row = [
      escapeToonScalar(c.id),
      escapeToonScalar(c.sha),
      escapeToonScalar(c.category),
      escapeToonScalar(c.ruleId || c.category),
      escapeToonScalar(c.title),
      String(c.additions || 0),
      String(c.deletions || 0),
      escapeToonScalar((c.files || []).join('|')),
      escapeToonScalar(c.summary || '')
    ].join(',');
    lines.push(`  ${row}`);
  }

  return `${lines.join('\n')}\n`;
}

export function serializeAuditToMarkdown(record: LocalSavedAuditRecord): string {
  const commits = record.snapshotSession?.commits?.length
    ? record.snapshotSession.commits
    : buildSynthesizedCommitsFromTitles(record.commitTitles, record.repoFullName);

  const lines: string[] = [
    '---',
    'format: fresnel-audit-markdown/v1',
    `auditId: ${record.auditId}`,
    `repoFullName: ${record.repoFullName}`,
    `repoUrl: ${record.repoUrl}`,
    `branch: ${record.branch || 'main'}`,
    `runPhase: ${record.runPhase}`,
    `mode: ${record.mode}`,
    `totalCommitsCount: ${record.totalCommitsCount}`,
    `selectedCommitsCount: ${record.selectedCommitsCount}`,
    `performanceBefore: ${record.performanceBefore}`,
    `performanceAfter: ${record.performanceAfter}`,
    `accessibilityBefore: ${record.accessibilityBefore}`,
    `accessibilityAfter: ${record.accessibilityAfter}`,
    `bestPracticesBefore: ${record.bestPracticesBefore}`,
    `bestPracticesAfter: ${record.bestPracticesAfter}`,
    `seoBefore: ${record.seoBefore}`,
    `seoAfter: ${record.seoAfter}`,
    `securityBefore: ${record.securityBefore}`,
    `securityAfter: ${record.securityAfter}`,
    `updatedAtIso: ${record.updatedAtIso}`,
    '---',
    '',
    `# Saved Repository Audit — ${record.repoFullName}`,
    '',
    `> ${record.summaryNotes || 'Local Fresnel audit snapshot.'}`,
    '',
    '## Lighthouse Score Summary',
    '',
    '| Category | Before | After | Delta |',
    '| :--- | :---: | :---: | :---: |',
    `| Performance | ${record.performanceBefore} | ${record.performanceAfter} | +${Math.max(0, record.performanceAfter - record.performanceBefore)} |`,
    `| Accessibility | ${record.accessibilityBefore} | ${record.accessibilityAfter} | +${Math.max(0, record.accessibilityAfter - record.accessibilityBefore)} |`,
    `| Best Practices | ${record.bestPracticesBefore} | ${record.bestPracticesAfter} | +${Math.max(0, record.bestPracticesAfter - record.bestPracticesBefore)} |`,
    `| SEO | ${record.seoBefore} | ${record.seoAfter} | +${Math.max(0, record.seoAfter - record.seoBefore)} |`,
    `| Security | ${record.securityBefore} | ${record.securityAfter} | +${Math.max(0, record.securityAfter - record.securityBefore)} |`,
    '',
    '## Atomic Audit Commits',
    ''
  ];

  for (const c of commits) {
    const checked =
      record.commitTitles.length === 0 || record.commitTitles.includes(c.title) ? 'x' : ' ';
    lines.push(
      `- [${checked}] **${c.title}** (\`${c.sha}\` · ${c.category} · \`+${c.additions}/-${c.deletions}\`)`
    );
    if (c.files?.length) {
      lines.push(`  - Files: ${c.files.map((f) => `\`${f}\``).join(', ')}`);
    }
    if (c.summary) {
      lines.push(`  - Summary: ${c.summary}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function detectAuditFormat(filename: string, rawContent: string): LocalAuditFormat {
  const lowerName = (filename || '').toLowerCase();
  if (lowerName.endsWith('.toon')) return 'toon';
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'markdown';
  if (lowerName.endsWith('.json')) return 'json';

  const trimmed = rawContent.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (/^format:\s*fresnel-audit-toon/im.test(trimmed) || /^commits\[\d+\]\{/m.test(trimmed)) {
    return 'toon';
  }
  return 'markdown';
}

function normalizeParsedRecord(
  partial: Partial<LocalSavedAuditRecord> & { repoFullName?: string },
  format: LocalAuditFormat,
  commitsFromFile?: AuditCommit[]
): LocalSavedAuditRecord {
  const repoFullName = String(partial.repoFullName || 'owner/repository').trim().slice(0, 200) || 'owner/repository';
  const repoUrl = sanitizeHttpUrl(partial.repoUrl, repoFullName);
  const runPhase: AuditRunPhase = partial.runPhase === 'lhr' ? 'lhr' : 'static';
  const mode: AuditMode = partial.mode === 'demo' ? 'demo' : 'live';
  const commitTitles = Array.isArray(partial.commitTitles)
    ? partial.commitTitles.map((t) => String(t).trim()).filter(Boolean).slice(0, 50)
    : [];

  const perfBefore = clampScore(partial.performanceBefore, 64);
  const perfAfter = clampScore(partial.performanceAfter, 92);
  const a11yBefore = clampScore(partial.accessibilityBefore, 70);
  const a11yAfter = clampScore(partial.accessibilityAfter, 95);

  const totalCommitsCount = clampCount(
    partial.totalCommitsCount,
    commitsFromFile?.length || commitTitles.length || 1
  );
  const selectedCommitsCount = Math.min(
    totalCommitsCount,
    clampCount(partial.selectedCommitsCount, commitTitles.length || totalCommitsCount)
  );

  const baseRecord: LocalSavedAuditRecord = {
    auditId: sanitizeAuditId(partial.auditId || `imp_${Date.now().toString(36)}_${runPhase}`),
    ownerId: 'local',
    repoFullName,
    repoUrl,
    branch: String(partial.branch || 'main').trim().slice(0, 100) || 'main',
    runPhase,
    mode,
    totalCommitsCount,
    selectedCommitsCount,
    performanceBefore: perfBefore,
    performanceAfter: perfAfter,
    accessibilityBefore: a11yBefore,
    accessibilityAfter: a11yAfter,
    bestPracticesBefore: clampScore(partial.bestPracticesBefore, 76),
    bestPracticesAfter: clampScore(partial.bestPracticesAfter, 94),
    seoBefore: clampScore(partial.seoBefore, 80),
    seoAfter: clampScore(partial.seoAfter, 96),
    securityBefore: clampScore(partial.securityBefore, 72),
    securityAfter: clampScore(partial.securityAfter, 92),
    summaryNotes:
      String(partial.summaryNotes || '').trim().slice(0, 1000) ||
      `${repoFullName} imported from local ${format.toUpperCase()} snapshot.`,
    commitTitles,
    createdAtIso: normalizeIsoDate(partial.createdAtIso),
    updatedAtIso: normalizeIsoDate(partial.updatedAtIso),
    storageSource: 'imported',
    savedFormat: format,
    snapshotSession: partial.snapshotSession ?? null
  };

  if (!baseRecord.snapshotSession) {
    baseRecord.snapshotSession = buildSynthesizedSessionFromRecord(baseRecord, commitsFromFile);
  }

  return baseRecord;
}

function parseJsonAuditRecords(rawContent: string): LocalSavedAuditRecord[] {
  const parsed = JSON.parse(rawContent) as unknown;

  // Support consolidated history bundle (`fresnel-audit-history-bundle/v1`) or raw array of audit records
  const rawList: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        'records' in parsed &&
        Array.isArray((parsed as Record<string, unknown>)['records'])
      ? ((parsed as Record<string, unknown>)['records'] as unknown[])
      : null;

  if (rawList) {
    const valid: LocalSavedAuditRecord[] = [];
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Partial<LocalSavedAuditRecord>;
      const repoFullName =
        candidate.repoFullName || candidate.snapshotSession?.repo?.fullName || '';
      if (!repoFullName) continue;
      valid.push(normalizeParsedRecord({ ...candidate, repoFullName }, 'json'));
    }
    if (valid.length === 0) {
      throw new Error('Consolidated JSON bundle does not contain any valid Fresnel audit records.');
    }
    return valid;
  }

  const obj = parsed as Record<string, unknown>;
  const candidate =
    obj && typeof obj === 'object' && 'record' in obj && obj['record'] && typeof obj['record'] === 'object'
      ? (obj['record'] as Partial<LocalSavedAuditRecord>)
      : (obj as Partial<LocalSavedAuditRecord>);

  if (!candidate || (!candidate.repoFullName && !candidate.snapshotSession?.repo?.fullName)) {
    throw new Error('JSON file does not contain a valid Fresnel audit record.');
  }

  const repoFullName =
    candidate.repoFullName || candidate.snapshotSession?.repo?.fullName || 'owner/repository';
  return [normalizeParsedRecord({ ...candidate, repoFullName }, 'json')];
}

function parseJsonAudit(rawContent: string): LocalSavedAuditRecord {
  return parseJsonAuditRecords(rawContent)[0];
}

function parseToonAudit(rawContent: string): LocalSavedAuditRecord {
  const lines = rawContent.split(/\r?\n/);
  const fields: Record<string, string> = {};
  const titles: string[] = [];
  const commits: AuditCommit[] = [];

  let section: 'root' | 'scores' | 'titles' | 'commits' = 'root';

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const trimmed = rawLine.trim();

    if (indent === 0) {
      if (trimmed === 'scores:') {
        section = 'scores';
        continue;
      }
      if (/^commitTitles\[\d*\]:$/.test(trimmed)) {
        section = 'titles';
        continue;
      }
      if (/^commits\[\d*\]\{[^}]*\}:$/.test(trimmed)) {
        section = 'commits';
        continue;
      }
      section = 'root';
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = unquoteToonScalar(trimmed.slice(colonIdx + 1));
        fields[key] = val;
      }
      continue;
    }

    if (section === 'scores') {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = unquoteToonScalar(trimmed.slice(colonIdx + 1));
        fields[key] = val;
      }
    } else if (section === 'titles') {
      const cleanedTitle = unquoteToonScalar(trimmed.replace(/^-\s*/, ''));
      if (cleanedTitle) titles.push(cleanedTitle);
    } else if (section === 'commits') {
      const cols = splitCsvRow(trimmed);
      if (cols.length >= 5) {
        const category = normalizeCategory(cols[2]);
        const sha = (cols[1] || `toon${commits.length + 1}`).slice(0, 12);
        const files = (cols[7] || 'src/app/app.component.html')
          .split('|')
          .map((f) => f.trim())
          .filter(Boolean);
        const title = cols[4] || 'Atomic commit';
        commits.push({
          id: cols[0] || `toon-commit-${commits.length + 1}`,
          sha,
          fullSha: `${sha}${'0'.repeat(40)}`.slice(0, 40),
          category,
          categoryLabel: categoryLabelFor(category),
          ruleId: cols[3] || category,
          title,
          commitMessage: title,
          summary: cols[8] || `Restored from TOON audit snapshot.`,
          files,
          additions: clampCount(cols[5], 2),
          deletions: clampCount(cols[6], 1),
          author: 'Fresnel Local TOON <fresnel@local>',
          date: new Date().toUTCString(),
          body: cols[8] || title,
          diff: [
            `diff --git a/${files[0] || 'src/index.html'} b/${files[0] || 'src/index.html'}`,
            `--- a/${files[0] || 'src/index.html'}`,
            `+++ b/${files[0] || 'src/index.html'}`,
            '@@ -1,1 +1,2 @@',
            ' <!-- Restored from TOON snapshot -->',
            `+<!-- ${title.replace(/-->/g, '--')} -->`
          ].join('\n')
        });
      }
    }
  }

  if (!fields['repoFullName']) {
    throw new Error('TOON file is missing required repoFullName metadata.');
  }

  return normalizeParsedRecord(
    {
      auditId: fields['auditId'],
      repoFullName: fields['repoFullName'],
      repoUrl: fields['repoUrl'],
      branch: fields['branch'],
      runPhase: fields['runPhase'] === 'lhr' ? 'lhr' : 'static',
      mode: fields['mode'] === 'demo' ? 'demo' : 'live',
      totalCommitsCount: Number(fields['totalCommitsCount']),
      selectedCommitsCount: Number(fields['selectedCommitsCount']),
      createdAtIso: fields['createdAtIso'],
      updatedAtIso: fields['updatedAtIso'],
      summaryNotes: fields['summaryNotes'],
      performanceBefore: Number(fields['performanceBefore']),
      performanceAfter: Number(fields['performanceAfter']),
      accessibilityBefore: Number(fields['accessibilityBefore']),
      accessibilityAfter: Number(fields['accessibilityAfter']),
      bestPracticesBefore: Number(fields['bestPracticesBefore']),
      bestPracticesAfter: Number(fields['bestPracticesAfter']),
      seoBefore: Number(fields['seoBefore']),
      seoAfter: Number(fields['seoAfter']),
      securityBefore: Number(fields['securityBefore']),
      securityAfter: Number(fields['securityAfter']),
      commitTitles: titles.length > 0 ? titles : commits.map((c) => c.title)
    },
    'toon',
    commits.length > 0 ? commits : undefined
  );
}

function parseMarkdownAudit(rawContent: string): LocalSavedAuditRecord {
  const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const meta: Record<string, string> = {};
  if (fmMatch) {
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        meta[line.slice(0, idx).trim()] = unquoteToonScalar(line.slice(idx + 1));
      }
    }
  }

  // Fallback heading extraction if Markdown was generated outside frontmatter
  if (!meta['repoFullName']) {
    const headingMatch = rawContent.match(/^#\s+.*?[—-]\s+([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)/m);
    if (headingMatch) {
      meta['repoFullName'] = headingMatch[1];
    }
  }

  if (!meta['repoFullName']) {
    throw new Error('Markdown file does not contain Fresnel audit frontmatter or repository header.');
  }

  const repoFullName = meta['repoFullName'];
  const quoteMatch = rawContent.match(/^>\s+(.+)$/m);
  const commitTitles: string[] = [];
  const parsedCommits: AuditCommit[] = [];

  const lines = rawContent.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const itemMatch = line.match(
      /^-\s+\[[ xX]\]\s+\*\*(.+?)\*\*(?:\s*\(([^)]*)\))?/
    );
    if (!itemMatch) continue;

    const title = itemMatch[1].trim();
    if (!title) continue;
    commitTitles.push(title);

    const metaParens = itemMatch[2] || '';
    const shaMatch = metaParens.match(/`([^`]+)`/);
    const sha = (shaMatch?.[1] || `md${String(parsedCommits.length + 1).padStart(2, '0')}a7`).slice(0, 12);
    const addDelMatch = metaParens.match(/\+(\d+)\/-(\d+)/);
    const additions = addDelMatch ? clampCount(addDelMatch[1], 4) : 4;
    const deletions = addDelMatch ? clampCount(addDelMatch[2], 1) : 1;

    const parenSegments = metaParens
      .split('·')
      .map((s) => s.replace(/`/g, '').trim())
      .filter(Boolean);
    const explicitCategorySegment = parenSegments.find((seg) =>
      /^(performance|perf|accessibility|a11y|best[- ]practices|seo|security)$/i.test(seg)
    );
    const category = explicitCategorySegment
      ? normalizeCategory(explicitCategorySegment)
      : buildSynthesizedCommitsFromTitles([title], repoFullName)[0].category;

    let files: string[] = ['src/app/app.component.html'];
    let summary = `Restored from locally saved Markdown snapshot for ${repoFullName}.`;

    for (let j = i + 1; j < lines.length; j++) {
      const sub = lines[j];
      if (!/^\s{2,}-\s+/.test(sub)) break;
      const filesMatch = sub.match(/^\s+-\s+Files:\s+(.+)$/i);
      if (filesMatch) {
        const extractedFiles = filesMatch[1]
          .split(',')
          .map((f) => f.replace(/`/g, '').trim())
          .filter(Boolean);
        if (extractedFiles.length > 0) {
          files = extractedFiles;
        }
      }
      const summaryMatch = sub.match(/^\s+-\s+Summary:\s+(.+)$/i);
      if (summaryMatch && summaryMatch[1].trim()) {
        summary = summaryMatch[1].trim();
      }
      i = j;
    }

    parsedCommits.push({
      id: `md-commit-${parsedCommits.length + 1}`,
      sha,
      fullSha: `${sha}${'0'.repeat(40)}`.slice(0, 40),
      category,
      categoryLabel: categoryLabelFor(category),
      ruleId: `${category}-local-markdown`,
      title,
      commitMessage: title,
      summary,
      files,
      additions,
      deletions,
      author: 'Fresnel Local Markdown <fresnel@local>',
      date: new Date().toUTCString(),
      body: summary,
      diff: [
        `diff --git a/${files[0]} b/${files[0]}`,
        `--- a/${files[0]}`,
        `+++ b/${files[0]}`,
        '@@ -1,1 +1,2 @@',
        ' <!-- Restored from Markdown snapshot -->',
        `+<!-- ${title.replace(/-->/g, '--')} -->`
      ].join('\n')
    });
  }

  // Also parse score table rows if frontmatter omitted scores
  const perfRow = rawContent.match(/^\|\s*Performance\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/im);
  const a11yRow = rawContent.match(/^\|\s*Accessibility\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/im);
  const bpRow = rawContent.match(/^\|\s*Best Practices\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/im);
  const seoRow = rawContent.match(/^\|\s*SEO\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/im);
  const secRow = rawContent.match(/^\|\s*Security\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/im);

  return normalizeParsedRecord(
    {
      auditId: meta['auditId'],
      repoFullName,
      repoUrl: meta['repoUrl'],
      branch: meta['branch'],
      runPhase: meta['runPhase'] === 'lhr' ? 'lhr' : 'static',
      mode: meta['mode'] === 'demo' ? 'demo' : 'live',
      totalCommitsCount: Number(meta['totalCommitsCount']) || commitTitles.length || 1,
      selectedCommitsCount: Number(meta['selectedCommitsCount']) || commitTitles.length || 1,
      performanceBefore: Number(meta['performanceBefore'] ?? perfRow?.[1]),
      performanceAfter: Number(meta['performanceAfter'] ?? perfRow?.[2]),
      accessibilityBefore: Number(meta['accessibilityBefore'] ?? a11yRow?.[1]),
      accessibilityAfter: Number(meta['accessibilityAfter'] ?? a11yRow?.[2]),
      bestPracticesBefore: Number(meta['bestPracticesBefore'] ?? bpRow?.[1]),
      bestPracticesAfter: Number(meta['bestPracticesAfter'] ?? bpRow?.[2]),
      seoBefore: Number(meta['seoBefore'] ?? seoRow?.[1]),
      seoAfter: Number(meta['seoAfter'] ?? seoRow?.[2]),
      securityBefore: Number(meta['securityBefore'] ?? secRow?.[1]),
      securityAfter: Number(meta['securityAfter'] ?? secRow?.[2]),
      updatedAtIso: meta['updatedAtIso'],
      summaryNotes: quoteMatch?.[1]?.trim(),
      commitTitles
    },
    'markdown',
    parsedCommits.length > 0 ? parsedCommits : undefined
  );
}

export function parseLocalAuditRecords(
  filename: string,
  rawContent: string
): LocalSavedAuditRecord[] {
  if (!rawContent || !rawContent.trim()) {
    throw new Error('Selected audit file is empty.');
  }
  const format = detectAuditFormat(filename, rawContent);
  if (format === 'json') return parseJsonAuditRecords(rawContent);
  if (format === 'toon') return [parseToonAudit(rawContent)];
  return [parseMarkdownAudit(rawContent)];
}

export function parseLocalAuditFile(
  filename: string,
  rawContent: string
): LocalSavedAuditRecord {
  return parseLocalAuditRecords(filename, rawContent)[0];
}

@Injectable({
  providedIn: 'root'
})
export class LocalAuditStorageService {
  readonly localAudits = signal<LocalSavedAuditRecord[]>([]);
  readonly preferredFormat = signal<LocalAuditFormat>('json');
  readonly localNotice = signal<string | null>(null);
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.localAudits.set(this.readFromStorage());
  }

  private readFromStorage(): LocalSavedAuditRecord[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(LOCAL_SAVED_AUDITS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item === 'object' && typeof item.repoFullName === 'string')
        .map((item) => ({
          ...(item as LocalSavedAuditRecord),
          storageSource:
            item.storageSource === 'imported' ? ('imported' as const) : ('local' as const),
          savedFormat:
            item.savedFormat === 'toon' || item.savedFormat === 'markdown'
              ? item.savedFormat
              : ('json' as const)
        }))
        .slice(0, MAX_LOCAL_AUDITS);
    } catch {
      return [];
    }
  }

  private writeToStorage(records: LocalSavedAuditRecord[]): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const trimmed = records.slice(0, MAX_LOCAL_AUDITS);
      try {
        localStorage.setItem(LOCAL_SAVED_AUDITS_STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        // Fallback: drop verbose diffs on older snapshots if storage quota is tight
        const compact = trimmed.map((rec, idx) =>
          idx === 0
            ? rec
            : {
                ...rec,
                snapshotSession: null
              }
        );
        localStorage.setItem(LOCAL_SAVED_AUDITS_STORAGE_KEY, JSON.stringify(compact));
      }
    } catch {
      // Non-fatal if storage is disabled
    }
  }

  private showNotice(message: string): void {
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
    this.localNotice.set(message);
    this.noticeTimer = setTimeout(() => {
      this.localNotice.set(null);
      this.noticeTimer = null;
    }, 3200);
  }

  saveSessionLocally(
    session: AuditSession,
    impact: AuditImpactMetrics,
    selectedCommits: AuditCommit[],
    format?: LocalAuditFormat
  ): LocalSavedAuditRecord {
    const activeFormat = format ?? this.preferredFormat();
    const record = buildLocalSavedAuditRecord(session, impact, selectedCommits, activeFormat);
    this.upsertRecord(record);
    this.showNotice(
      `Saved ${record.repoFullName} locally (${activeFormat.toUpperCase()} snapshot).`
    );
    return record;
  }

  upsertRecord(record: LocalSavedAuditRecord): void {
    const current = this.localAudits();
    const filtered = current.filter((r) => r.auditId !== record.auditId);
    const next = [record, ...filtered].slice(0, MAX_LOCAL_AUDITS);
    this.localAudits.set(next);
    this.writeToStorage(next);
  }

  replaceAllLocalAudits(records: LocalSavedAuditRecord[]): void {
    const next = records.slice(0, MAX_LOCAL_AUDITS);
    this.localAudits.set(next);
    this.writeToStorage(next);
  }

  importAuditFileRecords(filename: string, rawContent: string): LocalSavedAuditRecord[] {
    const parsedRecords = parseLocalAuditRecords(filename, rawContent);
    for (const rec of [...parsedRecords].reverse()) {
      this.upsertRecord(rec);
    }
    if (parsedRecords.length > 1) {
      this.showNotice(
        `Imported ${parsedRecords.length} audits from consolidated JSON backup (${filename}).`
      );
    } else if (parsedRecords.length === 1) {
      this.showNotice(
        `Imported ${parsedRecords[0].repoFullName} from ${parsedRecords[0].savedFormat.toUpperCase()} file.`
      );
    }
    return parsedRecords;
  }

  importAuditFile(filename: string, rawContent: string): LocalSavedAuditRecord {
    return this.importAuditFileRecords(filename, rawContent)[0];
  }

  deleteLocalAudit(auditId: string): void {
    const next = this.localAudits().filter((r) => r.auditId !== auditId);
    this.localAudits.set(next);
    this.writeToStorage(next);
  }

  exportConsolidatedHistoryPayload(
    records?: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
  ): { filename: string; content: string; mimeType: string; totalCount: number } {
    const source = records ?? this.localAudits();
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      filename: `fresnel-saved-audits-history-${stamp}.json`,
      content: serializeConsolidatedAuditHistoryJson(source),
      mimeType: 'application/json;charset=utf-8',
      totalCount: source.length
    };
  }

  async exportFullHistoryToDeviceJson(
    records?: readonly (SavedAuditHistoryRecord | LocalSavedAuditRecord)[]
  ): Promise<{ success: boolean; filename: string; totalCount: number }> {
    const payload = this.exportConsolidatedHistoryPayload(records);
    if (typeof window === 'undefined') {
      return { success: false, filename: payload.filename, totalCount: payload.totalCount };
    }

    try {
      if (this.isFileSystemAccessSupported()) {
        const fileHandle = await (window as unknown as {
          showSaveFilePicker: (opts: unknown) => Promise<{
            createWritable: () => Promise<{
              write: (data: string) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }>;
        }).showSaveFilePicker({
          suggestedName: payload.filename,
          types: [
            {
              description: 'Fresnel Consolidated Audit History (.json)',
              accept: { 'application/json': ['.json'] }
            }
          ]
        });

        const writable = await fileHandle.createWritable();
        await writable.write(payload.content);
        await writable.close();
        this.showNotice(
          `Exported ${payload.totalCount} saved ${payload.totalCount === 1 ? 'audit' : 'audits'} to ${payload.filename}.`
        );
        return { success: true, filename: payload.filename, totalCount: payload.totalCount };
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, filename: payload.filename, totalCount: payload.totalCount };
      }
    }

    this.downloadPayloadAsFile(payload.filename, payload.content, payload.mimeType);
    this.showNotice(
      `Exported consolidated JSON backup (${payload.totalCount} ${payload.totalCount === 1 ? 'audit' : 'audits'}): ${payload.filename}`
    );
    return { success: true, filename: payload.filename, totalCount: payload.totalCount };
  }

  exportRecordPayload(
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord,
    format: LocalAuditFormat
  ): { filename: string; content: string; mimeType: string } {
    const localRec: LocalSavedAuditRecord =
      'storageSource' in record
        ? record
        : {
            ...record,
            storageSource: 'firestore',
            savedFormat: format,
            snapshotSession: buildSynthesizedSessionFromRecord(record)
          };

    const baseRepo = sanitizeSlug(localRec.repoFullName.split('/').pop() || 'repository');
    const phaseSuffix = localRec.runPhase === 'lhr' ? 'lhr-audit' : 'code-audit';

    if (format === 'toon') {
      return {
        filename: `fresnel-${baseRepo}-${phaseSuffix}.toon`,
        content: serializeAuditToToon(localRec),
        mimeType: 'text/plain;charset=utf-8'
      };
    }

    if (format === 'markdown') {
      return {
        filename: `fresnel-${baseRepo}-${phaseSuffix}.md`,
        content: serializeAuditToMarkdown(localRec),
        mimeType: 'text/markdown;charset=utf-8'
      };
    }

    return {
      filename: `fresnel-${baseRepo}-${phaseSuffix}.json`,
      content: serializeAuditToJson(localRec),
      mimeType: 'application/json;charset=utf-8'
    };
  }

  seedSampleAuditsIfEmpty(force = false): LocalSavedAuditRecord[] {
    const current = this.localAudits();
    const samples = buildDefaultSampleAudits();

    if (current.length > 0 && !force) {
      const hasLegacyLuminaSample = current.some(
        (r) => r.auditId === 'local_sample_lumina_store_json'
      );
      if (hasLegacyLuminaSample) {
        const existingIds = new Set(current.map((r) => r.auditId));
        const missingHistory = samples.filter((s) => !existingIds.has(s.auditId));
        if (missingHistory.length > 0) {
          const merged = [...current, ...missingHistory].slice(0, MAX_LOCAL_AUDITS);
          this.localAudits.set(merged);
          this.writeToStorage(merged);
          return merged;
        }
      }
      return current;
    }

    this.localAudits.set(samples);
    this.writeToStorage(samples);
    this.showNotice('Loaded sample saved audits across JSON, TOON, and Markdown formats.');
    return samples;
  }

  loadSampleAudits(): LocalSavedAuditRecord[] {
    return this.seedSampleAuditsIfEmpty(true);
  }

  isFileSystemAccessSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'showOpenFilePicker' in window &&
      'showSaveFilePicker' in window
    );
  }

  async saveAuditToDeviceFile(
    record: SavedAuditHistoryRecord | LocalSavedAuditRecord,
    format: LocalAuditFormat = 'json'
  ): Promise<{ success: boolean; filename: string }> {
    const payload = this.exportRecordPayload(record, format);
    if (typeof window === 'undefined') {
      return { success: false, filename: payload.filename };
    }

    try {
      if (this.isFileSystemAccessSupported()) {
        const ext = format === 'toon' ? '.toon' : format === 'markdown' ? '.md' : '.json';
        const fileHandle = await (window as unknown as {
          showSaveFilePicker: (opts: unknown) => Promise<{
            createWritable: () => Promise<{
              write: (data: string) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }>;
        }).showSaveFilePicker({
          suggestedName: payload.filename,
          types: [
            {
              description: `Fresnel Audit (${format.toUpperCase()})`,
              accept: { [payload.mimeType.split(';')[0]]: [ext] }
            }
          ]
        });

        const writable = await fileHandle.createWritable();
        await writable.write(payload.content);
        await writable.close();
        this.showNotice(`Saved audit directly to device file: ${payload.filename}`);
        return { success: true, filename: payload.filename };
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, filename: payload.filename };
      }
    }

    // Fallback to instant browser download
    this.downloadPayloadAsFile(payload.filename, payload.content, payload.mimeType);
    this.showNotice(`Exported audit to device file: ${payload.filename}`);
    return { success: true, filename: payload.filename };
  }

  async importAuditFromDeviceFile(): Promise<LocalSavedAuditRecord | null> {
    if (typeof window === 'undefined') return null;

    try {
      if (this.isFileSystemAccessSupported()) {
        const [fileHandle] = await (window as unknown as {
          showOpenFilePicker: (opts: unknown) => Promise<Array<{
            getFile: () => Promise<File>;
          }>>;
        }).showOpenFilePicker({
          types: [
            {
              description: 'Fresnel Audits (.json, .toon, .md)',
              accept: {
                'application/json': ['.json'],
                'text/plain': ['.toon'],
                'text/markdown': ['.md', '.markdown']
              }
            }
          ],
          multiple: false
        });

        if (fileHandle) {
          const file = await fileHandle.getFile();
          const content = await file.text();
          return this.importAuditFile(file.name, content);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return null;
      }
    }

    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.toon,.md,.markdown,text/plain,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.onchange = async () => {
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) {
          resolve(null);
          return;
        }
        try {
          const content = await file.text();
          const record = this.importAuditFile(file.name, content);
          resolve(record);
        } catch (e) {
          reject(e);
        }
      };

      input.oncancel = () => {
        document.body.removeChild(input);
        resolve(null);
      };

      input.click();
    });
  }

  downloadPayloadAsFile(filename: string, content: string, mimeType: string): void {
    if (typeof window === 'undefined') return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  }
}

export function buildDefaultSampleAudits(): LocalSavedAuditRecord[] {
  const now = Date.now();
  const date1 = new Date(now - 1000 * 60 * 25).toISOString();
  const date2 = new Date(now - 1000 * 60 * 60 * 4).toISOString();
  const date3 = new Date(now - 1000 * 60 * 60 * 26).toISOString();

  const luminaCommits: AuditCommit[] = [
    {
      id: 'lumina-perf-1',
      sha: 'a1b2c3d',
      fullSha: 'a1b2c3d000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'largest-contentful-paint',
      title: 'Preload LCP hero banner image with fetchpriority="high"',
      commitMessage: 'perf: preload hero image with high fetchpriority',
      summary: 'Reduces LCP by 480ms by preloading hero visual asset.',
      files: ['src/index.html'],
      additions: 2,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Preloads hero image with fetchpriority high.',
      diff: 'diff --git a/src/index.html b/src/index.html\n@@ -1,1 +1,2 @@\n-<img src="/hero.jpg">\n+<link rel="preload" as="image" href="/hero.jpg" fetchpriority="high">\n+<img src="/hero.jpg" fetchpriority="high">'
    },
    {
      id: 'lumina-perf-2',
      sha: 'e4f5a6b',
      fullSha: 'e4f5a6b000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'font-display',
      title: 'Add font-display: swap to Google Fonts stylesheet',
      commitMessage: 'perf: avoid flash of invisible text with font-display swap',
      summary: 'Prevents layout shifts during webfont hydration.',
      files: ['src/styles.css'],
      additions: 1,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Configures font-display: swap.',
      diff: 'diff --git a/src/styles.css b/src/styles.css\n@@ -1 +1 @@\n-@import url("fonts.css");\n+@import url("fonts.css&display=swap");'
    },
    {
      id: 'lumina-perf-3',
      sha: 'c7d8e9f',
      fullSha: 'c7d8e9f000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'defer-scripts',
      title: 'Defer non-critical analytics and tracking bundles',
      commitMessage: 'perf: defer third-party scripts',
      summary: 'Removes 310ms of main-thread blocking time during bootstrap.',
      files: ['src/index.html'],
      additions: 1,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Defers analytics scripts.',
      diff: 'diff --git a/src/index.html b/src/index.html\n-<script src="/analytics.js"></script>\n+<script defer src="/analytics.js"></script>'
    },
    {
      id: 'lumina-perf-4',
      sha: 'b1c2d3e',
      fullSha: 'b1c2d3e000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'responsive-images',
      title: 'Inject picture element with AVIF/WebP srcset fallbacks',
      commitMessage: 'perf: modern image formats srcset',
      summary: 'Saves 620KB of over-the-wire image payload.',
      files: ['src/app/hero.component.html'],
      additions: 5,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Uses modern AVIF/WebP picture srcset.',
      diff: 'diff --git a/src/app/hero.html\n+<picture><source type="image/avif" srcset="/hero.avif">'
    },
    {
      id: 'lumina-perf-5',
      sha: 'f2a3b4c',
      fullSha: 'f2a3b4c000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'brotli-compression',
      title: 'Configure Brotli content compression headers',
      commitMessage: 'perf: enable brotli compression',
      summary: 'Decreases transfer size of JS chunks by 23%.',
      files: ['server.ts'],
      additions: 3,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Enables Brotli response compression.',
      diff: 'diff --git a/server.ts\n+import compression from "compression";\n+app.use(compression());'
    },
    {
      id: 'lumina-perf-6',
      sha: 'd5e6f7a',
      fullSha: 'd5e6f7a000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'critical-css',
      title: 'Inline critical viewport CSS and defer secondary styles',
      commitMessage: 'perf: eliminate render-blocking CSS',
      summary: 'Fast-paths First Contentful Paint by 420ms.',
      files: ['src/index.html'],
      additions: 4,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Inlines critical styles.',
      diff: 'diff --git a/src/index.html\n+<style>/* critical fold styles */</style>'
    },
    {
      id: 'lumina-a11y-1',
      sha: 'a7b8c9d',
      fullSha: 'a7b8c9d000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'button-name',
      title: 'Add aria-label to icon-only navigation buttons',
      commitMessage: 'a11y: add aria-label to search and menu buttons',
      summary: 'Resolves WCAG 4.1.2 Name, Role, Value failure.',
      files: ['src/app/nav.component.html'],
      additions: 2,
      deletions: 2,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Adds accessible names to icon-only buttons.',
      diff: 'diff --git a/nav.html\n-<button class="icon-btn"></button>\n+<button class="icon-btn" aria-label="Open menu"></button>'
    },
    {
      id: 'lumina-a11y-2',
      sha: 'c1d2e3f',
      fullSha: 'c1d2e3f000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'color-contrast',
      title: 'Adjust slate-muted text contrast ratio to 5.2:1',
      commitMessage: 'a11y: increase low-contrast caption ratio',
      summary: 'Satisfies WCAG 1.4.3 AA minimum contrast requirements.',
      files: ['src/styles.scss'],
      additions: 1,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Improves foreground/background color contrast ratio.',
      diff: 'diff --git a/src/styles.scss\n- color: #94a3b8;\n+ color: #475569;'
    },
    {
      id: 'lumina-a11y-3',
      sha: 'e5f6a7b',
      fullSha: 'e5f6a7b000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'skip-link',
      title: 'Inject accessible skip-to-content navigation anchor',
      commitMessage: 'a11y: inject skip link at start of body',
      summary: 'Empowers keyboard and switch-access users to bypass repetitive headers.',
      files: ['src/index.html'],
      additions: 3,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Provides keyboard accessible skip link.',
      diff: 'diff --git a/index.html\n+<a class="skip-link" href="#main-content">Skip to content</a>'
    },
    {
      id: 'lumina-a11y-4',
      sha: 'b8c9d0e',
      fullSha: 'b8c9d0e000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'image-alt',
      title: 'Provide meaningful alt descriptions on product card images',
      commitMessage: 'a11y: add descriptive alt text',
      summary: 'Fixes screen-reader silent image tags across catalog grid.',
      files: ['src/app/product-card.html'],
      additions: 2,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Adds alt attributes to product imagery.',
      diff: 'diff --git a/product-card.html\n-<img [src]="item.image">\n+<img [src]="item.image" [alt]="item.name + \' product photo\'">'
    },
    {
      id: 'lumina-a11y-5',
      sha: 'd2e3f4a',
      fullSha: 'd2e3f4a000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'form-label',
      title: 'Associate search input field with explicit label element',
      commitMessage: 'a11y: link search input with label',
      summary: 'Provides programmatic accessible name for assistive technology.',
      files: ['src/app/search-bar.html'],
      additions: 2,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Associates form inputs with labels.',
      diff: 'diff --git a/search.html\n+<label for="global-search" class="sr-only">Search</label>\n-<input type="search">'
    },
    {
      id: 'lumina-a11y-6',
      sha: 'f6a7b8c',
      fullSha: 'f6a7b8c000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'heading-order',
      title: 'Normalize heading hierarchy from h4 to h2/h3',
      commitMessage: 'a11y: sequential heading levels',
      summary: 'Fixes skipped heading levels across page sections.',
      files: ['src/app/feature-section.html'],
      additions: 2,
      deletions: 2,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Fixes heading levels structure.',
      diff: 'diff --git a/features.html\n-<h4>Featured Specs</h4>\n+<h2>Featured Specs</h2>'
    },
    {
      id: 'lumina-a11y-7',
      sha: 'a9b0c1d',
      fullSha: 'a9b0c1d000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'focus-trap',
      title: 'Trap keyboard focus inside active modal dialog',
      commitMessage: 'a11y: modal focus trap and escape handling',
      summary: 'Prevents tab focus from spilling into hidden background content.',
      files: ['src/app/modal.component.ts'],
      additions: 8,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Traps tab focus in modal dialogues.',
      diff: 'diff --git a/modal.ts\n+handleTabKey(e: KeyboardEvent) { /* trap focus */ }'
    },
    {
      id: 'lumina-bp-1',
      sha: 'b3c4d5e',
      fullSha: 'b3c4d5e000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'is-on-https',
      title: 'Enforce HTTPS redirect and Strict-Transport-Security header',
      commitMessage: 'best-practices: add HSTS header',
      summary: 'Configures HSTS max-age=31536000; includeSubDomains.',
      files: ['server.ts'],
      additions: 2,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Configures HSTS security headers.',
      diff: 'diff --git a/server.ts\n+res.setHeader("Strict-Transport-Security", "max-age=31536000");'
    },
    {
      id: 'lumina-bp-2',
      sha: 'd6e7f8a',
      fullSha: 'd6e7f8a000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'no-vulnerable-libraries',
      title: 'Add rel="noopener noreferrer" on external anchor links',
      commitMessage: 'best-practices: reverse tab-nabbing protection',
      summary: 'Prevents window.opener hijacking from untrusted target="_blank" targets.',
      files: ['src/app/footer.html'],
      additions: 1,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Protects against reverse tab-nabbing.',
      diff: 'diff --git a/footer.html\n-<a target="_blank">\n+<a target="_blank" rel="noopener noreferrer">'
    },
    {
      id: 'lumina-bp-3',
      sha: 'f9a0b1c',
      fullSha: 'f9a0b1c000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'doctype-html',
      title: 'Ensure valid HTML5 <!DOCTYPE html> preamble',
      commitMessage: 'best-practices: declare html5 doctype',
      summary: 'Prevents browser quirks mode rendering.',
      files: ['src/index.html'],
      additions: 1,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Ensures standard HTML5 doctype declaration.',
      diff: 'diff --git a/index.html\n+<!DOCTYPE html>'
    },
    {
      id: 'lumina-bp-4',
      sha: 'c2d3e4f',
      fullSha: 'c2d3e4f000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'clean-console',
      title: 'Purge debug console.log statements from production bundle',
      commitMessage: 'best-practices: strip development logging',
      summary: 'Cleans runtime console output for end users.',
      files: ['src/app/checkout.service.ts'],
      additions: 0,
      deletions: 3,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Removes debug logging.',
      diff: 'diff --git a/checkout.ts\n-console.log("payload", payload);'
    },
    {
      id: 'lumina-seo-1',
      sha: 'e6f7a8b',
      fullSha: 'e6f7a8b000000000000000000000000000000000',
      category: 'seo',
      categoryLabel: 'SEO',
      ruleId: 'canonical',
      title: 'Inject canonical link tag pointing to authoritative URL',
      commitMessage: 'seo: canonical link metadata',
      summary: 'Consolidates search engine indexing signals.',
      files: ['src/index.html'],
      additions: 1,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Adds canonical link element.',
      diff: 'diff --git a/index.html\n+<link rel="canonical" href="https://lumina-store.com/">'
    },
    {
      id: 'lumina-seo-2',
      sha: 'a0b1c2d',
      fullSha: 'a0b1c2d000000000000000000000000000000000',
      category: 'seo',
      categoryLabel: 'SEO',
      ruleId: 'structured-data',
      title: 'Embed JSON-LD Schema.org BreadcrumbList & Organization',
      commitMessage: 'seo: schema.org structured data',
      summary: 'Unlocks rich search results snippet previews in SERPs.',
      files: ['src/index.html'],
      additions: 6,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Injects Schema.org JSON-LD graph.',
      diff: 'diff --git a/index.html\n+<script type="application/ld+json">{"@context":"https://schema.org"}</script>'
    },
    {
      id: 'lumina-seo-3',
      sha: 'c4d5e6f',
      fullSha: 'c4d5e6f000000000000000000000000000000000',
      category: 'seo',
      categoryLabel: 'SEO',
      ruleId: 'meta-description',
      title: 'Configure unique meta description and OpenGraph social cards',
      commitMessage: 'seo: meta description and og tags',
      summary: 'Provides informative 155-character summary for social sharing.',
      files: ['src/index.html'],
      additions: 3,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Defines meta description and og graph cards.',
      diff: 'diff --git a/index.html\n+<meta name="description" content="Lumina store for web applications.">'
    },
    {
      id: 'lumina-seo-4',
      sha: 'f8a9b0c',
      fullSha: 'f8a9b0c000000000000000000000000000000000',
      category: 'seo',
      categoryLabel: 'SEO',
      ruleId: 'sitemap-robots',
      title: 'Generate dynamic sitemap.xml route and robots.txt index rules',
      commitMessage: 'seo: robots.txt and dynamic sitemap',
      summary: 'Guides search crawler discovery across catalog subpaths.',
      files: ['public/robots.txt'],
      additions: 3,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Generates sitemap and robots directives.',
      diff: 'diff --git a/robots.txt\n+User-agent: *\n+Sitemap: https://lumina-store.com/sitemap.xml'
    },
    {
      id: 'lumina-sec-1',
      sha: 'd1e2f3a',
      fullSha: 'd1e2f3a000000000000000000000000000000000',
      category: 'security',
      categoryLabel: 'Web application security findings',
      ruleId: 'xss-sanitization',
      title: 'Sanitize dynamic HTML bindings with DOMPurify against XSS',
      commitMessage: 'security: sanitize innerHTML bindings with DOMPurify',
      summary: 'Neutralizes stored and reflected Cross-Site Scripting attack vectors.',
      files: ['src/app/markdown-renderer.ts'],
      additions: 3,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Sanitizes dangerous dynamic innerHTML.',
      diff: 'diff --git a/renderer.ts\n-element.innerHTML = raw;\n+element.innerHTML = DOMPurify.sanitize(raw);'
    },
    {
      id: 'lumina-sec-2',
      sha: 'b5c6d7e',
      fullSha: 'b5c6d7e000000000000000000000000000000000',
      category: 'security',
      categoryLabel: 'Web application security findings',
      ruleId: 'samesite-cookies',
      title: 'Set SameSite=Strict and Secure flags on session auth cookies',
      commitMessage: 'security: enforce SameSite=Strict cookies',
      summary: 'Mitigates Cross-Site Request Forgery (CSRF) across authenticated endpoints.',
      files: ['server.ts'],
      additions: 2,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Hardens cookie configuration.',
      diff: 'diff --git a/server.ts\n-res.cookie("session", token);\n+res.cookie("session", token, { sameSite: "strict", secure: true });'
    },
    {
      id: 'lumina-sec-3',
      sha: 'f0a1b2c',
      fullSha: 'f0a1b2c000000000000000000000000000000000',
      category: 'security',
      categoryLabel: 'Web application security findings',
      ruleId: 'csp-headers',
      title: 'Define Content-Security-Policy forbidding unsafe-eval execution',
      commitMessage: 'security: restrict unsafe-eval scripts in CSP',
      summary: 'Hardens JavaScript execution context against unauthorized script injection.',
      files: ['server.ts'],
      additions: 2,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Injects strict CSP headers.',
      diff: 'diff --git a/server.ts\n+res.setHeader("Content-Security-Policy", "default-src \'self\'; script-src \'self\';");'
    }
  ];

  const phoenixCommits: AuditCommit[] = [
    {
      id: 'phx-perf-1',
      sha: 'c1e2a3b',
      fullSha: 'c1e2a3b000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'lazy-route',
      title: 'Implement code-splitting and route lazy loading for analytics module',
      commitMessage: 'perf: lazy-load analytics route chunk',
      summary: 'Reduces initial JavaScript bundle weight by 185KB.',
      files: ['src/app/routes.ts'],
      additions: 4,
      deletions: 2,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Splits analytics bundle into async route chunk.',
      diff: 'diff --git a/routes.ts\n+loadChildren: () => import("./analytics/routes")'
    },
    {
      id: 'phx-perf-2',
      sha: 'd4f5b6c',
      fullSha: 'd4f5b6c000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'passive-listeners',
      title: 'Use passive scroll and touch event listeners',
      commitMessage: 'perf: mark scroll listeners as passive',
      summary: 'Eliminates scroll jank on complex dashboard data tables.',
      files: ['src/app/table.ts'],
      additions: 2,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Adds { passive: true } to window scroll listeners.',
      diff: 'diff --git a/table.ts\n-window.addEventListener("scroll", handler);\n+window.addEventListener("scroll", handler, { passive: true });'
    },
    {
      id: 'phx-perf-3',
      sha: 'e7a8c9d',
      fullSha: 'e7a8c9d000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'preconnect-api',
      title: 'Add preconnect hints for cloud metrics telemetry endpoints',
      commitMessage: 'perf: preconnect to metrics API',
      summary: 'Saves round-trip DNS and TLS handshake latency.',
      files: ['src/index.html'],
      additions: 1,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Preconnects to API domains.',
      diff: 'diff --git a/index.html\n+<link rel="preconnect" href="https://telemetry.acme.com">'
    },
    {
      id: 'phx-perf-4',
      sha: 'b2d3f4a',
      fullSha: 'b2d3f4a000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'virtualized-list',
      title: 'Virtualize high-density table rows to cap DOM nodes below 800',
      commitMessage: 'perf: virtualize table rendering',
      summary: 'Maintains 60fps scrolling across 10,000+ data rows.',
      files: ['src/app/grid.ts'],
      additions: 14,
      deletions: 4,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Uses CDK virtual scrolling viewport.',
      diff: 'diff --git a/grid.html\n+<cdk-virtual-scroll-viewport itemSize="48">'
    },
    {
      id: 'phx-perf-5',
      sha: 'a5c6e7f',
      fullSha: 'a5c6e7f000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'tree-shaking',
      title: 'Replace monolithic date-fns imports with modular subpath imports',
      commitMessage: 'perf: tree-shake date utilities',
      summary: 'Trims 44KB of unused date manipulation utilities.',
      files: ['src/app/date-helpers.ts'],
      additions: 2,
      deletions: 2,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Tree shakes date helpers.',
      diff: 'diff --git a/date.ts\n-import * as dateFns from "date-fns";\n+import { formatDistance } from "date-fns/formatDistance";'
    },
    {
      id: 'phx-a11y-1',
      sha: 'f1b2d3e',
      fullSha: 'f1b2d3e000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'aria-live',
      title: 'Add aria-live="polite" status announcer on filter updates',
      commitMessage: 'a11y: announce filtered row count to screen readers',
      summary: 'Informs non-visual users when query filters modify table contents.',
      files: ['src/app/table.html'],
      additions: 2,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Announces filter results with aria-live.',
      diff: 'diff --git a/table.html\n+<div aria-live="polite" class="sr-only">{{ totalRows }} results found</div>'
    },
    {
      id: 'phx-a11y-2',
      sha: 'd3f4a5c',
      fullSha: 'd3f4a5c000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'aria-expanded',
      title: 'Sync aria-expanded and aria-controls on sidebar toggles',
      commitMessage: 'a11y: accessible sidebar drawer state',
      summary: 'Communicates open/closed disclosure state programmatically.',
      files: ['src/app/sidebar.html'],
      additions: 3,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Binds aria-expanded to drawer state.',
      diff: 'diff --git a/sidebar.html\n+<button [attr.aria-expanded]="isOpen" aria-controls="sidebar-panel">'
    },
    {
      id: 'phx-a11y-3',
      sha: 'e5a6c7b',
      fullSha: 'e5a6c7b000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'focus-visible',
      title: 'Enforce visible 2px outline focus rings across interactive elements',
      commitMessage: 'a11y: distinct focus-visible indicator',
      summary: 'Guarantees keyboard navigation visibility across tabs and inputs.',
      files: ['src/styles.scss'],
      additions: 4,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Styles focus-visible with clear outline.',
      diff: 'diff --git a/styles.scss\n+*:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }'
    },
    {
      id: 'phx-a11y-4',
      sha: 'c8e9b0d',
      fullSha: 'c8e9b0d000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'th-scope',
      title: 'Add scope="col" attributes to table header cells',
      commitMessage: 'a11y: programmatic table column header scopes',
      summary: 'Allows screen readers to associate cells with corresponding column headers.',
      files: ['src/app/data-table.html'],
      additions: 4,
      deletions: 4,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Sets scope="col" on th elements.',
      diff: 'diff --git a/table.html\n-<th>Repository</th>\n+<th scope="col">Repository</th>'
    },
    {
      id: 'phx-a11y-5',
      sha: 'b4d5f6a',
      fullSha: 'b4d5f6a000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'lang-en',
      title: 'Set html lang="en" root document language attribute',
      commitMessage: 'a11y: define document lang attribute',
      summary: 'Enables text-to-speech synthesizers to pronounce terminology accurately.',
      files: ['src/index.html'],
      additions: 1,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Sets lang="en" on html tag.',
      diff: 'diff --git a/index.html\n-<html>\n+<html lang="en">'
    },
    {
      id: 'phx-bp-1',
      sha: 'a6c7e8f',
      fullSha: 'a6c7e8f000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'notification-permission',
      title: 'Prevent requesting browser notification permission on page load',
      commitMessage: 'best-practices: prompt for notification only on user gesture',
      summary: 'Defers permission dialogs until explicit user trigger.',
      files: ['src/app/notifications.ts'],
      additions: 3,
      deletions: 2,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Defers notifications until user click.',
      diff: 'diff --git a/notifications.ts\n+onEnableClick() { Notification.requestPermission(); }'
    },
    {
      id: 'phx-bp-2',
      sha: 'f2d3b4e',
      fullSha: 'f2d3b4e000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'errors-in-console',
      title: 'Catch and handle uncaught rejected promises in auth state listener',
      commitMessage: 'best-practices: handle rejected auth promises',
      summary: 'Eliminates unhandled runtime error log entries.',
      files: ['src/app/auth.ts'],
      additions: 4,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Catches rejected promises safely.',
      diff: 'diff --git a/auth.ts\n+.catch(err => { console.warn("Handled auth error", err); });'
    },
    {
      id: 'phx-bp-3',
      sha: 'e4c5a6b',
      fullSha: 'e4c5a6b000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'manifest-icons',
      title: 'Provide standard 192px and 512px icons in Web App Manifest',
      commitMessage: 'best-practices: complete web app manifest icons',
      summary: 'Satisfies PWA installability requirements.',
      files: ['public/manifest.json'],
      additions: 8,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Defines manifest icon assets.',
      diff: 'diff --git a/manifest.json\n+{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"}'
    },
    {
      id: 'phx-seo-1',
      sha: 'b7d8f9a',
      fullSha: 'b7d8f9a000000000000000000000000000000000',
      category: 'seo',
      categoryLabel: 'SEO',
      ruleId: 'meta-viewport',
      title: 'Ensure meta viewport tag has initial-scale=1 and no user-scalable=no',
      commitMessage: 'seo: standard mobile-friendly viewport meta',
      summary: 'Permits zoom accessibility while providing responsive layouts.',
      files: ['src/index.html'],
      additions: 1,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Sets standard mobile viewport.',
      diff: 'diff --git a/index.html\n+<meta name="viewport" content="width=device-width, initial-scale=1">'
    },
    {
      id: 'phx-seo-2',
      sha: 'a1e2c3d',
      fullSha: 'a1e2c3d000000000000000000000000000000000',
      category: 'seo',
      categoryLabel: 'SEO',
      ruleId: 'title-tag',
      title: 'Add descriptive title tag: Phoenix Cloud SaaS Dashboard',
      commitMessage: 'seo: unique title tag',
      summary: 'Provides concise 48-character document title for search indexes.',
      files: ['src/index.html'],
      additions: 1,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Sets page title.',
      diff: 'diff --git a/index.html\n-<title>App</title>\n+<title>Phoenix Cloud SaaS Dashboard</title>'
    },
    {
      id: 'phx-sec-1',
      sha: 'f3a4b5c',
      fullSha: 'f3a4b5c000000000000000000000000000000000',
      category: 'security',
      categoryLabel: 'Web application security findings',
      ruleId: 'x-content-type',
      title: 'Send X-Content-Type-Options: nosniff on all static asset responses',
      commitMessage: 'security: prevent MIME type sniffing',
      summary: 'Stops browser execution of non-script MIME types as scripts.',
      files: ['server.ts'],
      additions: 2,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Sets nosniff header.',
      diff: 'diff --git a/server.ts\n+res.setHeader("X-Content-Type-Options", "nosniff");'
    },
    {
      id: 'phx-sec-2',
      sha: 'e5b6c7d',
      fullSha: 'e5b6c7d000000000000000000000000000000000',
      category: 'security',
      categoryLabel: 'Web application security findings',
      ruleId: 'rate-limiting',
      title: 'Enforce in-memory sliding window rate limiter on API endpoints',
      commitMessage: 'security: protect API routes with rate limiter',
      summary: 'Protects authentication and data endpoints against brute force attacks.',
      files: ['server.ts'],
      additions: 8,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Adds rate limiting middleware.',
      diff: 'diff --git a/server.ts\n+app.use("/api/", rateLimit({ windowMs: 60000, max: 120 }));'
    },
    {
      id: 'phx-sec-3',
      sha: 'd7a8e9f',
      fullSha: 'd7a8e9f000000000000000000000000000000000',
      category: 'security',
      categoryLabel: 'Web application security findings',
      ruleId: 'env-secrets',
      title: 'Remove hardcoded credentials and bind to process.env variables',
      commitMessage: 'security: externalize secrets into environment',
      summary: 'Eliminates credential exposure in client source code.',
      files: ['src/app/config.ts'],
      additions: 2,
      deletions: 2,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Externalizes keys into environment.',
      diff: 'diff --git a/config.ts\n-const apiKey = "secret_12345";\n+const apiKey = process.env.API_KEY || "";'
    }
  ];

  const remixCommits: AuditCommit[] = [
    {
      id: 'rmx-perf-1',
      sha: 'a2b3c4d',
      fullSha: 'a2b3c4d000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'immutable-cache',
      title: 'Set Cache-Control: public, max-age=31536000, immutable for hashed assets',
      commitMessage: 'perf: leverage immutable browser caching',
      summary: 'Serves static JS and CSS chunks directly from local browser cache.',
      files: ['server.ts'],
      additions: 2,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Adds immutable caching header.',
      diff: 'diff --git a/server.ts\n+res.setHeader("Cache-Control", "public, max-age=31536000, immutable");'
    },
    {
      id: 'rmx-perf-2',
      sha: 'c5d6e7f',
      fullSha: 'c5d6e7f000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'reduce-dom-depth',
      title: 'Flatten deeply nested flex containers and remove redundant wrappers',
      commitMessage: 'perf: reduce DOM depth from 14 to 6 levels',
      summary: 'Decreases style calculation and reflow duration during state changes.',
      files: ['src/app/console-view.html'],
      additions: 6,
      deletions: 14,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Flattens redundant flex containers.',
      diff: 'diff --git a/console.html\n-<div class="outer"><div class="inner"><div class="box">\n+<div class="box">'
    },
    {
      id: 'rmx-perf-3',
      sha: 'e8f9a0b',
      fullSha: 'e8f9a0b000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'web-worker',
      title: 'Offload heavy JSON log diff calculations to a background Web Worker',
      commitMessage: 'perf: worker-based diff processing',
      summary: 'Keeps main thread unblocked and maintains responsive UI interactions.',
      files: ['src/app/worker.ts'],
      additions: 12,
      deletions: 2,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Executes diff algorithm in Web Worker.',
      diff: 'diff --git a/diff.ts\n+const worker = new Worker(new URL("./worker.ts", import.meta.url));'
    },
    {
      id: 'rmx-perf-4',
      sha: 'b1c2d3e',
      fullSha: 'b1c2d3e000000000000000000000000000000000',
      category: 'performance',
      categoryLabel: 'Performance',
      ruleId: 'prefetch-links',
      title: 'Add router prefetch links for high-traffic console sections',
      commitMessage: 'perf: speculative route prefetching',
      summary: 'Renders target views instantaneously upon navigation click.',
      files: ['src/app/nav.ts'],
      additions: 2,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Prefetches route bundles.',
      diff: 'diff --git a/nav.html\n+<a routerLink="/deployments" [routerLinkActiveOptions]="{exact: true}">'
    },
    {
      id: 'rmx-a11y-1',
      sha: 'd4e5f6a',
      fullSha: 'd4e5f6a000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'landmark-roles',
      title: 'Add main, nav, and banner semantic landmark regions',
      commitMessage: 'a11y: semantic landmark structure',
      summary: 'Permits screen reader users to jump directly between primary view landmarks.',
      files: ['src/app/app.html'],
      additions: 3,
      deletions: 3,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Uses semantic landmark elements.',
      diff: 'diff --git a/app.html\n-<div id="header">\n+<header role="banner">'
    },
    {
      id: 'rmx-a11y-2',
      sha: 'f7a8b9c',
      fullSha: 'f7a8b9c000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'aria-invalid',
      title: 'Add aria-invalid and aria-errormessage on form validation failures',
      commitMessage: 'a11y: programmatic form error announcement',
      summary: 'Connects invalid inputs directly to validation explanation text.',
      files: ['src/app/deploy-form.html'],
      additions: 3,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Binds aria-invalid to control state.',
      diff: 'diff --git a/form.html\n+<input [attr.aria-invalid]="hasError" aria-errormessage="err-msg">'
    },
    {
      id: 'rmx-a11y-3',
      sha: 'b0c1d2e',
      fullSha: 'b0c1d2e000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'contrast-buttons',
      title: 'Boost pill button background contrast from 3.1:1 to 4.8:1',
      commitMessage: 'a11y: improve primary button text contrast',
      summary: 'Passes WCAG 1.4.3 AA compliance standard for text elements.',
      files: ['src/styles.scss'],
      additions: 1,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Improves button contrast.',
      diff: 'diff --git a/styles.scss\n-background: #818cf8;\n+background: #4f46e5;'
    },
    {
      id: 'rmx-a11y-4',
      sha: 'e3f4a5b',
      fullSha: 'e3f4a5b000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'aria-selected',
      title: 'Add role="tablist", role="tab", and aria-selected on console views',
      commitMessage: 'a11y: WAI-ARIA tab pattern compliance',
      summary: 'Enables ArrowRight and ArrowLeft keyboard traversal between tabs.',
      files: ['src/app/console-tabs.html'],
      additions: 6,
      deletions: 2,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Implements accessible tablist pattern.',
      diff: 'diff --git a/tabs.html\n+<div role="tablist"><button role="tab" [attr.aria-selected]="activeTab === t">'
    },
    {
      id: 'rmx-a11y-5',
      sha: 'c6d7e8f',
      fullSha: 'c6d7e8f000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'tabindex-cleanup',
      title: 'Remove positive tabindex="3" and tabindex="4" anti-patterns',
      commitMessage: 'a11y: restore natural DOM tab sequence',
      summary: 'Restores intuitive top-to-bottom keyboard focus order.',
      files: ['src/app/header.html'],
      additions: 2,
      deletions: 2,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Removes arbitrary positive tab indexes.',
      diff: 'diff --git a/header.html\n-<button tabindex="3">\n+<button>'
    },
    {
      id: 'rmx-a11y-6',
      sha: 'a9b0c1d',
      fullSha: 'a9b0c1d000000000000000000000000000000000',
      category: 'accessibility',
      categoryLabel: 'Accessibility',
      ruleId: 'keyboard-close',
      title: 'Support Escape key dismissal on slide-out drawer panels',
      commitMessage: 'a11y: dismiss drawers via Escape key',
      summary: 'Satisfies WCAG 2.1.1 Keyboard Dismissable requirements.',
      files: ['src/app/drawer.component.ts'],
      additions: 4,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Binds Escape key to drawer close handler.',
      diff: 'diff --git a/drawer.ts\n+@HostListener("keydown.escape") onEscape() { this.close(); }'
    },
    {
      id: 'rmx-bp-1',
      sha: 'b2c3d4e',
      fullSha: 'b2c3d4e000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'x-frame-options',
      title: 'Set X-Frame-Options: SAMEORIGIN header against clickjacking',
      commitMessage: 'best-practices: frame clickjacking protection',
      summary: 'Restricts embedding within unauthorized foreign iframes.',
      files: ['server.ts'],
      additions: 2,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Configures clickjacking protection headers.',
      diff: 'diff --git a/server.ts\n+res.setHeader("X-Frame-Options", "SAMEORIGIN");'
    },
    {
      id: 'rmx-bp-2',
      sha: 'd5e6f7a',
      fullSha: 'd5e6f7a000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'referrer-policy',
      title: 'Set Referrer-Policy: strict-origin-when-cross-origin',
      commitMessage: 'best-practices: configure referrer policy',
      summary: 'Protects sensitive URL query parameters from leaking to external referrers.',
      files: ['server.ts'],
      additions: 2,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Configures referrer policy.',
      diff: 'diff --git a/server.ts\n+res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");'
    },
    {
      id: 'rmx-bp-3',
      sha: 'f8a9b0c',
      fullSha: 'f8a9b0c000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'permissions-policy',
      title: 'Set Permissions-Policy: camera=(), microphone=(), geolocation=()',
      commitMessage: 'best-practices: disable unneeded device hardware APIs',
      summary: 'Reduces browser feature attack surface.',
      files: ['server.ts'],
      additions: 2,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Sets Permissions-Policy headers.',
      diff: 'diff --git a/server.ts\n+res.setHeader("Permissions-Policy", "camera=(), microphone=()");'
    },
    {
      id: 'rmx-bp-4',
      sha: 'c1d2e3f',
      fullSha: 'c1d2e3f000000000000000000000000000000000',
      category: 'best-practices',
      categoryLabel: 'Best practices',
      ruleId: 'no-document-write',
      title: 'Eliminate deprecated document.write() API calls',
      commitMessage: 'best-practices: remove document.write calls',
      summary: 'Stops synchronous parser-blocking document mutations.',
      files: ['src/app/legacy-injector.ts'],
      additions: 2,
      deletions: 2,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Replaces document.write with DOM appendChild.',
      diff: 'diff --git a/legacy.ts\n-document.write(script);\n+document.head.appendChild(element);'
    },
    {
      id: 'rmx-seo-1',
      sha: 'e4f5a6b',
      fullSha: 'e4f5a6b000000000000000000000000000000000',
      category: 'seo',
      categoryLabel: 'SEO',
      ruleId: 'link-text',
      title: 'Replace vague "click here" anchors with descriptive destination copy',
      commitMessage: 'seo: descriptive anchor text',
      summary: 'Improves crawling context and search relevance scores.',
      files: ['src/app/docs-link.html'],
      additions: 1,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Uses descriptive link anchors.',
      diff: 'diff --git a/docs.html\n-<a href="/docs">Click here</a>\n+<a href="/docs">Browse Cloud Console Documentation</a>'
    },
    {
      id: 'rmx-seo-2',
      sha: 'a7b8c9d',
      fullSha: 'a7b8c9d000000000000000000000000000000000',
      category: 'seo',
      categoryLabel: 'SEO',
      ruleId: 'hreflang',
      title: 'Declare hreflang="x-default" and localized language alternates',
      commitMessage: 'seo: internationalization hreflang alternates',
      summary: 'Directs global users to appropriate language instances.',
      files: ['src/index.html'],
      additions: 2,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Adds hreflang link tags.',
      diff: 'diff --git a/index.html\n+<link rel="alternate" hreflang="x-default" href="https://remix-console.io/">'
    },
    {
      id: 'rmx-seo-3',
      sha: 'c0d1e2f',
      fullSha: 'c0d1e2f000000000000000000000000000000000',
      category: 'seo',
      categoryLabel: 'SEO',
      ruleId: 'twitter-card',
      title: 'Configure Twitter summary_large_image card tags',
      commitMessage: 'seo: twitter card metadata',
      summary: 'Produces attractive preview cards on social feeds.',
      files: ['src/index.html'],
      additions: 4,
      deletions: 0,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Adds twitter card tags.',
      diff: 'diff --git a/index.html\n+<meta name="twitter:card" content="summary_large_image">'
    },
    {
      id: 'rmx-sec-1',
      sha: 'f3e4d5c',
      fullSha: 'f3e4d5c000000000000000000000000000000000',
      category: 'security',
      categoryLabel: 'Web application security findings',
      ruleId: 'csrf-tokens',
      title: 'Validate anti-CSRF double-submit tokens on POST state mutations',
      commitMessage: 'security: enforce CSRF tokens on mutate routes',
      summary: 'Prevents cross-site payload injection against authenticated sessions.',
      files: ['server.ts'],
      additions: 6,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Validates CSRF tokens.',
      diff: 'diff --git a/server.ts\n+if (req.headers["x-csrf-token"] !== req.cookies["csrf"]) return res.status(403).send();'
    },
    {
      id: 'rmx-sec-2',
      sha: 'b6a7c8d',
      fullSha: 'b6a7c8d000000000000000000000000000000000',
      category: 'security',
      categoryLabel: 'Web application security findings',
      ruleId: 'prototype-pollution',
      title: 'Guard recursive object merge functions against __proto__ pollution',
      commitMessage: 'security: protect against prototype pollution',
      summary: 'Blocks object prototype manipulation via malicious JSON payloads.',
      files: ['src/app/merge-utils.ts'],
      additions: 3,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Sanitizes object keys against prototype pollution.',
      diff: 'diff --git a/merge.ts\n+if (key === "__proto__" || key === "constructor") continue;'
    },
    {
      id: 'rmx-sec-3',
      sha: 'e9f0a1b',
      fullSha: 'e9f0a1b000000000000000000000000000000000',
      category: 'security',
      categoryLabel: 'Web application security findings',
      ruleId: 'cors-origin',
      title: 'Restrict Access-Control-Allow-Origin to authorized tenant domains',
      commitMessage: 'security: lock down CORS origin header',
      summary: 'Replaces wildcards with strict whitelist of trusted hosts.',
      files: ['server.ts'],
      additions: 4,
      deletions: 1,
      author: 'Fresnel OSS <fresnel@local>',
      date: new Date().toUTCString(),
      body: 'Restricts CORS allowed origins.',
      diff: 'diff --git a/server.ts\n-res.setHeader("Access-Control-Allow-Origin", "*");\n+res.setHeader("Access-Control-Allow-Origin", "https://remix-console.io");'
    }
  ];

  const luminaTitles = luminaCommits.map((c) => c.title);
  const phoenixTitles = phoenixCommits.map((c) => c.title);
  const remixTitles = remixCommits.map((c) => c.title);

  const sample1: LocalSavedAuditRecord = {
    auditId: 'local_sample_lumina_store_json',
    ownerId: 'local',
    repoFullName: 'fresnel-sandbox/lumina-ecommerce-store',
    repoUrl: 'https://github.com/fresnel-sandbox/lumina-ecommerce-store',
    branch: 'main',
    runPhase: 'static',
    mode: 'live',
    totalCommitsCount: luminaCommits.length,
    selectedCommitsCount: luminaCommits.length,
    performanceBefore: 58,
    performanceAfter: 92,
    accessibilityBefore: 68,
    accessibilityAfter: 96,
    bestPracticesBefore: 74,
    bestPracticesAfter: 95,
    seoBefore: 72,
    seoAfter: 98,
    securityBefore: 65,
    securityAfter: 94,
    summaryNotes: 'Lumina store e-commerce static AST audit: 24 atomic remediation commits. Performance +34 pts, Accessibility +28 pts, Best Practices +21 pts, SEO +26 pts, Security +29 pts.',
    commitTitles: luminaTitles,
    createdAtIso: date1,
    updatedAtIso: date1,
    storageSource: 'local',
    savedFormat: 'json',
    snapshotSession: null
  };
  sample1.snapshotSession = buildSynthesizedSessionFromRecord(sample1, luminaCommits);

  const sample2: LocalSavedAuditRecord = {
    auditId: 'local_sample_phoenix_saas_toon',
    ownerId: 'local',
    repoFullName: 'acme-corp/phoenix-saas-dashboard',
    repoUrl: 'https://github.com/acme-corp/phoenix-saas-dashboard',
    branch: 'main',
    runPhase: 'lhr',
    mode: 'live',
    totalCommitsCount: phoenixCommits.length,
    selectedCommitsCount: phoenixCommits.length,
    performanceBefore: 64,
    performanceAfter: 91,
    accessibilityBefore: 72,
    accessibilityAfter: 95,
    bestPracticesBefore: 80,
    bestPracticesAfter: 96,
    seoBefore: 76,
    seoAfter: 94,
    securityBefore: 70,
    securityAfter: 93,
    summaryNotes: 'Phoenix SaaS metrics dashboard LHR JSON audit: 18 atomic commits saved locally in TOON format. Performance +27 pts, Accessibility +23 pts, Best Practices +16 pts.',
    commitTitles: phoenixTitles,
    createdAtIso: date2,
    updatedAtIso: date2,
    storageSource: 'local',
    savedFormat: 'toon',
    snapshotSession: null
  };
  sample2.snapshotSession = buildSynthesizedSessionFromRecord(sample2, phoenixCommits);

  const sample3: LocalSavedAuditRecord = {
    auditId: 'local_sample_remix_console_md',
    ownerId: 'local',
    repoFullName: 'open-source/remix-cloud-console',
    repoUrl: 'https://github.com/open-source/remix-cloud-console',
    branch: 'main',
    runPhase: 'static',
    mode: 'live',
    totalCommitsCount: remixCommits.length,
    selectedCommitsCount: remixCommits.length,
    performanceBefore: 61,
    performanceAfter: 93,
    accessibilityBefore: 65,
    accessibilityAfter: 97,
    bestPracticesBefore: 78,
    bestPracticesAfter: 94,
    seoBefore: 82,
    seoAfter: 96,
    securityBefore: 60,
    securityAfter: 95,
    summaryNotes: 'Remix cloud console audit snapshot saved in Markdown format: 20 atomic commits across all five web quality dimensions. Performance +32 pts, Accessibility +32 pts, Security +35 pts.',
    commitTitles: remixTitles,
    createdAtIso: date3,
    updatedAtIso: date3,
    storageSource: 'local',
    savedFormat: 'markdown',
    snapshotSession: null
  };
  sample3.snapshotSession = buildSynthesizedSessionFromRecord(sample3, remixCommits);

  const date4 = new Date(now - 1000 * 60 * 60 * 52).toISOString();
  const date5 = new Date(now - 1000 * 60 * 60 * 96).toISOString();
  const date6 = new Date(now - 1000 * 60 * 60 * 72).toISOString();

  const sample4: LocalSavedAuditRecord = {
    ...sample1,
    auditId: 'local_sample_lumina_store_run2',
    branch: 'release/v1.4',
    runPhase: 'lhr',
    performanceBefore: 61,
    performanceAfter: 84,
    accessibilityBefore: 66,
    accessibilityAfter: 88,
    bestPracticesBefore: 72,
    bestPracticesAfter: 89,
    seoBefore: 70,
    seoAfter: 91,
    securityBefore: 64,
    securityAfter: 86,
    summaryNotes: 'Lumina store release/v1.4 LHR follow-up run: hero image preload improved LCP while minor contrast regressions surfaced on checkout badges.',
    createdAtIso: date4,
    updatedAtIso: date4,
    snapshotSession: null
  };
  sample4.snapshotSession = buildSynthesizedSessionFromRecord(sample4, luminaCommits.slice(0, 12));

  const sample5: LocalSavedAuditRecord = {
    ...sample1,
    auditId: 'local_sample_lumina_store_run1',
    branch: 'release/v1.3',
    runPhase: 'static',
    performanceBefore: 52,
    performanceAfter: 76,
    accessibilityBefore: 60,
    accessibilityAfter: 81,
    bestPracticesBefore: 68,
    bestPracticesAfter: 84,
    seoBefore: 68,
    seoAfter: 86,
    securityBefore: 60,
    securityAfter: 82,
    summaryNotes: 'Lumina store initial baseline audit on release/v1.3 establishing Performance and Accessibility benchmark scores.',
    createdAtIso: date5,
    updatedAtIso: date5,
    snapshotSession: null
  };
  sample5.snapshotSession = buildSynthesizedSessionFromRecord(sample5, luminaCommits.slice(0, 10));

  const sample6: LocalSavedAuditRecord = {
    ...sample2,
    auditId: 'local_sample_phoenix_saas_run1',
    branch: 'release/v2.1',
    runPhase: 'static',
    performanceBefore: 55,
    performanceAfter: 82,
    accessibilityBefore: 64,
    accessibilityAfter: 85,
    bestPracticesBefore: 74,
    bestPracticesAfter: 88,
    seoBefore: 72,
    seoAfter: 89,
    securityBefore: 66,
    securityAfter: 86,
    summaryNotes: 'Phoenix SaaS dashboard earlier baseline run prior to chart virtualization and ARIA table remediation.',
    createdAtIso: date6,
    updatedAtIso: date6,
    snapshotSession: null
  };
  sample6.snapshotSession = buildSynthesizedSessionFromRecord(sample6, phoenixCommits.slice(0, 10));

  return [sample1, sample2, sample3, sample4, sample6, sample5];
}
