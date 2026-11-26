import { TestBed } from '@angular/core/testing';
import {
  LOCAL_SAVED_AUDITS_STORAGE_KEY,
  LocalAuditStorageService,
  buildLocalSavedAuditRecord,
  escapeCsvCell,
  parseLocalAuditFile,
  serializeAuditHistoryToCsv,
  serializeAuditToJson,
  serializeAuditToMarkdown,
  serializeAuditToToon
} from './local-audit-storage.service';
import { AuditImpactMetrics, AuditSession } from '../models/audit.model';

function createMockSession(): AuditSession {
  return {
    id: 'local-test-1',
    interactionId: 'int-local-test-1',
    mode: 'demo',
    runPhase: 'static',
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
    categories: ['performance', 'accessibility'],
    currentStep: {
      index: 0,
      phase: 'Completed',
      category: 'Complete',
      headline: 'Audit complete',
      narrative: 'Done.'
    },
    steps: [],
    totalSteps: 1,
    commits: [
      {
        id: 'commit-lcp-1',
        sha: 'abc1234',
        fullSha: 'abc1234000000000000000000000000000000000',
        category: 'performance',
        categoryLabel: 'Performance',
        ruleId: 'largest-contentful-paint',
        title: 'Preload hero banner image',
        commitMessage: 'perf: preload hero banner image',
        summary: 'Adds fetchpriority="high" on the hero media tag.',
        files: ['src/index.html', 'src/app/hero.html'],
        additions: 4,
        deletions: 1,
        author: 'Fresnel OSS <fresnel@local>',
        date: 'Mon, 24 Nov 2026 12:00:00 GMT',
        body: 'Preloads hero image.',
        diff: 'diff --git a/src/index.html b/src/index.html\n@@ -1,1 +1,1 @@\n-<img src="/hero.jpg">\n+<img src="/hero.jpg" fetchpriority="high">'
      },
      {
        id: 'commit-a11y-2',
        sha: 'def5678',
        fullSha: 'def5678000000000000000000000000000000000',
        category: 'accessibility',
        categoryLabel: 'Accessibility',
        ruleId: 'button-name',
        title: 'Add aria-label to icon-only toolbar button',
        commitMessage: 'a11y: add aria-label to icon button',
        summary: 'Injects aria-label via deterministic jscodeshift transform.',
        files: ['src/app/toolbar.html'],
        additions: 2,
        deletions: 1,
        author: 'Fresnel OSS <fresnel@local>',
        date: 'Mon, 24 Nov 2026 12:00:00 GMT',
        body: 'Accessible button name.',
        diff: 'diff --git a/src/app/toolbar.html b/src/app/toolbar.html\n@@ -1,1 +1,1 @@\n-<button></button>\n+<button aria-label="Menu"></button>'
      }
    ],
    totalCommits: 2,
    pr: null
  };
}

function createMockImpact(): AuditImpactMetrics {
  return {
    performanceBefore: 62,
    performanceAfter: 94,
    accessibilityBefore: 71,
    accessibilityAfter: 97,
    bestPracticesBefore: 80,
    bestPracticesAfter: 95,
    seoBefore: 82,
    seoAfter: 96,
    securityBefore: 75,
    securityAfter: 92,
    detailedAxes: [],
    categoryAxes: []
  };
}

describe('LocalAuditStorageService', () => {
  let service: LocalAuditStorageService;

  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOCAL_SAVED_AUDITS_STORAGE_KEY);
    }
    TestBed.configureTestingModule({
      providers: [LocalAuditStorageService]
    });
    service = TestBed.inject(LocalAuditStorageService);
  });

  afterEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOCAL_SAVED_AUDITS_STORAGE_KEY);
    }
  });

  it('round-trips locally saved scans across JSON, TOON, and Markdown formats', () => {
    const session = createMockSession();
    const record = buildLocalSavedAuditRecord(session, createMockImpact(), session.commits, 'toon');

    const jsonText = serializeAuditToJson(record);
    const parsedJson = parseLocalAuditFile('scan.json', jsonText);
    expect(parsedJson.repoFullName).toBe('fresnel-sandbox/lumina-web-app');
    expect(parsedJson.savedFormat).toBe('json');
    expect(parsedJson.performanceAfter).toBe(94);
    expect(parsedJson.snapshotSession?.commits.length).toBe(2);

    const toonText = serializeAuditToToon(record);
    expect(toonText).toContain('format: fresnel-audit-toon/v1');
    expect(toonText).toContain('commits[2]{');
    const parsedToon = parseLocalAuditFile('scan.toon', toonText);
    expect(parsedToon.repoFullName).toBe('fresnel-sandbox/lumina-web-app');
    expect(parsedToon.savedFormat).toBe('toon');
    expect(parsedToon.accessibilityAfter).toBe(97);
    expect(parsedToon.snapshotSession?.commits.length).toBe(2);
    expect(parsedToon.snapshotSession?.commits[1].category).toBe('accessibility');

    const mdText = serializeAuditToMarkdown(record);
    expect(mdText).toContain('format: fresnel-audit-markdown/v1');
    const parsedMd = parseLocalAuditFile('scan.md', mdText);
    expect(parsedMd.repoFullName).toBe('fresnel-sandbox/lumina-web-app');
    expect(parsedMd.savedFormat).toBe('markdown');
    expect(parsedMd.performanceBefore).toBe(62);
    expect(parsedMd.seoAfter).toBe(96);
    expect(parsedMd.commitTitles.length).toBe(2);
    expect(parsedMd.snapshotSession?.commits[0].category).toBe('performance');
    expect(parsedMd.snapshotSession?.commits[1].category).toBe('accessibility');
  });

  it('saves, imports, exports, and deletes scans in localAudits without requiring auth', () => {
    const session = createMockSession();
    const saved = service.saveSessionLocally(session, createMockImpact(), session.commits, 'toon');
    expect(service.localAudits().length).toBe(1);
    expect(saved.storageSource).toBe('local');
    expect(saved.savedFormat).toBe('toon');

    const exported = service.exportRecordPayload(saved, 'markdown');
    expect(exported.filename).toBe('fresnel-lumina-web-app-code-audit.md');
    expect(exported.content).toContain('# Saved Repository Audit');

    const imported = service.importAuditFile('imported-scan.md', exported.content);
    expect(imported.storageSource).toBe('imported');
    expect(service.localAudits().length).toBe(1); // same auditId upserts cleanly

    service.deleteLocalAudit(saved.auditId);
    expect(service.localAudits().length).toBe(0);
  });

  it('serializes historical audit score data into RFC-4180 CSV for spreadsheet tools', () => {
    const session = createMockSession();
    const rec = buildLocalSavedAuditRecord(session, createMockImpact(), session.commits, 'json');
    rec.summaryNotes = 'Quoted "LCP, CLS" audit summary';

    expect(escapeCsvCell('simple')).toBe('simple');
    expect(escapeCsvCell('a, "b"')).toBe('"a, ""b"""');

    const csv = serializeAuditHistoryToCsv([rec]);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('Audit ID,Repository,Owner / Org');
    expect(lines[0]).toContain('Performance Before,Performance After,Performance Delta');
    expect(lines[1]).toContain('fresnel-sandbox/lumina-web-app');
    expect(lines[1]).toContain(',62,94,32,');
    expect(lines[1]).toContain(',71,97,26,');
    expect(lines[1]).toContain('"Quoted ""LCP, CLS"" audit summary"');

    const csvPayload = service.exportConsolidatedCsvPayload([rec]);
    expect(csvPayload.filename).toMatch(/^fresnel-saved-audits-history-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csvPayload.mimeType).toBe('text/csv;charset=utf-8');
    expect(csvPayload.totalCount).toBe(1);
  });
});
