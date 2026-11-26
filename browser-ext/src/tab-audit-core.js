/**
 * Pure DOM audit scanner, `fresnel-audit-json/v1` payload builder, and deep-link validator.
 * Zero external dependencies — safe to run in browser MV3 popups and Node Vitest.
 */

/**
 * Executed inside the inspected active tab's DOM context.
 * Strictly self-contained (no outer closures) so `scripting.executeScript` serializes cleanly.
 */
export function inspectActiveTabDom() {
  const findings = [];
  const pageUrl = window.location.href;
  const hostname = window.location.hostname || 'local-tab';
  const pathname = window.location.pathname || '/';
  const tabFile = `tab${pathname === '/' ? '/index.html' : pathname}`;

  // 1. Accessibility (WCAG 2.1/2.2 checks)
  const imgsMissingAlt = Array.from(document.querySelectorAll('img')).filter(
    (img) => !img.hasAttribute('alt'),
  );
  if (imgsMissingAlt.length > 0) {
    findings.push({
      category: 'accessibility',
      ruleId: 'image-alt',
      title: `Add alt text to ${imgsMissingAlt.length} image(s) missing alt attributes`,
      summary: `Found ${imgsMissingAlt.length} <img> element(s) on ${pathname} without an alt attribute (WCAG 1.1.1).`,
      files: [tabFile],
    });
  }

  const unlabeledButtons = Array.from(document.querySelectorAll('button')).filter((btn) => {
    const label = (btn.getAttribute('aria-label') || '').trim();
    const labelledBy = (btn.getAttribute('aria-labelledby') || '').trim();
    const text = (btn.textContent || '').trim();
    return !label && !labelledBy && !text;
  });
  if (unlabeledButtons.length > 0) {
    findings.push({
      category: 'accessibility',
      ruleId: 'button-name',
      title: `Add accessible names to ${unlabeledButtons.length} icon-only button(s)`,
      summary: `Detected ${unlabeledButtons.length} <button> element(s) with no text or aria-label (WCAG 4.1.2).`,
      files: [tabFile],
    });
  }

  const unlabeledInputs = Array.from(
    document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea',
    ),
  ).filter((el) => {
    const id = el.getAttribute('id');
    const hasForLabel = id
      ? Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`))
      : false;
    const wrappedByLabel = Boolean(el.closest('label'));
    const hasAria = Boolean(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
    return !hasForLabel && !wrappedByLabel && !hasAria;
  });
  if (unlabeledInputs.length > 0) {
    findings.push({
      category: 'accessibility',
      ruleId: 'label',
      title: `Associate labels with ${unlabeledInputs.length} form control(s)`,
      summary: `Detected ${unlabeledInputs.length} input/select/textarea element(s) missing a programmatic label.`,
      files: [tabFile],
    });
  }

  if (!document.documentElement.getAttribute('lang')) {
    findings.push({
      category: 'accessibility',
      ruleId: 'html-has-lang',
      title: 'Add lang attribute to root <html> element',
      summary: 'The <html> element is missing a valid lang attribute (WCAG 3.1.1).',
      files: ['index.html'],
    });
  }

  if (!document.querySelector('main, [role="main"]')) {
    findings.push({
      category: 'accessibility',
      ruleId: 'landmark-one-main',
      title: 'Add a <main> landmark region for screen reader navigation',
      summary: 'Page lacks a primary <main> landmark element.',
      files: ['index.html'],
    });
  }

  // 2. Performance & Core Web Vitals telemetry
  const navEntry = performance.getEntriesByType('navigation')[0];
  const ttfbMs = navEntry ? Math.round(navEntry.responseStart - navEntry.requestStart) : null;
  const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
  const fcpMs = fcpEntry ? Math.round(fcpEntry.startTime) : null;

  const unsizedImages = Array.from(document.querySelectorAll('img')).filter(
    (img) => !img.getAttribute('width') || !img.getAttribute('height'),
  );
  if (unsizedImages.length > 0) {
    findings.push({
      category: 'performance',
      ruleId: 'unsized-images',
      title: `Add explicit width and height to ${unsizedImages.length} image(s) to prevent CLS`,
      summary: `${unsizedImages.length} image(s) lack explicit width/height attributes, risking Cumulative Layout Shift.`,
      files: [tabFile],
    });
  }

  const renderBlockingScripts = Array.from(document.querySelectorAll('head script[src]')).filter(
    (s) => !s.hasAttribute('defer') && !s.hasAttribute('async') && s.getAttribute('type') !== 'module',
  );
  if (renderBlockingScripts.length > 0) {
    findings.push({
      category: 'performance',
      ruleId: 'render-blocking-resources',
      title: `Defer ${renderBlockingScripts.length} render-blocking script(s) in <head>`,
      summary: `Found ${renderBlockingScripts.length} synchronous <script src> tag(s) blocking First Contentful Paint.`,
      files: ['index.html'],
    });
  }

  // 3. SEO & OpenGraph checks
  const metaDesc = document.querySelector('meta[name="description"]');
  if (!metaDesc || !(metaDesc.getAttribute('content') || '').trim()) {
    findings.push({
      category: 'seo',
      ruleId: 'meta-description',
      title: 'Add a descriptive <meta name="description"> tag',
      summary: 'Document is missing a non-empty meta description for search snippets.',
      files: ['index.html'],
    });
  }

  if (!document.querySelector('link[rel="canonical"]')) {
    findings.push({
      category: 'seo',
      ruleId: 'canonical',
      title: 'Add a <link rel="canonical"> URL tag',
      summary: 'Canonical link tag is absent from document <head>.',
      files: ['index.html'],
    });
  }

  const ogTitle = document.querySelector('meta[property="og:title"]');
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (!ogTitle || !ogDesc) {
    findings.push({
      category: 'seo',
      ruleId: 'open-graph-meta',
      title: 'Add OpenGraph og:title and og:description metadata',
      summary: 'Social sharing and AI citation previews benefit from explicit og:title and og:description tags.',
      files: ['index.html'],
    });
  }

  // 4. Security & Supply-Chain SRI checks
  const unsafeBlankLinks = Array.from(document.querySelectorAll('a[target="_blank"]')).filter(
    (a) => !(a.getAttribute('rel') || '').toLowerCase().includes('noopener'),
  );
  if (unsafeBlankLinks.length > 0) {
    findings.push({
      category: 'security',
      ruleId: 'external-anchors-use-rel-noopener',
      title: `Add rel="noopener noreferrer" to ${unsafeBlankLinks.length} target="_blank" link(s)`,
      summary: `Detected ${unsafeBlankLinks.length} external link(s) opening new tabs without noopener protection.`,
      files: [tabFile],
    });
  }

  const externalScriptsNoSri = Array.from(document.querySelectorAll('script[src]')).filter((s) => {
    try {
      const srcUrl = new URL(s.getAttribute('src') || '', pageUrl);
      return srcUrl.origin !== window.location.origin && !s.hasAttribute('integrity');
    } catch {
      return false;
    }
  });
  if (externalScriptsNoSri.length > 0) {
    findings.push({
      category: 'security',
      ruleId: 'script-subresource-integrity',
      title: `Add Subresource Integrity (integrity) to ${externalScriptsNoSri.length} third-party script(s)`,
      summary: `Found ${externalScriptsNoSri.length} cross-origin <script src> tag(s) without an SRI hash.`,
      files: ['index.html'],
    });
  }

  if (
    window.location.protocol !== 'https:' &&
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1'
  ) {
    findings.push({
      category: 'security',
      ruleId: 'is-on-https',
      title: 'Serve application over HTTPS instead of insecure HTTP',
      summary: `Page loaded over ${window.location.protocol} without TLS encryption.`,
      files: ['server.conf'],
    });
  }

  // 5. Passive CMS / Framework hints
  const techHints = [];
  const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
  if (
    /wordpress/i.test(generator) ||
    document.querySelector('link[href*="wp-content"], script[src*="wp-content"], link[href*="wp-includes"]')
  ) {
    techHints.push('WordPress');
  }
  if (document.getElementById('__NEXT_DATA__') || document.querySelector('script[src*="/_next/"]')) {
    techHints.push('Next.js');
  }
  if (document.querySelector('[data-reactroot], #root')) {
    techHints.push('React');
  }
  if (document.querySelector('[ng-version]')) {
    techHints.push('Angular');
  }
  if (
    typeof window.Shopify !== 'undefined' ||
    document.querySelector('link[href*="cdn.shopify.com"], script[src*="cdn.shopify.com"]')
  ) {
    techHints.push('Shopify');
  }

  const countByCat = (cat) => findings.filter((f) => f.category === cat).length;
  const perfBefore = Math.max(
    40,
    94 - countByCat('performance') * 12 - (ttfbMs && ttfbMs > 800 ? 10 : 0),
  );
  const a11yBefore = Math.max(40, 96 - countByCat('accessibility') * 10);
  const seoBefore = Math.max(50, 96 - countByCat('seo') * 12);
  const secBefore = Math.max(50, 96 - countByCat('security') * 12);
  const bpBefore = Math.max(60, 94 - Math.round(findings.length * 2));

  return {
    pageUrl,
    hostname,
    pathname,
    title: document.title || hostname,
    ttfbMs,
    fcpMs,
    techHints,
    scores: {
      performance: perfBefore,
      accessibility: a11yBefore,
      bestPractices: bpBefore,
      seo: seoBefore,
      security: secBefore,
    },
    findings,
  };
}

/**
 * Build a `fresnel-audit-json/v1` payload 100% compatible with Fresnel's `parseLocalAuditFile`.
 * @param {ReturnType<typeof inspectActiveTabDom>} scan
 * @param {{ browserFamily?: string }} [options]
 */
export function buildFresnelJsonPayload(scan, { browserFamily = 'chromium' } = {}) {
  const nowIso = new Date().toISOString();
  const branch = `browser-ext-${browserFamily}`;
  const repoFullName = `browser-ext/${scan.hostname}`;
  const commits = scan.findings.map((f, idx) => {
    const sha = `ext${String(idx + 1).padStart(2, '0')}b4`;
    return {
      id: `ext-${idx + 1}-${f.ruleId}`,
      sha,
      fullSha: `${sha}${'0'.repeat(40)}`.slice(0, 40),
      category: f.category,
      categoryLabel: f.category,
      ruleId: f.ruleId,
      title: f.title,
      commitMessage: `fix(${f.category}): ${f.title}`,
      summary: f.summary,
      files: f.files,
      additions: 3,
      deletions: 1,
      author: `Fresnel Browser Extension (${browserFamily}) <extension@fresnel.local>`,
      date: new Date().toUTCString(),
      body: f.summary,
      diff: [
        `diff --git a/${f.files[0]} b/${f.files[0]}`,
        `--- a/${f.files[0]}`,
        `+++ b/${f.files[0]}`,
        '@@ -1,1 +1,2 @@',
        ` <!-- Detected in live tab ${scan.pageUrl} -->`,
        `+<!-- ${f.title.replace(/-->/g, '--')} -->`,
      ].join('\n'),
    };
  });

  const techLabel =
    Array.isArray(scan.techHints) && scan.techHints.length > 0
      ? ` · Stack: ${scan.techHints.join(', ')}`
      : '';

  return {
    format: 'fresnel-audit-json/v1',
    savedAtIso: nowIso,
    record: {
      auditId: `ext_${Date.now().toString(36)}_lhr`,
      ownerId: 'local',
      repoFullName,
      repoUrl: scan.pageUrl,
      branch,
      runPhase: 'lhr',
      mode: 'live',
      totalCommitsCount: Math.max(1, commits.length),
      selectedCommitsCount: Math.max(1, commits.length),
      performanceBefore: scan.scores.performance,
      performanceAfter: Math.min(98, scan.scores.performance + 14),
      accessibilityBefore: scan.scores.accessibility,
      accessibilityAfter: Math.min(98, scan.scores.accessibility + 16),
      bestPracticesBefore: scan.scores.bestPractices,
      bestPracticesAfter: Math.min(98, scan.scores.bestPractices + 8),
      seoBefore: scan.scores.seo,
      seoAfter: Math.min(98, scan.scores.seo + 10),
      securityBefore: scan.scores.security,
      securityAfter: Math.min(98, scan.scores.security + 8),
      summaryNotes: `Browser Extension (${browserFamily}) live tab scan of ${scan.pageUrl} (TTFB: ${scan.ttfbMs ?? 'N/A'} ms, FCP: ${scan.fcpMs ?? 'N/A'} ms${techLabel}). Found ${commits.length} findings.`,
      commitTitles: commits.map((c) => c.title).slice(0, 25),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      storageSource: 'imported',
      savedFormat: 'json',
      snapshotSession: {
        id: `ext_${Date.now().toString(36)}`,
        interactionId: 'browser-ext-live-tab',
        engineType: 'browser-ext-mv3',
        liveLighthouseAvailable: false,
        filesScanned: 1,
        workspaceSource: branch,
        mode: 'live',
        runPhase: 'lhr',
        status: 'completed',
        progressPercent: 100,
        repo: {
          owner: 'browser-ext',
          repo: scan.hostname,
          fullName: repoFullName,
          url: scan.pageUrl,
          isDemo: false,
        },
        branch,
        categories: ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
        steps: [],
        totalSteps: 1,
        commits,
        totalCommits: commits.length,
        pr: null,
      },
    },
  };
}

/**
 * Validate and build a Fresnel deep-link URL for one-click handoff from the extension popup.
 * Rejects non-http(s) app origins and target URLs (`javascript:`, `chrome://`, `about:`, `file://`).
 * @param {{ appOrigin: string, routeMode?: 'standalone' | 'knowledgebase', targetUrl: string }} params
 * @returns {string}
 */
export function buildFresnelDeepLink({ appOrigin, routeMode = 'standalone', targetUrl }) {
  let parsedOrigin;
  try {
    parsedOrigin = new URL((appOrigin || '').trim());
  } catch {
    throw new Error('Enter a valid http:// or https:// Fresnel App URL.');
  }
  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
    throw new Error('Fresnel App URL must use http:// or https://.');
  }

  let parsedTarget;
  try {
    parsedTarget = new URL((targetUrl || '').trim());
  } catch {
    throw new Error('Open a standard http:// or https:// webpage to hand off to Fresnel.');
  }
  if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
    throw new Error('Only http:// and https:// tabs can be audited in Fresnel.');
  }

  const routePrefix = routeMode === 'knowledgebase' ? '/fresnel' : '';
  const dest = new URL(`${parsedOrigin.origin}${routePrefix}/audit/live`);
  dest.searchParams.set('targetUrl', parsedTarget.href);
  dest.searchParams.set('source', 'ext');
  return dest.toString();
}
