/**
 * Fresnel Repository Scanning & Codemod Utility — Jasmine Spec Suite (`tests/`)
 *
 * Tests the core data processing utility functions responsible for:
 * 1. Repository identifier sanitization & path normalization
 * 2. Deterministic file priority scoring, sorting, and scan-cap enforcement
 * 3. File eligibility & security checks (size limits, symlink rejection, binary detection, path traversal)
 * 4. GitHub URL parsing & sandbox workspace file construction
 * 5. Root `transforms/inject-icon-button-aria-label.js` jscodeshift transform
 */

import path from 'node:path';
import jscodeshift from 'jscodeshift';
import {
  MAX_SCAN_FILE_BYTES,
  buildDemoSandboxFiles,
  isEligibleSourceFile,
  normalizeRelativePath,
  sanitizeRepoIdentifier,
  scoreRepoFilePriority,
  sortAndCapDiscoveredPaths
} from '../server/oss-engine/repo-ingestion.js';
import { parseRepoUrl } from '../server/oss-engine/report-builders.js';
import injectIconButtonAriaLabel, {
  inferIconButtonLabel
} from '../transforms/inject-icon-button-aria-label.js';

describe('Repository Scanning Core Data Processing Utilities', () => {
  describe('sanitizeRepoIdentifier()', () => {
    it('accepts valid GitHub owner and repository names', () => {
      const res = sanitizeRepoIdentifier('angular', 'angular-cli.v2');
      expect(res.isValid).toBeTrue();
      expect(res.safeOwner).toBe('angular');
      expect(res.safeRepo).toBe('angular-cli.v2');
    });

    it('strips unsafe shell/URL characters while preserving valid identifiers', () => {
      const res = sanitizeRepoIdentifier('my-org$!', 'web_app;rm -rf');
      expect(res.isValid).toBeTrue();
      expect(res.safeOwner).toBe('my-org');
      expect(res.safeRepo).toBe('web_apprm-rf');
    });

    it('rejects dot-traversal and empty owner/repo values', () => {
      expect(sanitizeRepoIdentifier('..', 'repo').isValid).toBeFalse();
      expect(sanitizeRepoIdentifier('owner', '.').isValid).toBeFalse();
      expect(sanitizeRepoIdentifier('', 'repo').isValid).toBeFalse();
      expect(sanitizeRepoIdentifier('owner', '///').isValid).toBeFalse();
    });
  });

  describe('normalizeRelativePath()', () => {
    it('converts Windows backslashes and strips leading dot/slash prefixes', () => {
      expect(normalizeRelativePath('./src\\app\\app.component.ts')).toBe('src/app/app.component.ts');
      expect(normalizeRelativePath('/public/index.html')).toBe('public/index.html');
      expect(normalizeRelativePath('')).toBe('');
    });
  });

  describe('scoreRepoFilePriority() and sortAndCapDiscoveredPaths()', () => {
    it('ranks entrypoints, app components, routes, and stylesheets ahead of deep modules', () => {
      expect(scoreRepoFilePriority('src/index.html')).toBe(0);
      expect(scoreRepoFilePriority('src/app/app.component.ts')).toBe(1);
      expect(scoreRepoFilePriority('src/app/app.routes.ts')).toBe(2);
      expect(scoreRepoFilePriority('src/styles.scss')).toBe(3);
      expect(scoreRepoFilePriority('src/partials/footer.html')).toBe(4);
      expect(scoreRepoFilePriority('src/utils/math.ts')).toBe(5);
    });

    it('sorts discovered paths deterministically and enforces the maxFiles cap', () => {
      const input = [
        './src\\utils\\helper.ts',
        'src/styles.scss',
        'src/app/app.routes.ts',
        'src/app/app.component.html',
        'src/index.html'
      ];

      const result = sortAndCapDiscoveredPaths(input, 3);
      expect(result.selectedPaths).toEqual([
        'src/index.html',
        'src/app/app.component.html',
        'src/app/app.routes.ts'
      ]);
      expect(result.skippedCount).toBe(2);
    });
  });

  describe('isEligibleSourceFile()', () => {
    const sandboxRoot = path.resolve('/tmp/fresnel-test-sandbox');

    it('accepts regular UTF-8 files within size and directory bounds', () => {
      const res = isEligibleSourceFile({
        relPath: 'src/app/app.ts',
        resolvedBase: sandboxRoot,
        sizeBytes: 1024,
        isSymbolicLink: false,
        isFile: true,
        content: 'export const version = 1;'
      });
      expect(res).toEqual({ eligible: true, reason: null });
    });

    it('rejects symlinks, oversized files, binary NUL content, and path traversal', () => {
      expect(
        isEligibleSourceFile({
          relPath: 'src/link.ts',
          resolvedBase: sandboxRoot,
          sizeBytes: 120,
          isSymbolicLink: true,
          isFile: true,
          content: 'const x = 1;'
        })
      ).toEqual({ eligible: false, reason: 'not-regular-file' });

      expect(
        isEligibleSourceFile({
          relPath: 'src/huge.js',
          resolvedBase: sandboxRoot,
          sizeBytes: MAX_SCAN_FILE_BYTES + 1,
          isSymbolicLink: false,
          isFile: true,
          content: 'const x = 1;'
        })
      ).toEqual({ eligible: false, reason: 'exceeds-size-limit' });

      expect(
        isEligibleSourceFile({
          relPath: '../../etc/passwd',
          resolvedBase: sandboxRoot,
          sizeBytes: 120,
          isSymbolicLink: false,
          isFile: true,
          content: 'root:x:0:0'
        })
      ).toEqual({ eligible: false, reason: 'path-traversal' });

      expect(
        isEligibleSourceFile({
          relPath: 'assets/font.woff2',
          resolvedBase: sandboxRoot,
          sizeBytes: 120,
          isSymbolicLink: false,
          isFile: true,
          content: 'wOF2\u0000binary'
        })
      ).toEqual({ eligible: false, reason: 'binary-content' });
    });
  });

  describe('parseRepoUrl() & buildDemoSandboxFiles()', () => {
    it('extracts owner, repo, fullName, and demo metadata reliably', () => {
      const parsed = parseRepoUrl('https://github.com/vercel/next.js.git', 'live');
      expect(parsed.owner).toBe('vercel');
      expect(parsed.repo).toBe('next.js');
      expect(parsed.fullName).toBe('vercel/next.js');
      expect(parsed.isDemo).toBeFalse();

      const demo = parseRepoUrl('', 'demo');
      expect(demo.isDemo).toBeTrue();
      expect(demo.fullName).toBe('fresnel-sandbox/lumina-web-app');

      const files = buildDemoSandboxFiles(demo);
      expect(files.length).toBeGreaterThanOrEqual(7);
      expect(files.some((f) => f.relPath === 'src/index.html')).toBeTrue();
      expect(files.some((f) => f.relPath === 'src/styles.scss')).toBeTrue();
    });
  });

  describe('Root jscodeshift Transform: inject-icon-button-aria-label', () => {
    it('injects aria-label and type="button" on icon-only buttons while skipping labeled or text buttons', () => {
      const source = `
        export function Toolbar({ onDismiss, onSave }) {
          return (
            <div>
              <button className="dismiss-btn" onClick={onDismiss}>
                <svg viewBox="0 0 16 16"><path d="M4 4l8 8" /></svg>
              </button>
              <button type="button" aria-label="Already labeled" onClick={onSave}>
                <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" /></svg>
              </button>
              <button type="submit">Save changes</button>
            </div>
          );
        }
      `;

      const api = {
        jscodeshift: jscodeshift.withParser('tsx'),
        j: jscodeshift.withParser('tsx'),
        stats: () => {},
        report: () => {}
      };

      const metrics = [];
      const output = injectIconButtonAriaLabel(
        { path: 'Toolbar.tsx', source },
        api,
        { onMetrics: (m) => metrics.push(m) }
      );

      expect(output).not.toBeNull();
      expect(output).toContain('aria-label="Dismiss"');
      expect(output).toContain('type="button"');
      expect(metrics[0]).toEqual({ ariaLabelsInjected: 1, buttonTypesInjected: 1 });

      // Idempotent second pass returns null (no further edits needed)
      const secondPass = injectIconButtonAriaLabel({ path: 'Toolbar.tsx', source: output }, api);
      expect(secondPass).toBeNull();
    });

    it('infers accessible labels from Icon component tags when onClick is absent', () => {
      const j = jscodeshift.withParser('tsx');
      const root = j('<button><SearchIcon /></button>');
      const btn = root.find(j.JSXElement).at(0).get().node;
      expect(inferIconButtonLabel(btn)).toBe('Search');
    });
  });
});
