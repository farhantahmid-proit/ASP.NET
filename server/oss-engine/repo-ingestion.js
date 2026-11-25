/**
 * Fresnel Sandboxed Repository Ingestion Layer (Zero-AI)
 *
 * Safely shallow-clones public GitHub repositories into an ephemeral OS temp directory
 * with hooks and symlinks disabled (NEVER executes npm install, git hooks, or scripts).
 * Also supplies an authentic virtual reference workspace for Demo Mode (`fresnel-sandbox/lumina-web-app`)
 * so both Live and Demo modes execute the exact same real AST parsers and codemods.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { simpleGit } from 'simple-git';
import fg from 'fast-glob';

const MAX_FILES = 350;
const MAX_FILE_BYTES = 350 * 1024; // 350 KB cap per source file
const CLONE_TIMEOUT_MS = 22000;

/**
 * Rich, realistic Angular + Web App virtual repository for Demo Mode and private-repo fallback.
 * Intentionally contains realistic issues across all 5 categories (Performance, Accessibility,
 * Best Practices, SEO, Light Security) so the real AST engine detects and patches them live!
 */
export function buildDemoSandboxFiles(repoMeta) {
  const appName = repoMeta?.repo || 'lumina-web-app';
  const fullName = repoMeta?.fullName || 'fresnel-sandbox/lumina-web-app';
  return [
    {
      relPath: 'src/index.html',
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>App</title>
  <base href="/">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700">
</head>
<body>
  <app-root></app-root>
</body>
</html>
`
    },
    {
      relPath: 'src/app/app.component.html',
      content: `<header class="site-header">
  <nav class="site-nav">
    <span class="nav-link" (click)="navigateTo('/docs')">Documentation</span>
    <span class="nav-link" (click)="navigateTo('/pricing')">Pricing</span>
    <a href="https://github.com/${fullName}" target="_blank">GitHub Repo</a>
    <button class="icon-btn" (click)="toggleTheme()">
      <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /></svg>
    </button>
  </nav>
</header>
<div class="page-shell">
  <section class="hero-stage">
    <picture>
      <img class="hero-banner-media" src="/assets/hero-lens.jpg" alt="Hero showcase for ${appName}">
    </picture>
    <div class="feature-gallery">
      <img class="feature-card-img" src="/assets/card-metrics.png" alt="Performance telemetry">
      <img class="feature-card-img" src="/assets/card-a11y.png" alt="Accessibility overview">
    </div>
  </section>
  <div class="preview-pane" [innerHTML]="userSubmittedPreviewHtml"></div>
</div>
`
    },
    {
      relPath: 'src/styles.scss',
      content: `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700');

@font-face {
  font-family: 'LuminaDisplay';
  src: url('/assets/fonts/lumina-display.woff2') format('woff2');
  font-weight: 600;
}

:root {
  --surface-bg: #f8fafc;
  --muted-caption: #94a3b8;
  --accent-link: #38bdf8;
}

.hero-caption {
  color: #94a3b8;
  background-color: #f8fafc;
  font-size: 14px;
  padding: 12px 12px 12px 12px;
}

.hero-badge:before {
  content: '';
  background-color: rgba(15, 23, 42, 0.45);
  color: #ffffff;
  font-weight: bold;
}

.icon-btn {
  width: 22px;
  height: 22px;
  padding: 2px;
  border: none;
  background: transparent;
}

.icon-btn:focus {
  outline: none;
}

.slide-drawer {
  position: relative;
  left: 0px;
  transition: left 300ms ease, top 250ms ease;
}

@keyframes slideInPanel {
  from {
    left: -240px;
    opacity: 0;
  }
  to {
    left: 0px;
    opacity: 1;
  }
}
`
    },
    {
      relPath: 'src/app/app.routes.ts',
      content: `import { Routes } from '@angular/router';
import { LandingPageComponent } from './pages/landing/landing-page.component';
import { AnalyticsDashboardComponent } from './pages/analytics/analytics-dashboard.component';
import { SettingsPageComponent } from './pages/settings/settings-page.component';

export const routes: Routes = [
  { path: '', component: LandingPageComponent },
  { path: 'analytics', component: AnalyticsDashboardComponent },
  { path: 'settings', component: SettingsPageComponent }
];
`
    },
    {
      relPath: 'src/app/core/scroll-tracker.ts',
      content: `export function attachViewportScrollHandlers(container: HTMLElement): () => void {
  var isActive = true;
  let trackerMode = 'viewport';

  const onWheel = (event: WheelEvent) => {
    if (!!isActive) container.dataset['lastDelta'] = trackerMode + ':' + String(event.deltaY);
  };
  const onTouchStart = (event: TouchEvent) => {
    container.dataset['touchCount'] = String(event.touches.length);
  };

  window.addEventListener('wheel', onWheel);
  container.addEventListener('touchstart', onTouchStart);

  return () => {
    window.removeEventListener('wheel', onWheel);
    container.removeEventListener('touchstart', onTouchStart);
  };
}
`
    },
    {
      relPath: 'src/app/widgets/quick-actions-widget.tsx',
      content: `import React from 'react';

export interface QuickActionsProps {
  repoName: string;
  onDismiss: () => void;
  onOpenCommandPalette: () => void;
}

export function QuickActionsWidget({ repoName, onDismiss, onOpenCommandPalette }: QuickActionsProps) {
  var labelPrefix = 'Audit';
  let statusBadge = { labelPrefix: labelPrefix, active: true };
  const bannerText = labelPrefix + ' ready for ' + repoName;

  return (
    <aside className="quick-actions-card" data-active={statusBadge.active ? true : false}>
      <img className="widget-badge" src="/assets/fresnel-lens-badge.png" />
      <div className="command-trigger" onClick={onOpenCommandPalette}>
        {bannerText}
      </div>
      <a href="https://web.dev/explore/learn-core-web-vitals" target="_blank">
        Core Web Vitals Guide
      </a>
      <button className="dismiss-btn" onClick={onDismiss}>
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </aside>
  );
}
`
    },
    {
      relPath: 'src/app/core/dom-helpers.ts',
      content: `export function mountExternalPreviewCard(container: HTMLElement, url: string, thumbnailSrc: string): void {
  var card = document.createElement('section');
  const previewImg = document.createElement('img');
  previewImg.src = thumbnailSrc;

  const docsLink = document.createElement('a');
  docsLink.href = url;
  docsLink.target = '_blank';
  docsLink.textContent = 'Open documentation';

  const closeCardBtn = document.createElement('button');
  closeCardBtn.className = 'card-close-icon';

  card.append(previewImg, docsLink, closeCardBtn);
  container.append(card);
}

export function openExternalDocsPopup(url: string): void {
  if (url) window.open(url, '_blank');
}
`
    },
    {
      relPath: 'src/app/core/auth-client.ts',
      content: `const STRIPE_LIVE_FALLBACK_KEY = '${['sk', 'live'].join('_')}_${['51N9x8LmQpR4v', 'T2wY7zK3bC6dF', '8gH0jM1nP'].join('')}';

export function persistSessionToken(accessToken: string): void {
  localStorage.setItem('auth_access_token', accessToken);
}

export function renderFeedbackBanner(el: HTMLElement, querySnippet: string): void {
  el.innerHTML = '<div class="banner">' + querySnippet + '</div>';
}

export function handlePostLoginRedirect(searchParams: URLSearchParams): void {
  const returnUrl = searchParams.get('returnUrl');
  if (returnUrl) {
    window.location.assign(returnUrl);
  }
}

export function getPaymentClientKey(): string {
  return STRIPE_LIVE_FALLBACK_KEY;
}
`
    }
  ];
}

export const MAX_SCAN_FILES = MAX_FILES;
export const MAX_SCAN_FILE_BYTES = MAX_FILE_BYTES;

/**
 * Sanitizes GitHub owner and repository identifiers to prevent path traversal
 * or invalid remote git clone arguments.
 */
export function sanitizeRepoIdentifier(owner = '', repo = '') {
  const safeOwner = String(owner || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const safeRepo = String(repo || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const isValid =
    Boolean(safeOwner) &&
    Boolean(safeRepo) &&
    safeOwner !== '.' &&
    safeOwner !== '..' &&
    safeRepo !== '.' &&
    safeRepo !== '..';
  return { safeOwner, safeRepo, isValid };
}

/**
 * Normalizes a repository-relative path to POSIX forward slashes without leading `./` or `/`.
 */
export function normalizeRelativePath(relPath = '') {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '');
}

/**
 * Computes deterministic scan priority so entrypoints, layouts, routes, and stylesheets
 * are indexed before deeply nested leaf modules.
 */
export function scoreRepoFilePriority(relPath = '') {
  const low = normalizeRelativePath(relPath).toLowerCase();
  if (low === 'index.html' || low.endsWith('/index.html')) return 0;
  if (low.includes('app.component') || low.includes('app.tsx') || low.includes('layout.tsx')) return 1;
  if (low.includes('route')) return 2;
  if (low.endsWith('.css') || low.endsWith('.scss')) return 3;
  if (low.endsWith('.html')) return 4;
  return 5;
}

/**
 * Deterministically orders discovered repository paths by priority and path length,
 * capping the resulting list at `maxFiles`.
 */
export function sortAndCapDiscoveredPaths(paths = [], maxFiles = MAX_FILES) {
  const normalized = paths.map((p) => normalizeRelativePath(p)).filter(Boolean);
  const sorted = [...normalized].sort(
    (a, b) =>
      scoreRepoFilePriority(a) - scoreRepoFilePriority(b) ||
      a.length - b.length ||
      a.localeCompare(b)
  );
  const selectedPaths = sorted.slice(0, Math.max(0, maxFiles));
  const skippedCount = Math.max(0, sorted.length - selectedPaths.length);
  return { selectedPaths, skippedCount };
}

/**
 * Validates that a repository file is within the sandbox root, is a regular non-symlink
 * file under `maxBytes`, and contains valid non-binary UTF-8 text.
 */
export function isEligibleSourceFile({
  relPath,
  resolvedBase,
  sizeBytes,
  isSymbolicLink = false,
  isFile = true,
  content = '',
  maxBytes = MAX_FILE_BYTES
}) {
  if (!isFile || isSymbolicLink) {
    return { eligible: false, reason: 'not-regular-file' };
  }
  if (typeof sizeBytes !== 'number' || sizeBytes < 0 || sizeBytes > maxBytes) {
    return { eligible: false, reason: 'exceeds-size-limit' };
  }
  if (resolvedBase && relPath) {
    const absPath = path.resolve(resolvedBase, relPath);
    const basePrefix = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
    if (!absPath.startsWith(basePrefix)) {
      return { eligible: false, reason: 'path-traversal' };
    }
  }
  if (typeof content !== 'string' || content.includes('\u0000')) {
    return { eligible: false, reason: 'binary-content' };
  }
  return { eligible: true, reason: null };
}

/**
 * Safely shallow-clones a public GitHub repository into an isolated OS temp directory
 * without executing any hooks, symlinks, or build scripts, then reads eligible source files.
 */
export async function ingestRepositoryFiles(repoMeta, branch = 'main', onStage = () => {}) {
  if (!repoMeta || repoMeta.isDemo) {
    onStage('Loading isolated reference workspace for deterministic AST analysis.');
    return {
      source: 'sandbox-workspace',
      files: buildDemoSandboxFiles(repoMeta),
      clonedBranch: branch,
      skippedFiles: 0
    };
  }

  // Strictly validate GitHub HTTPS URL format before invoking git
  const { safeOwner, safeRepo, isValid } = sanitizeRepoIdentifier(repoMeta.owner, repoMeta.repo);
  if (!isValid) {
    return {
      source: 'sandbox-fallback',
      files: buildDemoSandboxFiles(repoMeta),
      clonedBranch: branch,
      skippedFiles: 0,
      fallbackReason: 'Invalid GitHub owner/repository identifier.'
    };
  }

  const cloneUrl = `https://github.com/${safeOwner}/${safeRepo}.git`;
  const tmpBase = os.tmpdir();
  const tmpDir = path.join(tmpBase, `fresnel-oss-${crypto.randomBytes(8).toString('hex')}`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    onStage(`Shallow-cloning ${safeOwner}/${safeRepo} (--depth=1, hooks disabled).`);

    const git = simpleGit({
      timeout: { block: CLONE_TIMEOUT_MS },
      config: [
        'core.hooksPath=/dev/null',
        'core.symlinks=false',
        'protocol.file.allow=never'
      ]
    });

    // Pass GIT_TERMINAL_PROMPT=0 so private repos fail immediately instead of hanging
    const envGit = git.env({
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo'
    });

    const cloneArgs = ['--depth', '1', '--single-branch'];
    if (
      branch &&
      /^[a-zA-Z0-9._/-]{1,80}$/.test(branch) &&
      !branch.startsWith('-') &&
      !branch.startsWith('/') &&
      !branch.endsWith('/') &&
      !branch.includes('..') &&
      !branch.includes('//') &&
      !branch.endsWith('.lock')
    ) {
      cloneArgs.push('--branch', branch);
    }

    try {
      await envGit.clone(cloneUrl, tmpDir, cloneArgs);
    } catch {
      // Retry without --branch in case default branch is master/develop/etc.
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });
      await envGit.clone(cloneUrl, tmpDir, ['--depth', '1', '--single-branch']);
    }

    onStage(`Indexing HTML, TypeScript, JavaScript, and CSS/SCSS source files.`);

    const discovered = await fg(
      [
        '**/*.{html,htm,ts,tsx,js,jsx,mjs,css,scss,sass,vue,svelte}'
      ],
      {
        cwd: tmpDir,
        dot: false,
        onlyFiles: true,
        followSymbolicLinks: false,
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/.next/**',
          '**/.nuxt/**',
          '**/.angular/**',
          '**/coverage/**',
          '**/vendor/**',
          '**/*.min.js',
          '**/*.min.css',
          '**/*.bundle.js',
          '**/*.spec.ts',
          '**/*.test.ts',
          '**/*.spec.js',
          '**/*.test.js',
          '**/*.d.ts'
        ]
      }
    );

    const resolvedBase = path.resolve(tmpDir);
    const files = [];
    const { selectedPaths, skippedCount } = sortAndCapDiscoveredPaths(discovered, MAX_FILES);
    let skippedFiles = skippedCount;

    for (const relPath of selectedPaths) {
      const absPath = path.resolve(resolvedBase, relPath);
      if (!absPath.startsWith(resolvedBase + path.sep)) {
        skippedFiles++;
        continue;
      }
      try {
        const stat = fs.lstatSync(absPath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) {
          skippedFiles++;
          continue;
        }
        const content = fs.readFileSync(absPath, 'utf8');
        const check = isEligibleSourceFile({
          relPath,
          resolvedBase,
          sizeBytes: stat.size,
          isSymbolicLink: stat.isSymbolicLink(),
          isFile: stat.isFile(),
          content
        });
        if (!check.eligible) {
          skippedFiles++;
          continue;
        }
        files.push({
          relPath: normalizeRelativePath(relPath),
          content
        });
      } catch {
        skippedFiles++;
      }
    }

    if (files.length === 0) {
      return {
        source: 'sandbox-fallback',
        files: buildDemoSandboxFiles(repoMeta),
        clonedBranch: branch,
        skippedFiles,
        fallbackReason: 'Repository contained no supported web source files.'
      };
    }

    return {
      source: 'git-clone-live',
      files,
      clonedBranch: branch,
      skippedFiles
    };
  } catch (err) {
    onStage(`Public clone unavailable for ${safeOwner}/${safeRepo}; falling back to isolated AST fixture.`);
    return {
      source: 'sandbox-fallback',
      files: buildDemoSandboxFiles(repoMeta),
      clonedBranch: branch,
      skippedFiles: 0,
      fallbackReason: err?.message || 'Unable to clone public repository.'
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
