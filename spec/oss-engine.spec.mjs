/**
 * Fresnel Zero-AI Open-Source Audit Engine — Jasmine Test Suite
 *
 * Verifies deterministic output across:
 * 1. Core AST Rules & Unified Git Patch generation (ast-rules.js)
 * 2. jscodeshift AST Codemods (jscodeshift-codemods.js)
 * 3. Sandboxed Local ESLint & Stylelint Pipelines (linter-pipeline.js)
 * 4. Lighthouse LHR Correlator & SSRF URL Guard (lighthouse-runner.js)
 * 5. Report & RFC-2822 Patch Builders (report-builders.js)
 * 6. Full End-to-End Orchestrator Determinism (audit-orchestrator.js)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDemoSandboxFiles } from '../server/oss-engine/repo-ingestion.js';
import { detectGithubSshReadiness } from '../server/oss-engine/ssh-diagnostics.js';
import {
  buildUnifiedGitDiff,
  computeDeterministicScores,
  runAllStaticAstRules
} from '../server/oss-engine/ast-rules.js';
import {
  runJscodeshiftA11yCodemod,
  runJscodeshiftDomUpdatesCodemod
} from '../server/oss-engine/jscodeshift-codemods.js';
import {
  runLocalEslintPipeline,
  runLocalStylelintPipeline
} from '../server/oss-engine/linter-pipeline.js';
import {
  validatePublicTargetUrl,
  correlateLhrWithWorkspace
} from '../server/oss-engine/lighthouse-runner.js';
import {
  SAMPLE_LIGHTHOUSE_LHR_JSON,
  buildPullRequestCliBundle,
  generateAuditReportMarkdown,
  generateAuditReportPdfBuffer,
  generateGitFormatPatch,
  parseRepoUrl,
  sanitizeGitRefName
} from '../server/oss-engine/report-builders.js';
import { executeOssStaticAudit } from '../server/oss-engine/audit-orchestrator.js';

const DEMO_REPO = {
  owner: 'fresnel-sandbox',
  repo: 'lumina-web-app',
  fullName: 'fresnel-sandbox/lumina-web-app',
  url: 'https://github.com/fresnel-sandbox/lumina-web-app',
  isDemo: true
};

describe('Fresnel Zero-AI OSS Audit Engine Pipeline', () => {
  const sandboxFiles = buildDemoSandboxFiles(DEMO_REPO);

  describe('Core AST Rules & Unified Diff Builder', () => {
    it('generates valid git unified diffs with accurate addition/deletion counts', () => {
      const result = buildUnifiedGitDiff([
        {
          relPath: 'src/index.html',
          before: '<title>App</title>\n',
          after: '<title>Lumina</title>\n<meta name="description" content="Fast">\n'
        }
      ]);

      expect(result.files).toEqual(['src/index.html']);
      expect(result.additions).toBe(2);
      expect(result.deletions).toBe(1);
      expect(result.diff).toContain('diff --git a/src/index.html b/src/index.html');
      expect(result.diff).toContain('-<title>App</title>');
      expect(result.diff).toContain('+<title>Lumina</title>');
    });

    it('runs static AST rules deterministically with identical SHAs and diffs across runs', () => {
      const run1 = runAllStaticAstRules(sandboxFiles, DEMO_REPO);
      const run2 = runAllStaticAstRules(sandboxFiles, DEMO_REPO);

      expect(run1.length).toBeGreaterThanOrEqual(14);
      expect(run1.map((c) => c.fullSha)).toEqual(run2.map((c) => c.fullSha));
      expect(run1.map((c) => c.diff)).toEqual(run2.map((c) => c.diff));
    });

    it('respects selected category filtering accurately', () => {
      const seoOnly = runAllStaticAstRules(sandboxFiles, DEMO_REPO, ['seo']);
      expect(seoOnly.length).toBeGreaterThan(0);
      expect(seoOnly.every((c) => c.category === 'seo')).toBeTrue();
    });

    it('computes bounded deterministic Before/After scores from commits', () => {
      const commits = runAllStaticAstRules(sandboxFiles, DEMO_REPO);
      const scores = computeDeterministicScores(commits, null);
      expect(scores.performanceBefore).toBeLessThan(scores.performanceAfter);
      expect(scores.accessibilityBefore).toBeLessThan(scores.accessibilityAfter);
      expect(scores.performanceAfter).toBeLessThanOrEqual(98);
      expect(scores.accessibilityAfter).toBeLessThanOrEqual(98);
    });
  });

  describe('jscodeshift Deterministic AST Codemods', () => {
    it('injects ARIA labels, role/tabIndex, alt text, and DOM button attributes via jscodeshift', () => {
      const { commit, stats } = runJscodeshiftA11yCodemod(sandboxFiles, DEMO_REPO);
      expect(commit).not.toBeNull();
      expect(commit.ruleId).toBe('jscodeshift-a11y-injection');
      expect(commit.category).toBe('accessibility');
      expect(stats.buttonLabelsInjected).toBeGreaterThan(0);
      expect(stats.interactiveRolesInjected).toBeGreaterThan(0);
      expect(stats.imageAltsInjected).toBeGreaterThan(0);
      expect(stats.domButtonsHardened).toBeGreaterThan(0);
      expect(commit.diff).toContain('aria-label="Dismiss"');
      expect(commit.diff).toContain('role="button"');
      expect(commit.diff).toContain('tabIndex={0}');
      expect(commit.diff).toContain("closeCardBtn.type = 'button'");
    });

    it('automates DOM element security and async media updates via jscodeshift', () => {
      const { commit, stats } = runJscodeshiftDomUpdatesCodemod(sandboxFiles, DEMO_REPO);
      expect(commit).not.toBeNull();
      expect(commit.ruleId).toBe('jscodeshift-dom-updates');
      expect(commit.category).toBe('best-practices');
      expect(stats.jsxLinksHardened).toBeGreaterThan(0);
      expect(stats.domAnchorsHardened).toBeGreaterThan(0);
      expect(stats.domImagesUpdated).toBeGreaterThan(0);
      expect(stats.windowOpensHardened).toBeGreaterThan(0);
      expect(commit.diff).toContain('rel="noopener noreferrer"');
      expect(commit.diff).toContain("previewImg.decoding = 'async'");
      expect(commit.diff).toContain("'noopener,noreferrer'");
    });
  });

  describe('Sandboxed Local ESLint & Stylelint Pipelines', () => {
    it('auto-fixes JS/TS best-practice violations with ESLint flat-config pipeline', async () => {
      const { commit, diagnostics } = await runLocalEslintPipeline(sandboxFiles, DEMO_REPO);
      expect(commit).not.toBeNull();
      expect(commit.ruleId).toBe('eslint-best-practices');
      expect(diagnostics.filesScanned).toBeGreaterThan(0);
      expect(diagnostics.autoFixedCount).toBeGreaterThan(0);
      expect(commit.diff).toContain('-  var isActive = true;');
      expect(commit.diff).toContain('+  const isActive = true;');
    });

    it('auto-fixes CSS/SCSS best-practice violations with Stylelint pipeline', async () => {
      const { commit, diagnostics } = await runLocalStylelintPipeline(sandboxFiles, DEMO_REPO);
      expect(commit).not.toBeNull();
      expect(commit.ruleId).toBe('stylelint-best-practices');
      expect(diagnostics.filesScanned).toBeGreaterThan(0);
      expect(diagnostics.autoFixedCount).toBeGreaterThan(0);
      expect(commit.diff).toContain('+.hero-badge::before {');
      expect(commit.diff).toContain('+  padding: 12px;');
      expect(commit.diff).toContain('+  color: #fff;');
    });
  });

  describe('Lighthouse LHR Correlation & SSRF Protection', () => {
    it('blocks localhost, loopback, metadata, and private network URLs against SSRF', async () => {
      await expectAsync(validatePublicTargetUrl('http://127.0.0.1:3000')).toBeRejected();
      await expectAsync(validatePublicTargetUrl('http://localhost/admin')).toBeRejected();
      await expectAsync(validatePublicTargetUrl('http://169.254.169.254/latest/meta-data')).toBeRejected();
      await expectAsync(validatePublicTargetUrl('http://10.0.0.1/internal')).toBeRejected();
      await expectAsync(validatePublicTargetUrl('file:///etc/passwd')).toBeRejected();
    });

    it('correlates Lighthouse LHR JSON findings against repository files deterministically', () => {
      const res = correlateLhrWithWorkspace(DEMO_REPO, SAMPLE_LIGHTHOUSE_LHR_JSON, sandboxFiles);
      expect(res.commits.length).toBeGreaterThan(0);
      expect(res.lhrVersion).toBe('12.2.0');
      expect(res.deterministicMetrics.performanceBefore).toBe(68);
      expect(res.deterministicMetrics.performanceAfter).toBeGreaterThan(68);
    });
  });

  describe('Report & RFC-2822 Patch Builders', () => {
    it('parses full GitHub URLs and owner/repo shorthands safely', () => {
      const parsedUrl = parseRepoUrl('https://github.com/angular/angular.git', 'live');
      expect(parsedUrl.owner).toBe('angular');
      expect(parsedUrl.repo).toBe('angular');
      expect(parsedUrl.fullName).toBe('angular/angular');

      const parsedShort = parseRepoUrl('vercel/next.js', 'live');
      expect(parsedShort.fullName).toBe('vercel/next.js');
    });

    it('orchestrates full static audit and exports deterministic RFC-2822 patch, Markdown, and PDF', async () => {
      const session = {
        id: 'jasmine-e2e-session',
        repo: DEMO_REPO,
        branch: 'main',
        mode: 'demo',
        runPhase: 'static',
        categories: ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
        steps: [],
        commits: [],
        sseListeners: new Set()
      };

      await executeOssStaticAudit(session);

      expect(session.ossEngine.completed).toBeTrue();
      expect(session.commits.length).toBeGreaterThanOrEqual(18);
      expect(session.ossEngine.jscodeshiftSummary.commitsGenerated).toBe(2);
      expect(session.ossEngine.linterSummary.eslint.autoFixedCount).toBeGreaterThan(0);
      expect(session.ossEngine.linterSummary.stylelint.autoFixedCount).toBeGreaterThan(0);

      const patch = generateGitFormatPatch(session, [session.commits[0].id]);
      expect(patch).toContain('Subject: [PATCH]');
      expect(patch).toContain('diff --git ');

      const md = generateAuditReportMarkdown(session);
      expect(md).toContain('# Fresnel Zero-AI Static AST');
      expect(md).toContain('jscodeshift');

      const pdfBuf = generateAuditReportPdfBuffer(session);
      expect(Buffer.isBuffer(pdfBuf)).toBeTrue();
      expect(pdfBuf.toString('utf8', 0, 8)).toBe('%PDF-1.4');
    });

    it('sanitizes git ref names against invalid characters and path traversal', () => {
      expect(sanitizeGitRefName('feat/zero-ai-oss-audit-engine')).toBe('feat/zero-ai-oss-audit-engine');
      expect(sanitizeGitRefName('bad..branch name~1^2:foo.lock', 'main')).toBe('bad-branch-name-1-2-foo');
      expect(sanitizeGitRefName('--leading-dash', 'main')).toBe('leading-dash');
      expect(sanitizeGitRefName('///', 'main')).toBe('main');
    });

    it('generates valid 40-char mbox From headers and safely escaped PR CLI commands', async () => {
      const session = {
        id: 'jasmine-cli-bundle-session',
        repo: DEMO_REPO,
        branch: 'feat/bad..branch name',
        mode: 'demo',
        runPhase: 'static',
        categories: ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
        steps: [],
        commits: [],
        sseListeners: new Set()
      };

      await executeOssStaticAudit(session);

      const fullPatch = generateGitFormatPatch(
        session,
        session.commits.map((c) => c.id)
      );
      const fromHeaders = fullPatch
        .split('\n')
        .filter((line) => line.startsWith('From ') && line.includes('Mon Sep 17 00:00:00 2001'));
      expect(fromHeaders.length).toBe(session.commits.length);
      for (const header of fromHeaders) {
        expect(header).toMatch(/^From [0-9a-f]{40} Mon Sep 17 00:00:00 2001$/);
      }

      const bundle = buildPullRequestCliBundle(
        session,
        session.commits.slice(0, 2).map((c) => c.id),
        { headBranch: 'feat/fix..invalid ref', prTitle: 'Fix $HOME & contrast' }
      );
      expect(bundle.baseBranch).toBe('feat/bad-branch-name');
      expect(bundle.headBranch).toBe('feat/fix-invalid-ref');
      expect(bundle.terminalCommand).toContain("git am << 'FRESNEL_PATCH_EOF'");
      expect(bundle.terminalCommand).toContain('Fix \\$HOME & contrast');
      expect(bundle.shortTerminalCommand).not.toContain(' --3way');
    });
  });

  describe('GitHub SSH Key Readiness Detector', () => {
    it('flags missing_key when ~/.ssh directory does not exist or has no key pairs', async () => {
      const tmpMissing = path.join(os.tmpdir(), `fresnel-ssh-missing-${Date.now()}`);
      const res = await detectGithubSshReadiness({
        sshDir: tmpMissing,
        skipSystemCmds: true
      });
      expect(res.sshDirExists).toBeFalse();
      expect(res.missingSshKey).toBeTrue();
      expect(res.status).toBe('missing_key');
      expect(res.detectedPublicKeys).toEqual([]);
      expect(res.recommendations.length).toBeGreaterThan(0);
    });

    it('detects existing public/private key pairs and github.com SSH config without exposing private keys', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresnel-ssh-ready-'));
      try {
        const privateSentinel = 'PRIVATE_KEY_SECRET_SENTINEL_DO_NOT_LEAK';
        fs.writeFileSync(path.join(tmpDir, 'id_ed25519'), privateSentinel, 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'id_ed25519.pub'), 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 test@example.com\n', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'config'), 'Host github.com\n  IdentityFile ~/.ssh/id_ed25519\n', 'utf8');

        const res = await detectGithubSshReadiness({
          sshDir: tmpDir,
          skipSystemCmds: true
        });
        expect(res.sshDirExists).toBeTrue();
        expect(res.missingSshKey).toBeFalse();
        expect(res.detectedPublicKeys).toEqual(['id_ed25519.pub']);
        expect(res.hasMatchingPrivateKey).toBeTrue();
        expect(res.hasGithubConfigEntry).toBeTrue();
        expect(JSON.stringify(res)).not.toContain(privateSentinel);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
