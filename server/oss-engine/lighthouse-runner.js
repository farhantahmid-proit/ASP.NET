/**
 * Fresnel Optional Live Lighthouse Runner & Deterministic LHR-to-AST Correlator (Zero-AI)
 *
 * 1. Auto-detects headless Chromium availability at runtime so container hosts without
 *    a Chrome binary degrade gracefully to LHR JSON upload.
 * 2. Enforces strict SSRF validation (public HTTP/HTTPS only; resolves DNS and blocks
 *    loopback, RFC-1918 private networks, link-local & cloud metadata IPs).
 * 3. Runs real open-source `lighthouse` via `chrome-launcher` on demand.
 * 4. Deterministically correlates any uploaded or live LHR JSON report's failing audits,
 *    metricSavings, and DOM selectors (`lhrTargetSelector`) to exact repository AST fixes.
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';
import * as cheerio from 'cheerio';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { runAllStaticAstRules, computeDeterministicScores } from './ast-rules.js';

let cachedChromiumInfo = null;

/**
 * Checks whether a local Chrome/Chromium binary is available on the host.
 */
export function detectChromiumAvailability() {
  if (cachedChromiumInfo !== null) return cachedChromiumInfo;
  try {
    const installations = chromeLauncher.Launcher.getInstallations();
    const candidates = [
      process.env.CHROME_PATH,
      ...(Array.isArray(installations) ? installations : []),
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable'
    ].filter(Boolean);

    const found = candidates.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

    cachedChromiumInfo = {
      available: Boolean(found),
      chromiumPath: found || null
    };
  } catch {
    cachedChromiumInfo = { available: false, chromiumPath: null };
  }
  return cachedChromiumInfo;
}

function isPrivateOrReservedIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8
    if (a === 169 && b === 254) return true; // Link-local & AWS/GCP metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (norm === '::1' || norm === '::') return true;
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // Unique local
    if (norm.startsWith('fe8') || norm.startsWith('fe9') || norm.startsWith('fea') || norm.startsWith('feb')) return true; // Link-local
    if (norm.startsWith('::ffff:')) {
      return isPrivateOrReservedIp(norm.replace('::ffff:', ''));
    }
    return false;
  }
  return true;
}

/**
 * Validates that a user-supplied URL for Live Lighthouse execution is strictly a public
 * HTTP/HTTPS URL and resolves only to non-private, non-loopback, non-metadata IPs.
 */
export async function validatePublicTargetUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('Please provide a valid public https:// URL for live Lighthouse auditing.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http:// and https:// URLs are permitted for live Lighthouse audits.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Localhost and internal network addresses cannot be audited via live Lighthouse.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Private or loopback IP addresses are blocked for live Lighthouse audits.');
    }
    return parsed.toString();
  }

  const records = await dns.lookup(host, { all: true });
  if (!records || records.length === 0) {
    throw new Error(`Could not resolve hostname ${host}.`);
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error(`Resolved address for ${host} is in a restricted private/metadata network range.`);
    }
  }

  return parsed.toString();
}

/**
 * Executes an authentic open-source headless Lighthouse run against a validated public URL.
 */
export async function runLiveLighthouseAudit(rawTargetUrl) {
  const chromeInfo = detectChromiumAvailability();
  if (!chromeInfo.available) {
    throw new Error(
      'Headless Chromium is not installed in this container host. Please upload or paste a Lighthouse LHR .json report instead.'
    );
  }

  const safeUrl = await validatePublicTargetUrl(rawTargetUrl);
  let chrome = null;

  try {
    chrome = await chromeLauncher.launch({
      chromePath: chromeInfo.chromiumPath,
      chromeFlags: [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions'
      ]
    });

    const runnerResult = await lighthouse(safeUrl, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      maxWaitForLoad: 25000
    });

    if (!runnerResult?.lhr) {
      throw new Error('Lighthouse completed without producing an LHR payload.');
    }

    return runnerResult.lhr;
  } finally {
    if (chrome) {
      try {
        await chrome.kill();
      } catch {
        // ignore kill error
      }
    }
  }
}

/**
 * Maps Lighthouse audit IDs to Fresnel's deterministic AST rule IDs and categories.
 */
const LHR_AUDIT_TO_FRESNEL_RULE = {
  'largest-contentful-paint': { category: 'performance', ruleId: 'largest-contentful-paint' },
  'largest-contentful-paint-element': { category: 'performance', ruleId: 'largest-contentful-paint' },
  'lcp-lazy-loaded': { category: 'performance', ruleId: 'largest-contentful-paint' },
  'prioritize-lcp-image': { category: 'performance', ruleId: 'largest-contentful-paint' },
  'unsized-images': { category: 'performance', ruleId: 'largest-contentful-paint' },
  'offscreen-images': { category: 'performance', ruleId: 'largest-contentful-paint' },
  'render-blocking-resources': { category: 'performance', ruleId: 'uses-rel-preconnect' },
  'uses-rel-preconnect': { category: 'performance', ruleId: 'uses-rel-preconnect' },
  'font-display': { category: 'performance', ruleId: 'uses-rel-preconnect' },
  'non-composited-animations': { category: 'performance', ruleId: 'non-composited-animations' },
  'unused-javascript': { category: 'performance', ruleId: 'route-code-splitting' },
  'bootup-time': { category: 'performance', ruleId: 'route-code-splitting' },
  bypass: { category: 'accessibility', ruleId: 'bypass' },
  'document-title': { category: 'accessibility', ruleId: 'document-title' },
  'color-contrast': { category: 'accessibility', ruleId: 'target-size' },
  'button-name': { category: 'accessibility', ruleId: 'target-size' },
  'target-size': { category: 'accessibility', ruleId: 'target-size' },
  'csp-xss': { category: 'best-practices', ruleId: 'csp-xss' },
  'external-anchors-use-rel-noopener': { category: 'best-practices', ruleId: 'external-anchors-use-rel-noopener' },
  'uses-passive-event-listeners': { category: 'best-practices', ruleId: 'uses-passive-event-listeners' },
  'meta-description': { category: 'seo', ruleId: 'meta-description' },
  viewport: { category: 'seo', ruleId: 'meta-description' },
  canonical: { category: 'seo', ruleId: 'canonical' },
  'structured-data': { category: 'seo', ruleId: 'canonical' },
  'crawlable-anchors': { category: 'seo', ruleId: 'crawlable-anchors' }
};

/**
 * Uses cheerio to locate which repository template file contains a DOM element matching
 * the Lighthouse `node.selector` or `node.snippet`.
 */
function locateSelectorInWorkspace(files, selector = '', snippet = '') {
  const htmlFiles = files.filter((f) => /\.(html|htm)$/i.test(f.relPath));
  if (!selector && !snippet) return null;

  // Clean Angular/pseudo selectors for cheerio
  const simplifiedSelector = String(selector || '')
    .replace(/:nth-child\([^)]+\)/g, '')
    .replace(/::?[a-z-]+(\([^)]*\))?/g, '')
    .trim();

  for (const file of htmlFiles) {
    try {
      const $ = cheerio.load(file.content);
      if (simplifiedSelector) {
        const matched = $(simplifiedSelector);
        if (matched.length > 0) {
          return { relPath: file.relPath, matchedBy: 'css-selector' };
        }
        // Try last segment of selector (e.g. `img.hero-banner-media`)
        const lastPart = simplifiedSelector.split(/[>\s]+/).filter(Boolean).pop();
        if (lastPart && $(lastPart).length > 0) {
          return { relPath: file.relPath, matchedBy: 'leaf-selector' };
        }
      }
      if (snippet) {
        const classMatch = snippet.match(/class=["']([^"']+)["']/i);
        if (classMatch && file.content.includes(classMatch[1])) {
          return { relPath: file.relPath, matchedBy: 'snippet-class' };
        }
      }
    } catch {
      // ignore selector syntax errors
    }
  }
  return null;
}

/**
 * Parses an LHR JSON payload (string or object) and deterministically correlates its
 * failing audits, metricSavings, and DOM selectors against the repository workspace.
 * Excludes 'security' per Lighthouse specification (4 official Lighthouse categories).
 */
export function correlateLhrWithWorkspace(repoMeta, rawLhrInput, workspaceFiles) {
  let lhr = null;
  if (typeof rawLhrInput === 'string' && rawLhrInput.trim()) {
    try {
      lhr = JSON.parse(rawLhrInput);
    } catch {
      lhr = null;
    }
  } else if (rawLhrInput && typeof rawLhrInput === 'object') {
    lhr = rawLhrInput;
  }

  const lhrVersion = String(lhr?.lighthouseVersion || '12.2.0');
  const requestedUrl = String(lhr?.requestedUrl || lhr?.finalDisplayedUrl || repoMeta?.url || 'https://example.com/');
  const fetchTime = String(lhr?.fetchTime || new Date().toISOString());

  // Extract authentic category scores from LHR when present
  const lhrCategoryScores = {};
  if (lhr?.categories && typeof lhr.categories === 'object') {
    for (const catKey of ['performance', 'accessibility', 'best-practices', 'seo']) {
      const score = lhr.categories[catKey]?.score;
      if (typeof score === 'number' && !Number.isNaN(score)) {
        lhrCategoryScores[catKey] = score;
      }
    }
  }

  // Extract failing Lighthouse audits with node selectors & metricSavings
  const failingAuditsByFresnelRule = new Map();
  const rawAudits = lhr?.audits && typeof lhr.audits === 'object' ? Object.values(lhr.audits) : [];

  for (const audit of rawAudits) {
    if (!audit || !audit.id) continue;
    const isFailing =
      (typeof audit.score === 'number' && audit.score < 0.9) ||
      (audit.metricSavings && Object.values(audit.metricSavings).some((v) => typeof v === 'number' && v > 0));
    if (!isFailing) continue;

    const mapping = LHR_AUDIT_TO_FRESNEL_RULE[audit.id];
    if (!mapping) continue;

    const firstItem = Array.isArray(audit.details?.items) ? audit.details.items[0] : null;
    const nodeSelector = firstItem?.node?.selector || '';
    const nodeSnippet = firstItem?.node?.snippet || '';
    const matchedFile = locateSelectorInWorkspace(workspaceFiles, nodeSelector, nodeSnippet);

    const savingsLabel = audit.metricSavings
      ? Object.entries(audit.metricSavings)
          .filter(([, v]) => typeof v === 'number' && v > 0)
          .map(([k, v]) => `${k}: ${k === 'CLS' ? v : `${Math.round(v)}ms`}`)
          .join(', ')
      : '';

    const info = {
      lhrAuditId: audit.id,
      lhrAuditTitle: audit.title || audit.id,
      lhrDisplayValue: audit.displayValue || savingsLabel || 'Failing LHR audit',
      lhrTargetSelector: nodeSelector || (matchedFile ? `${matchedFile.relPath} (AST match)` : ''),
      lhrAreaImproved: `${mapping.category.toUpperCase()} · ${audit.id}${savingsLabel ? ` (${savingsLabel})` : ''}`,
      matchedFile: matchedFile?.relPath || null
    };

    if (!failingAuditsByFresnelRule.has(mapping.ruleId)) {
      failingAuditsByFresnelRule.set(mapping.ruleId, info);
    }
  }

  // Run deterministic AST engine across the 4 official Lighthouse categories (no security)
  const astCommits = runAllStaticAstRules(
    workspaceFiles,
    repoMeta,
    ['performance', 'accessibility', 'best-practices', 'seo']
  );

  // Enrich matched commits with exact LHR audit telemetry & target selectors
  const enrichedCommits = astCommits.map((commit) => {
    const lhrInfo = failingAuditsByFresnelRule.get(commit.ruleId);
    if (!lhrInfo) {
      return {
        ...commit,
        analyzer: `${commit.analyzer} + lighthouse-lhr`,
        lhrAuditTitle: commit.ruleTitle,
        lhrAreaImproved: `${commit.categoryLabel} · ${commit.ruleId}`
      };
    }
    return {
      ...commit,
      analyzer: `${commit.analyzer} + lighthouse-lhr`,
      lhrAuditTitle: lhrInfo.lhrAuditTitle,
      lhrDisplayValue: lhrInfo.lhrDisplayValue,
      lhrTargetSelector: lhrInfo.lhrTargetSelector || commit.files[0],
      lhrAreaImproved: lhrInfo.lhrAreaImproved
    };
  });

  // Sort LHR-matched failing audits first
  enrichedCommits.sort((a, b) => {
    const aMatched = failingAuditsByFresnelRule.has(a.ruleId) ? 0 : 1;
    const bMatched = failingAuditsByFresnelRule.has(b.ruleId) ? 0 : 1;
    return aMatched - bMatched;
  });

  const deterministicMetrics = computeDeterministicScores(
    enrichedCommits,
    Object.keys(lhrCategoryScores).length > 0 ? lhrCategoryScores : null
  );

  return {
    lhrVersion,
    requestedUrl,
    fetchTime,
    lhrCategoryScores,
    commits: enrichedCommits,
    deterministicMetrics,
    failingAuditsCount: failingAuditsByFresnelRule.size
  };
}
