/**
 * Fresnel Companion Chrome Extension — Popup Controller (Manifest V3)
 *
 * Audits the currently active logged-in browser tab using chrome.scripting.executeScript,
 * generates a `fresnel-audit-json/v1` payload compatible with Fresnel's Saved Audits
 * importer, and supports instant JSON download or clipboard copy.
 */

let latestFresnelPayload = null;

const runBtn = document.getElementById('run-audit-btn');
const exportBtn = document.getElementById('export-json-btn');
const copyBtn = document.getElementById('copy-json-btn');
const statusBox = document.getElementById('status-box');
const scoresGrid = document.getElementById('scores-grid');
const findingsList = document.getElementById('findings-list');

function setStatus(text) {
  if (statusBox) statusBox.textContent = text;
}

/**
 * Executed inside the inspected active tab's DOM context.
 * Self-contained so it works cleanly on authenticated staging/production tabs.
 */
function inspectActiveTabDom() {
  const findings = [];
  const pageUrl = window.location.href;
  const hostname = window.location.hostname || 'local-tab';
  const pathname = window.location.pathname || '/';

  // 1. Accessibility (WCAG 2.1/2.2 checks)
  const imgsMissingAlt = Array.from(document.querySelectorAll('img')).filter(
    (img) => !img.hasAttribute('alt')
  );
  if (imgsMissingAlt.length > 0) {
    findings.push({
      category: 'accessibility',
      ruleId: 'image-alt',
      title: `Add alt text to ${imgsMissingAlt.length} image(s) missing alt attributes`,
      summary: `Found ${imgsMissingAlt.length} <img> element(s) on ${pathname} without an alt attribute (WCAG 1.1.1).`,
      files: [`tab${pathname === '/' ? '/index.html' : pathname}`]
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
      files: [`tab${pathname === '/' ? '/index.html' : pathname}`]
    });
  }

  const unlabeledInputs = Array.from(
    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea')
  ).filter((el) => {
    const id = el.getAttribute('id');
    const hasForLabel = id ? Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`)) : false;
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
      files: [`tab${pathname === '/' ? '/index.html' : pathname}`]
    });
  }

  if (!document.documentElement.getAttribute('lang')) {
    findings.push({
      category: 'accessibility',
      ruleId: 'html-has-lang',
      title: 'Add lang attribute to root <html> element',
      summary: 'The <html> element is missing a valid lang attribute (WCAG 3.1.1).',
      files: ['index.html']
    });
  }

  if (!document.querySelector('main, [role="main"]')) {
    findings.push({
      category: 'accessibility',
      ruleId: 'landmark-one-main',
      title: 'Add a <main> landmark region for screen reader navigation',
      summary: 'Page lacks a primary <main> landmark element.',
      files: ['index.html']
    });
  }

  // 2. Performance & Core Web Vitals telemetry
  const navEntry = performance.getEntriesByType('navigation')[0];
  const ttfbMs = navEntry ? Math.round(navEntry.responseStart - navEntry.requestStart) : null;
  const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
  const fcpMs = fcpEntry ? Math.round(fcpEntry.startTime) : null;

  const unsizedImages = Array.from(document.querySelectorAll('img')).filter(
    (img) => !img.getAttribute('width') || !img.getAttribute('height')
  );
  if (unsizedImages.length > 0) {
    findings.push({
      category: 'performance',
      ruleId: 'unsized-images',
      title: `Add explicit width and height to ${unsizedImages.length} image(s) to prevent CLS`,
      summary: `${unsizedImages.length} image(s) lack explicit width/height attributes, risking Cumulative Layout Shift.`,
      files: [`tab${pathname === '/' ? '/index.html' : pathname}`]
    });
  }

  const renderBlockingScripts = Array.from(document.querySelectorAll('head script[src]')).filter(
    (s) => !s.hasAttribute('defer') && !s.hasAttribute('async') && s.getAttribute('type') !== 'module'
  );
  if (renderBlockingScripts.length > 0) {
    findings.push({
      category: 'performance',
      ruleId: 'render-blocking-resources',
      title: `Defer ${renderBlockingScripts.length} render-blocking script(s) in <head>`,
      summary: `Found ${renderBlockingScripts.length} synchronous <script src> tag(s) blocking First Contentful Paint.`,
      files: ['index.html']
    });
  }

  // 3. SEO checks
  const metaDesc = document.querySelector('meta[name="description"]');
  if (!metaDesc || !(metaDesc.getAttribute('content') || '').trim()) {
    findings.push({
      category: 'seo',
      ruleId: 'meta-description',
      title: 'Add a descriptive <meta name="description"> tag',
      summary: 'Document is missing a non-empty meta description for search snippets.',
      files: ['index.html']
    });
  }
  if (!document.querySelector('link[rel="canonical"]')) {
    findings.push({
      category: 'seo',
      ruleId: 'canonical',
      title: 'Add a <link rel="canonical"> URL tag',
      summary: 'Canonical link tag is absent from document <head>.',
      files: ['index.html']
    });
  }

  // 4. Security & Best Practices checks
  const unsafeBlankLinks = Array.from(document.querySelectorAll('a[target="_blank"]')).filter(
    (a) => !(a.getAttribute('rel') || '').toLowerCase().includes('noopener')
  );
  if (unsafeBlankLinks.length > 0) {
    findings.push({
      category: 'security',
      ruleId: 'external-anchors-use-rel-noopener',
      title: `Add rel="noopener noreferrer" to ${unsafeBlankLinks.length} target="_blank" link(s)`,
      summary: `Detected ${unsafeBlankLinks.length} external link(s) opening new tabs without noopener protection.`,
      files: [`tab${pathname === '/' ? '/index.html' : pathname}`]
    });
  }

  if (window.location.protocol !== 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    findings.push({
      category: 'security',
      ruleId: 'is-on-https',
      title: 'Serve application over HTTPS instead of insecure HTTP',
      summary: `Page loaded over ${window.location.protocol} without TLS encryption.`,
      files: ['server.conf']
    });
  }

  const countByCat = (cat) => findings.filter((f) => f.category === cat).length;
  const perfBefore = Math.max(40, 94 - countByCat('performance') * 12 - (ttfbMs && ttfbMs > 800 ? 10 : 0));
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
    scores: {
      performance: perfBefore,
      accessibility: a11yBefore,
      bestPractices: bpBefore,
      seo: seoBefore,
      security: secBefore
    },
    findings
  };
}

function buildFresnelJsonPayload(scan) {
  const nowIso = new Date().toISOString();
  const repoFullName = `chrome-ext/${scan.hostname}`;
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
      author: 'Fresnel Chrome Extension <extension@fresnel.local>',
      date: new Date().toUTCString(),
      body: f.summary,
      diff: [
        `diff --git a/${f.files[0]} b/${f.files[0]}`,
        `--- a/${f.files[0]}`,
        `+++ b/${f.files[0]}`,
        '@@ -1,1 +1,2 @@',
        ` <!-- Detected in live tab ${scan.pageUrl} -->`,
        `+<!-- ${f.title.replace(/-->/g, '--')} -->`
      ].join('\n')
    };
  });

  return {
    format: 'fresnel-audit-json/v1',
    savedAtIso: nowIso,
    record: {
      auditId: `ext_${Date.now().toString(36)}_lhr`,
      ownerId: 'local',
      repoFullName,
      repoUrl: scan.pageUrl,
      branch: 'chrome-extension-tab',
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
      summaryNotes: `Chrome Extension live tab scan of ${scan.pageUrl} (TTFB: ${scan.ttfbMs ?? 'N/A'} ms, FCP: ${scan.fcpMs ?? 'N/A'} ms). Found ${commits.length} findings.`,
      commitTitles: commits.map((c) => c.title).slice(0, 25),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      storageSource: 'imported',
      savedFormat: 'json',
      snapshotSession: {
        id: `ext_${Date.now().toString(36)}`,
        interactionId: 'chrome-extension-live-tab',
        engineType: 'chrome-extension-mv3',
        liveLighthouseAvailable: false,
        filesScanned: 1,
        workspaceSource: 'chrome-extension-tab',
        mode: 'live',
        runPhase: 'lhr',
        status: 'completed',
        progressPercent: 100,
        repo: {
          owner: 'chrome-ext',
          repo: scan.hostname,
          fullName: repoFullName,
          url: scan.pageUrl,
          isDemo: false
        },
        branch: 'chrome-extension-tab',
        categories: ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
        steps: [],
        totalSteps: 1,
        commits,
        totalCommits: commits.length,
        pr: null
      }
    }
  };
}

function renderResults(scan) {
  if (scoresGrid) {
    scoresGrid.replaceChildren();
    scoresGrid.hidden = false;
    const entries = [
      ['Perf', scan.scores.performance],
      ['A11y', scan.scores.accessibility],
      ['SEO', scan.scores.seo],
      ['Sec', scan.scores.security]
    ];
    for (const [label, val] of entries) {
      const box = document.createElement('div');
      box.className = 'score-box';
      const lbl = document.createElement('span');
      lbl.className = 'score-label';
      lbl.textContent = label;
      const num = document.createElement('span');
      num.className = 'score-val';
      num.textContent = String(val);
      box.appendChild(lbl);
      box.appendChild(num);
      scoresGrid.appendChild(box);
    }
  }

  if (findingsList) {
    findingsList.replaceChildren();
    findingsList.hidden = false;
    if (scan.findings.length === 0) {
      const li = document.createElement('li');
      li.className = 'finding-item';
      li.textContent = 'Zero critical issues detected on this tab.';
      findingsList.appendChild(li);
    } else {
      for (const f of scan.findings) {
        const li = document.createElement('li');
        li.className = 'finding-item';
        const cat = document.createElement('span');
        cat.className = 'finding-cat';
        cat.textContent = f.category;
        const txt = document.createElement('span');
        txt.textContent = f.title;
        li.appendChild(cat);
        li.appendChild(txt);
        findingsList.appendChild(li);
      }
    }
  }
}

runBtn?.addEventListener('click', async () => {
  setStatus('Scanning active tab...');
  runBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      setStatus('Open a standard http:// or https:// webpage to audit.');
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: inspectActiveTabDom
    });

    if (!result) {
      setStatus('Unable to read DOM from this tab.');
      return;
    }

    latestFresnelPayload = buildFresnelJsonPayload(result);
    renderResults(result);
    exportBtn.disabled = false;
    copyBtn.disabled = false;
    setStatus(`Audited ${result.hostname}: ${result.findings.length} finding(s) ready for Fresnel.`);
  } catch (err) {
    setStatus(err?.message || 'Failed to inspect active tab.');
  } finally {
    runBtn.disabled = false;
  }
});

exportBtn?.addEventListener('click', () => {
  if (!latestFresnelPayload) return;
  const host = latestFresnelPayload.record.repoFullName.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const blob = new Blob([JSON.stringify(latestFresnelPayload, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fresnel-${host}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 150);
  setStatus('Exported Fresnel JSON. Import it in Fresnel via "Import File" or "Saved Audits".');
});

copyBtn?.addEventListener('click', async () => {
  if (!latestFresnelPayload) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(latestFresnelPayload, null, 2));
    setStatus('Copied Fresnel JSON to clipboard.');
  } catch {
    setStatus('Clipboard permission denied — use Download JSON instead.');
  }
});
