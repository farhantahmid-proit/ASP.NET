import { spawn, spawnSync } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { assertPublicHttpUrl, fetchPublicUrlWithSafeRedirects } from './ssrf-guard.js';

const CRAWL_UA = 'Fresnel-SiteOne-Audit/2.0 (+https://fresnel.local/crawler)';

/**
 * Checks for an optional native `siteone-crawler` Rust binary.
 */
export function detectSiteOneBinary() {
  const configured = process.env.SITEONE_BIN_PATH?.trim();
  if (configured && fs.existsSync(configured)) {
    return { available: true, binPath: configured };
  }

  try {
    const locator = process.platform === 'win32' ? 'where' : 'which';
    const check = spawnSync(locator, ['siteone-crawler'], {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 2000,
    });
    if (check.status === 0 && check.stdout) {
      const firstLine = check.stdout.split(/\r?\n/).find((l) => l.trim());
      if (firstLine && fs.existsSync(firstLine.trim())) {
        return { available: true, binPath: firstLine.trim() };
      }
    }
  } catch {
    // Binary unavailable; fallback BFS crawler is used automatically
  }

  return { available: false, binPath: null };
}

function normalizeCrawlUrl(rawUrl, baseOrigin) {
  try {
    const parsed = new URL(rawUrl, baseOrigin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.origin !== baseOrigin) return null;
    parsed.hash = '';
    // Normalize trailing slash on bare root path
    if (parsed.pathname === '') parsed.pathname = '/';
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Evaluates viasite/site-audit-seo-inspired per-page SEO & quality thresholds.
 */
export function evaluatePageSeoRules(page, duplicateTitles) {
  const issues = [];
  if (page.status >= 400 || page.status === 0) {
    issues.push({
      ruleId: 'broken-internal-link',
      severity: page.status >= 500 || page.status === 0 ? 'high' : 'medium',
      message: `HTTP ${page.status || 'ERR'} response`,
    });
  }
  if (!page.title) {
    issues.push({
      ruleId: 'missing-title',
      severity: 'high',
      message: 'Missing <title> element',
    });
  } else {
    if (page.titleLength < 10 || page.titleLength > 65) {
      issues.push({
        ruleId: 'title-length',
        severity: 'low',
        message: `<title> length (${page.titleLength} chars) outside 10–65 range`,
      });
    }
    if (duplicateTitles?.has(page.title.toLowerCase())) {
      issues.push({
        ruleId: 'duplicate-title',
        severity: 'medium',
        message: 'Duplicate <title> shared across multiple crawled URLs',
      });
    }
  }

  if (!page.metaDescription) {
    issues.push({
      ruleId: 'missing-meta-description',
      severity: 'medium',
      message: 'Missing <meta name="description">',
    });
  }
  if (page.h1Count === 0) {
    issues.push({
      ruleId: 'missing-h1',
      severity: 'medium',
      message: 'Missing <h1> heading',
    });
  } else if (page.h1Count > 1) {
    issues.push({
      ruleId: 'multiple-h1',
      severity: 'low',
      message: `Multiple <h1> headings (${page.h1Count})`,
    });
  }
  if (!page.canonical) {
    issues.push({
      ruleId: 'missing-canonical',
      severity: 'low',
      message: 'Missing <link rel="canonical">',
    });
  }
  if (page.imagesMissingAlt > 0) {
    issues.push({
      ruleId: 'images-missing-alt',
      severity: 'medium',
      message: `${page.imagesMissingAlt} image(s) missing alt attribute`,
    });
  }
  if (page.ttfbMs > 1200) {
    issues.push({
      ruleId: 'slow-ttfb',
      severity: 'medium',
      message: `Slow response (${page.ttfbMs} ms > 1200 ms budget)`,
    });
  }
  return issues;
}

function finalizeCrawlResult({ engine, rootUrl, pages, startedAt }) {
  const titleCounts = new Map();
  for (const page of pages) {
    if (page.title) {
      const k = page.title.toLowerCase();
      titleCounts.set(k, (titleCounts.get(k) || 0) + 1);
    }
  }
  const duplicateTitles = new Set(
    Array.from(titleCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([title]) => title),
  );

  const enrichedPages = pages.map((page) => ({
    ...page,
    issues: evaluatePageSeoRules(page, duplicateTitles),
  }));

  const findings = [];
  const brokenPages = enrichedPages.filter((p) => p.status >= 400 || p.status === 0);
  if (brokenPages.length > 0) {
    findings.push({
      id: 'crawl-broken-urls',
      pillar: 'seo',
      severity: 'high',
      title: `${brokenPages.length} crawled internal URL(s) returned errors`,
      evidence: brokenPages
        .slice(0, 4)
        .map((p) => `${p.url} (HTTP ${p.status})`)
        .join(', '),
      remediation: 'Fix broken routes or replace dead internal links with valid canonical URLs.',
    });
  }

  const missingDescCount = enrichedPages.filter((p) => !p.metaDescription && p.status < 400).length;
  if (missingDescCount > 0) {
    findings.push({
      id: 'crawl-missing-meta-desc',
      pillar: 'seo',
      severity: 'medium',
      title: `${missingDescCount} page(s) missing meta description`,
      evidence: `${missingDescCount} of ${enrichedPages.length} URLs lack <meta name="description">`,
      remediation: 'Add unique 120–160 character meta descriptions to improve CTR and snippets.',
    });
  }

  if (duplicateTitles.size > 0) {
    findings.push({
      id: 'crawl-duplicate-titles',
      pillar: 'seo',
      severity: 'medium',
      title: `${duplicateTitles.size} duplicate <title> tag(s) across site`,
      evidence: Array.from(duplicateTitles).slice(0, 3).join('; '),
      remediation: 'Assign distinct descriptive <title> values per route.',
    });
  }

  const totalMissingAlt = enrichedPages.reduce((sum, p) => sum + (p.imagesMissingAlt || 0), 0);
  if (totalMissingAlt > 0) {
    findings.push({
      id: 'crawl-images-missing-alt',
      pillar: 'seo',
      severity: 'medium',
      title: `${totalMissingAlt} image(s) missing alt text across crawled pages`,
      evidence: `Detected across ${enrichedPages.filter((p) => p.imagesMissingAlt > 0).length} page(s)`,
      remediation: 'Provide descriptive alt attributes for content images or alt="" for decorative images.',
    });
  }

  const missingCanonicalCount = enrichedPages.filter((p) => !p.canonical && p.status < 400).length;
  if (missingCanonicalCount > 0) {
    findings.push({
      id: 'crawl-missing-canonical',
      pillar: 'seo',
      severity: 'low',
      title: `${missingCanonicalCount} page(s) lack a canonical link`,
      evidence: `${missingCanonicalCount} crawled HTML page(s) have no <link rel="canonical">`,
      remediation: 'Declare self-referencing canonical URLs to prevent duplicate indexing.',
    });
  }

  // Score out of 100
  const okPages = enrichedPages.filter((p) => p.status >= 200 && p.status < 400);
  let seoScore = 100;
  if (brokenPages.length > 0) seoScore -= Math.min(35, brokenPages.length * 12);
  if (okPages.length > 0) {
    const missingDescRatio = missingDescCount / okPages.length;
    const missingCanonRatio = missingCanonicalCount / okPages.length;
    seoScore -= Math.round(missingDescRatio * 18);
    seoScore -= Math.round(missingCanonRatio * 10);
  }
  if (duplicateTitles.size > 0) seoScore -= Math.min(15, duplicateTitles.size * 5);
  if (totalMissingAlt > 0) seoScore -= Math.min(12, totalMissingAlt * 2);

  return {
    engine,
    rootUrl,
    crawledCount: enrichedPages.length,
    brokenCount: brokenPages.length,
    duplicateTitleCount: duplicateTitles.size,
    avgTtfbMs:
      enrichedPages.length > 0
        ? Math.round(enrichedPages.reduce((s, p) => s + p.ttfbMs, 0) / enrichedPages.length)
        : 0,
    seoScore: Math.max(0, Math.min(100, seoScore)),
    durationMs: Math.max(1, Date.now() - startedAt),
    pages: enrichedPages,
    findings,
  };
}

function runSiteOneBinary({ binPath, targetUrl, maxUrls, workers, maxReqsPerSec, timeoutMs, spawnImpl }) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `fresnel-siteone-${Date.now()}.json`);
    const args = [
      `--url=${targetUrl}`,
      `--max-visited-urls=${maxUrls}`,
      `--workers=${workers}`,
      `--max-reqs-per-sec=${maxReqsPerSec}`,
      `--timeout=${Math.max(5, Math.ceil(timeoutMs / 1000))}`,
      `--output-json-file=${tmpFile}`,
    ];

    const child = spawnImpl(binPath, args, { shell: false, stdio: 'pipe' });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore kill error
      }
      reject(new Error('Native siteone-crawler timed out.'));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0 || !fs.existsSync(tmpFile)) {
          reject(new Error(`siteone-crawler exited with code ${code}`));
          return;
        }
        const parsed = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
        fs.unlinkSync(tmpFile);
        const rawPages = Array.isArray(parsed?.urls)
          ? parsed.urls
          : Array.isArray(parsed?.pages)
            ? parsed.pages
            : [];
        if (rawPages.length === 0) {
          reject(new Error('siteone-crawler JSON contained zero pages.'));
          return;
        }
        const pages = rawPages.slice(0, maxUrls).map((u, idx) => ({
          url: String(u.url || targetUrl),
          depth: Number(u.depth ?? (idx === 0 ? 0 : 1)),
          status: Number(u.status || u.statusCode || 200),
          ttfbMs: Math.round(Number(u.execTimeMs || u.timeMs || 150)),
          contentType: String(u.contentType || 'text/html'),
          title: String(u.title || ''),
          titleLength: String(u.title || '').length,
          metaDescription: String(u.description || u.metaDescription || ''),
          h1Count: Number(u.h1Count ?? (u.title ? 1 : 0)),
          h1Text: String(u.h1 || ''),
          canonical: String(u.canonical || ''),
          ogTitle: String(u.ogTitle || ''),
          imagesTotal: Number(u.imagesCount || 0),
          imagesMissingAlt: Number(u.imagesMissingAlt || 0),
          internalLinksCount: Number(u.internalLinksCount || 0),
          externalLinksCount: Number(u.externalLinksCount || 0),
          markdownExtractableChars: Number(u.wordCount || 0) * 6,
        }));
        resolve(pages);
      } catch (err) {
        try {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        } catch {
          // Ignore cleanup error
        }
        reject(err);
      }
    });
  });
}

/**
 * Runs SiteOne Rust binary if installed, otherwise executes an SSRF-guarded,
 * bounded in-process Cheerio BFS crawler.
 */
export async function runSiteCrawlAudit(targetUrl, options = {}) {
  const {
    maxUrls: rawMaxUrls = 25,
    maxDepth: rawMaxDepth = 2,
    workers: rawWorkers = 3,
    maxReqsPerSec = 8,
    timeoutMs: rawTimeoutMs = 45000,
    onProgress,
    fetchImpl = fetch,
    lookupImpl = dns.lookup,
    spawnImpl = spawn,
    forceFallback = false,
  } = options;

  const startedAt = Date.now();
  const parsedRoot = await assertPublicHttpUrl(targetUrl, { lookupImpl });
  const baseOrigin = parsedRoot.origin;
  const maxUrls = Math.max(1, Math.min(50, Number(rawMaxUrls) || 25));
  const maxDepth = Math.max(0, Math.min(3, Number(rawMaxDepth) || 2));
  const workers = Math.max(1, Math.min(5, Number(rawWorkers) || 3));
  const timeoutMs = Math.max(4000, Math.min(60000, Number(rawTimeoutMs) || 45000));

  // Path 1: Try native siteone-crawler binary when installed
  if (!forceFallback) {
    const bin = detectSiteOneBinary();
    if (bin.available && bin.binPath) {
      try {
        const nativePages = await runSiteOneBinary({
          binPath: bin.binPath,
          targetUrl: parsedRoot.toString(),
          maxUrls,
          workers,
          maxReqsPerSec,
          timeoutMs,
          spawnImpl,
        });
        return finalizeCrawlResult({
          engine: 'siteone-rust',
          rootUrl: parsedRoot.toString(),
          pages: nativePages,
          startedAt,
        });
      } catch {
        // Fall through to permissive built-in Cheerio BFS crawler
      }
    }
  }

  // Path 2: Bounded permissive Cheerio + ssrf-guard BFS crawler
  const startUrlNorm = normalizeCrawlUrl(parsedRoot.toString(), baseOrigin) || parsedRoot.toString();
  const visited = new Set([startUrlNorm]);
  const queue = [{ url: startUrlNorm, depth: 0 }];
  const pages = [];
  const deadline = startedAt + timeoutMs;
  const minSpacingMs = maxReqsPerSec > 0 ? Math.floor(1000 / maxReqsPerSec) : 0;
  let lastFetchAt = 0;

  async function processQueueItem(item) {
    const now = Date.now();
    if (now >= deadline) return;
    if (minSpacingMs > 0) {
      const waitMs = lastFetchAt + minSpacingMs - now;
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 250)));
      }
      lastFetchAt = Date.now();
    }

    try {
      const remainingMs = Math.max(1500, deadline - Date.now());
      const res = await fetchPublicUrlWithSafeRedirects(item.url, {
        fetchImpl,
        lookupImpl,
        timeoutMs: Math.min(7000, remainingMs),
        maxRedirects: 4,
        maxBytes: 600_000,
        headers: {
          'User-Agent': CRAWL_UA,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        },
      });

      const contentType = res.headers['content-type'] || '';
      const isHtml = contentType.includes('html') || /^\s*<!doctype|^\s*<html/i.test(res.bodyText || '');

      let title = '';
      let metaDescription = '';
      let h1Count = 0;
      let h1Text = '';
      let canonical = '';
      let ogTitle = '';
      let imagesTotal = 0;
      let imagesMissingAlt = 0;
      let internalLinksCount = 0;
      let externalLinksCount = 0;
      let markdownExtractableChars = 0;

      if (isHtml && res.bodyText) {
        const $ = cheerio.load(res.bodyText);
        title = $('title').first().text().replace(/\s+/g, ' ').trim();
        metaDescription = $('meta[name="description"]').attr('content')?.replace(/\s+/g, ' ').trim() || '';
        const h1s = $('h1');
        h1Count = h1s.length;
        h1Text = h1s.first().text().replace(/\s+/g, ' ').trim().slice(0, 140);
        canonical = $('link[rel="canonical"]').attr('href')?.trim() || '';
        ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';

        $('img').each((_, el) => {
          imagesTotal += 1;
          const alt = $(el).attr('alt');
          if (alt === undefined) {
            imagesMissingAlt += 1;
          }
        });

        $('a[href]').each((_, el) => {
          const href = $(el).attr('href')?.trim();
          if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
            return;
          }
          if (/^javascript:/i.test(href)) return;
          const nextNorm = normalizeCrawlUrl(href, baseOrigin);
          if (nextNorm) {
            internalLinksCount += 1;
            if (
              item.depth + 1 <= maxDepth &&
              !visited.has(nextNorm) &&
              visited.size < maxUrls
            ) {
              visited.add(nextNorm);
              queue.push({ url: nextNorm, depth: item.depth + 1 });
            }
          } else {
            externalLinksCount += 1;
          }
        });

        $('script, style, noscript').remove();
        markdownExtractableChars = $('body').text().replace(/\s+/g, ' ').trim().length;
      }

      pages.push({
        url: res.finalUrl || item.url,
        depth: item.depth,
        status: res.status,
        ttfbMs: res.elapsedMs,
        contentType: contentType.split(';')[0] || 'text/html',
        title,
        titleLength: title.length,
        metaDescription,
        h1Count,
        h1Text,
        canonical,
        ogTitle,
        imagesTotal,
        imagesMissingAlt,
        internalLinksCount,
        externalLinksCount,
        markdownExtractableChars,
      });
    } catch {
      pages.push({
        url: item.url,
        depth: item.depth,
        status: 0,
        ttfbMs: 0,
        contentType: 'error',
        title: '',
        titleLength: 0,
        metaDescription: '',
        h1Count: 0,
        h1Text: '',
        canonical: '',
        ogTitle: '',
        imagesTotal: 0,
        imagesMissingAlt: 0,
        internalLinksCount: 0,
        externalLinksCount: 0,
        markdownExtractableChars: 0,
      });
    }

    onProgress?.({
      crawledCount: pages.length,
      queuedCount: visited.size,
      maxUrls,
    });
  }

  while (queue.length > 0 && Date.now() < deadline && pages.length < maxUrls) {
    const batch = queue.splice(0, workers);
    await Promise.all(batch.map((item) => processQueueItem(item)));
  }

  return finalizeCrawlResult({
    engine: 'fresnel-cheerio-bfs',
    rootUrl: startUrlNorm,
    pages,
    startedAt,
  });
}

function escapeCsvCell(value) {
  const str = String(value ?? '').replace(/\r?\n/g, ' ');
  // Neutralize spreadsheet formula triggers if cell starts with = + - @
  const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
  if (/[",]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * Serializes a SiteCrawlResult into RFC 4180 CSV for spreadsheet download.
 */
export function serializeSiteCrawlToCsv(crawlResult) {
  const headers = [
    'URL',
    'Depth',
    'Status',
    'TTFB (ms)',
    'Title',
    'Title Length',
    'Meta Description Length',
    'H1 Count',
    'Canonical',
    'Images Missing Alt',
    'Internal Links',
    'External Links',
    'SEO Issues',
  ];
  const lines = [headers.join(',')];
  const pages = Array.isArray(crawlResult?.pages) ? crawlResult.pages : [];

  for (const page of pages) {
    const issuesSummary = (page.issues || []).map((i) => `${i.ruleId}: ${i.message}`).join(' | ');
    const row = [
      page.url,
      page.depth,
      page.status,
      page.ttfbMs,
      page.title,
      page.titleLength,
      (page.metaDescription || '').length,
      page.h1Count,
      page.canonical,
      page.imagesMissingAlt,
      page.internalLinksCount,
      page.externalLinksCount,
      issuesSummary,
    ].map(escapeCsvCell);
    lines.push(row.join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}
