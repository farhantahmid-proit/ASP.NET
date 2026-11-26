import crypto from 'node:crypto';
import { assertPublicHttpUrl } from './ssrf-guard.js';
import { runWebCheckAudit } from './web-check-runner.js';
import { runSiteCrawlAudit } from './siteone-runner.js';
import { runThreatIntelAudit } from './threat-intel-runner.js';

const MAX_SITE_SESSIONS = 100;
const WIDGET_RATE_WINDOW_MS = 5 * 60 * 1000;
const WIDGET_RATE_MAX_REQUESTS = 10;

const SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

class BoundedSiteSessionMap extends Map {
  set(key, value) {
    if (!this.has(key) && this.size >= MAX_SITE_SESSIONS) {
      const oldestKey = this.keys().next().value;
      if (oldestKey !== undefined) this.delete(oldestKey);
    }
    return super.set(key, value);
  }
}

const siteAuditSessions = new BoundedSiteSessionMap();
const widgetIpBuckets = new Map();

function sanitizeWidgetErrorMessage(err) {
  const msg = String(err?.message || '').trim();
  if (/private|loopback|metadata|local|protocol|valid public http|credentials|resolve public dns/i.test(msg)) {
    return msg;
  }
  if (/timed out|abort/i.test(msg)) {
    return 'Target site did not respond within the widget timeout budget.';
  }
  return 'Unable to reach the target URL for auditing. Verify the domain and try again.';
}

export function checkWidgetRateLimit(clientIp, options = {}) {
  const {
    nowMs = Date.now(),
    windowMs = WIDGET_RATE_WINDOW_MS,
    maxRequests = WIDGET_RATE_MAX_REQUESTS,
  } = options;
  const key = String(clientIp || 'unknown');
  const cutoff = nowMs - windowMs;
  const prev = (widgetIpBuckets.get(key) || []).filter((ts) => ts > cutoff);
  if (prev.length >= maxRequests) {
    const oldest = prev[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));
    widgetIpBuckets.set(key, prev);
    return { allowed: false, retryAfterSec, remaining: 0 };
  }
  prev.push(nowMs);
  widgetIpBuckets.set(key, prev);
  return { allowed: true, retryAfterSec: 0, remaining: maxRequests - prev.length };
}

export function clearWidgetRateLimits() {
  widgetIpBuckets.clear();
}

export function getOptionalSidecarAdaptersStatus() {
  return {
    firecrawl: {
      configured: Boolean(process.env.FIRECRAWL_API_URL?.trim()),
      license: 'AGPL-3.0 (external sidecar only)',
    },
    zeroleaks: {
      configured: Boolean(process.env.ZEROLEAKS_ENDPOINT_URL?.trim()),
      license: 'FSL-1.1 (external sidecar only)',
    },
    socialAnalyzer: {
      configured: Boolean(process.env.SOCIAL_ANALYZER_API_URL?.trim()),
      license: 'AGPL-3.0 (external sidecar only)',
    },
  };
}

function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 9;
    const sb = SEVERITY_ORDER[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(a.title).localeCompare(String(b.title));
  });
}

function stripInternalHtml(webCheck) {
  if (!webCheck || typeof webCheck !== 'object') return null;
  const { _htmlSample, ...publicWebCheck } = webCheck;
  return publicWebCheck;
}

function recomputeUnifiedMetrics(session) {
  const wc = session.webCheck;
  const ti = session.threatIntel;
  const crawl = session.siteCrawl;

  const infra = wc ? wc.infraScore : null;
  const security =
    wc && ti
      ? Math.round(wc.securityScore * 0.55 + ti.threatScore * 0.45)
      : wc
        ? wc.securityScore
        : null;
  const seo = crawl ? crawl.seoScore : wc ? (wc.geo?.sitemapXmlPresent ? 75 : 55) : null;
  const geo = wc ? wc.geoScore : null;
  const cms = ti ? ti.cmsScore : null;

  const active = [infra, security, seo, geo].filter((n) => typeof n === 'number');
  const overall =
    active.length > 0
      ? Math.round(active.reduce((sum, n) => sum + n, 0) / active.length)
      : null;

  const combinedFindings = sortFindings([
    ...(wc?.findings || []),
    ...(ti?.findings || []),
    ...(crawl?.findings || []),
  ]);

  session.scores = { overall, infra, security, seo, geo, cms };
  session.findings = combinedFindings;
}

export function serializeSiteAuditSession(session) {
  return {
    id: session.id,
    targetUrl: session.targetUrl,
    source: session.source,
    status: session.status,
    progressPercent: session.progressPercent,
    error: session.error || null,
    createdAt: session.createdAt,
    completedAt: session.completedAt || null,
    pillars: { ...session.pillars },
    scores: { ...session.scores },
    webCheck: stripInternalHtml(session.webCheck),
    threatIntel: session.threatIntel || null,
    siteCrawl: session.siteCrawl || null,
    findings: session.findings || [],
    sidecarAdapters: session.sidecarAdapters,
  };
}

function emitSse(session, eventName, payload) {
  if (!session.sseListeners || session.sseListeners.size === 0) return;
  const packet = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of session.sseListeners) {
    try {
      res.write(packet);
    } catch {
      session.sseListeners.delete(res);
    }
  }
}

async function executeSiteAuditPipeline(session, options = {}) {
  const { maxUrls = 25, maxDepth = 2, includeCrawl = true, includeThreatIntel = true } = options;

  try {
    // Pillar 1: Fast Web-Check (~1-2s)
    session.pillars['web-check'] = { status: 'running', error: null };
    session.progressPercent = 15;
    emitSse(session, 'pillar', {
      pillar: 'web-check',
      status: 'running',
      progressPercent: session.progressPercent,
    });

    const webCheckResult = await runWebCheckAudit(session.targetUrl, {
      timeoutMs: 9000,
    });
    session.webCheck = webCheckResult;
    session.pillars['web-check'] = {
      status: 'completed',
      durationMs: webCheckResult.durationMs,
      error: null,
    };
    session.progressPercent = includeCrawl || includeThreatIntel ? 45 : 100;
    recomputeUnifiedMetrics(session);

    const afterWebCheck = serializeSiteAuditSession(session);
    emitSse(session, 'pillar', {
      pillar: 'web-check',
      status: 'completed',
      session: afterWebCheck,
    });
    emitSse(session, 'state', afterWebCheck);

    // Pillar 2 & 3 concurrently: Threat Intel & SiteOne/Cheerio Crawl
    const tasks = [];

    if (includeThreatIntel) {
      session.pillars['threat-intel'] = { status: 'running', error: null };
      tasks.push(
        runThreatIntelAudit(session.targetUrl, {
          webCheckResult,
          htmlSample: webCheckResult._htmlSample || '',
          timeoutMs: 5500,
        })
          .then((tiRes) => {
            session.threatIntel = tiRes;
            session.pillars['threat-intel'] = {
              status: 'completed',
              durationMs: tiRes.durationMs,
              error: null,
            };
            session.progressPercent = Math.max(session.progressPercent, includeCrawl ? 72 : 95);
            recomputeUnifiedMetrics(session);
            const snap = serializeSiteAuditSession(session);
            emitSse(session, 'pillar', {
              pillar: 'threat-intel',
              status: 'completed',
              session: snap,
            });
            emitSse(session, 'state', snap);
          })
          .catch((err) => {
            session.pillars['threat-intel'] = {
              status: 'failed',
              error: err?.message || 'Threat intelligence scan failed.',
            };
          }),
      );
    } else {
      session.pillars['threat-intel'] = { status: 'skipped', error: null };
    }

    if (includeCrawl) {
      session.pillars['site-crawl'] = { status: 'running', error: null };
      let lastCrawlProgressEmit = 0;
      tasks.push(
        runSiteCrawlAudit(session.targetUrl, {
          maxUrls,
          maxDepth,
          timeoutMs: 40000,
          onProgress: ({ crawledCount, maxUrls: cap }) => {
            const now = Date.now();
            if (now - lastCrawlProgressEmit < 600) return;
            lastCrawlProgressEmit = now;
            session.progressPercent = Math.min(95, 50 + Math.round((crawledCount / Math.max(1, cap)) * 45));
            emitSse(session, 'pillar', {
              pillar: 'site-crawl',
              status: 'running',
              progressPercent: session.progressPercent,
              crawledCount,
            });
          },
        })
          .then((crawlRes) => {
            session.siteCrawl = crawlRes;
            session.pillars['site-crawl'] = {
              status: 'completed',
              durationMs: crawlRes.durationMs,
              error: null,
            };
            recomputeUnifiedMetrics(session);
            const snap = serializeSiteAuditSession(session);
            emitSse(session, 'pillar', {
              pillar: 'site-crawl',
              status: 'completed',
              session: snap,
            });
          })
          .catch((err) => {
            session.pillars['site-crawl'] = {
              status: 'failed',
              error: err?.message || 'Site crawl failed.',
            };
          }),
      );
    } else {
      session.pillars['site-crawl'] = { status: 'skipped', error: null };
    }

    await Promise.all(tasks);
    session.status = 'completed';
    session.progressPercent = 100;
    session.completedAt = new Date().toISOString();
    recomputeUnifiedMetrics(session);

    const finalSnap = serializeSiteAuditSession(session);
    emitSse(session, 'state', finalSnap);
    emitSse(session, 'completed', { sessionId: session.id, session: finalSnap });
    for (const res of session.sseListeners) {
      try {
        res.end();
      } catch {
        // Ignore stream close errors
      }
    }
    session.sseListeners.clear();
  } catch (err) {
    session.status = 'failed';
    session.progressPercent = 100;
    session.error = err?.message || 'Site audit pipeline failed.';
    session.pillars['web-check'] = { status: 'failed', error: session.error };
    const failedSnap = serializeSiteAuditSession(session);
    emitSse(session, 'state', failedSnap);
    emitSse(session, 'completed', { sessionId: session.id, error: session.error });
    for (const res of session.sseListeners) {
      try {
        res.end();
      } catch {
        // Ignore stream close errors
      }
    }
    session.sseListeners.clear();
  }
}

/**
 * Validates targetUrl upfront against SSRF rules and launches a progressive site audit session.
 */
export async function startSiteAuditSession({
  targetUrl,
  clientId,
  maxUrls = 25,
  maxDepth = 2,
  includeCrawl = true,
  includeThreatIntel = true,
  source = 'web',
}) {
  const safeUrl = await assertPublicHttpUrl(targetUrl);
  const id = `site-${crypto.randomBytes(12).toString('hex')}`;

  const session = {
    id,
    clientId,
    targetUrl: safeUrl.toString(),
    source: String(source || 'web').slice(0, 32),
    status: 'in_progress',
    progressPercent: 5,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    pillars: {
      'web-check': { status: 'pending', error: null },
      'threat-intel': { status: includeThreatIntel ? 'pending' : 'skipped', error: null },
      'site-crawl': { status: includeCrawl ? 'pending' : 'skipped', error: null },
    },
    scores: {
      overall: null,
      infra: null,
      security: null,
      seo: null,
      geo: null,
      cms: null,
    },
    webCheck: null,
    threatIntel: null,
    siteCrawl: null,
    findings: [],
    sidecarAdapters: getOptionalSidecarAdaptersStatus(),
    sseListeners: new Set(),
  };

  siteAuditSessions.set(id, session);
  void executeSiteAuditPipeline(session, { maxUrls, maxDepth, includeCrawl, includeThreatIntel });

  return serializeSiteAuditSession(session);
}

export function getSiteAuditSessionRaw(sessionId, clientId) {
  const session = siteAuditSessions.get(sessionId);
  if (!session) return null;
  if (session.clientId && clientId && session.clientId !== clientId) return null;
  return session;
}

export function getSiteAuditSession(sessionId, clientId) {
  const raw = getSiteAuditSessionRaw(sessionId, clientId);
  return raw ? serializeSiteAuditSession(raw) : null;
}

/**
 * Runs a fast bounded audit (<= 10s, no multi-page crawl) for the embeddable widget.
 */
export async function runQuickWidgetSiteAudit({
  targetUrl,
  publicKey,
  workspaceName,
  clientIp,
  options = {},
}) {
  const rate = checkWidgetRateLimit(clientIp);
  if (!rate.allowed) {
    const err = new Error(`Widget rate limit exceeded. Try again in ${rate.retryAfterSec}s.`);
    err.statusCode = 429;
    err.retryAfterSec = rate.retryAfterSec;
    throw err;
  }

  let parsedUrl;
  try {
    parsedUrl = await assertPublicHttpUrl(targetUrl, options);
  } catch (err) {
    const wrapped = new Error(sanitizeWidgetErrorMessage(err));
    wrapped.statusCode = 400;
    throw wrapped;
  }

  const startedAt = Date.now();
  try {
    const webCheck = await runWebCheckAudit(parsedUrl.toString(), {
      timeoutMs: 6500,
      ...options,
    });
    const threatIntel = await runThreatIntelAudit(parsedUrl.toString(), {
      webCheckResult: webCheck,
      htmlSample: webCheck._htmlSample || '',
      timeoutMs: 2500,
      enableExternalCti: false,
      ...options,
    }).catch(() => null);

    const securityScore = threatIntel
      ? Math.round(webCheck.securityScore * 0.6 + threatIntel.threatScore * 0.4)
      : webCheck.securityScore;
    const seoScore = webCheck.geo?.sitemapXmlPresent && webCheck.geo?.robotsTxtPresent ? 82 : 62;
    const cmsScore = threatIntel ? threatIntel.cmsScore : 100;
    const overall = Math.round(
      (webCheck.infraScore + securityScore + seoScore + webCheck.geoScore) / 4,
    );

    const combinedFindings = sortFindings([
      ...(webCheck.findings || []),
      ...(threatIntel?.findings || []),
    ]);

    return {
      publicKey,
      workspaceName,
      targetUrl: parsedUrl.toString(),
      finalUrl: webCheck.finalUrl,
      auditedAt: new Date().toISOString(),
      durationMs: Math.max(1, Date.now() - startedAt),
      scores: {
        overall,
        infra: webCheck.infraScore,
        security: securityScore,
        seo: seoScore,
        geo: webCheck.geoScore,
        cms: cmsScore,
      },
      detectedCms: webCheck.detectedCms,
      techStack: webCheck.techStack,
      geoReadiness: {
        llmsTxtPresent: webCheck.geo.llmsTxtPresent,
        robotsTxtPresent: webCheck.geo.robotsTxtPresent,
        sitemapXmlPresent: webCheck.geo.sitemapXmlPresent,
      },
      findings: combinedFindings.slice(0, 5),
      totalFindingsCount: combinedFindings.length,
    };
  } catch (err) {
    const wrapped = new Error(sanitizeWidgetErrorMessage(err));
    wrapped.statusCode = 422;
    throw wrapped;
  }
}
