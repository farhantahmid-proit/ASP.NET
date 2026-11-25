/**
 * Fresnel Live Cloud Lighthouse Engine — Google PageSpeed Insights v5 API Runner
 *
 * Runs real, Google-hosted Lighthouse on any public URL and returns a full
 * Lighthouse Result (LHR) JSON report with zero local Chromium requirement.
 *
 * Security:
 * - Every targetUrl is strictly validated with validatePublicTargetUrl() before
 *   any outbound call (blocks loopback, private RFC-1918, link-local, metadata IPs,
 *   and non-HTTP(S) schemes).
 * - Optional PAGESPEED_API_KEY is read exclusively from server process.env and
 *   never logged or returned to clients.
 */

import { validatePublicTargetUrl } from './lighthouse-runner.js';

const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const ALLOWED_CATEGORIES = new Set([
  'performance',
  'accessibility',
  'best-practices',
  'seo'
]);

function roundScore(rawScore) {
  if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) return 0;
  return Math.max(0, Math.min(100, Math.round(rawScore * 100)));
}

function sanitizeText(raw, maxLen = 280) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Normalizes a raw Google PageSpeed Insights v5 JSON response into a compact
 * summary + full Lighthouse LHR JSON payload ready for Fresnel's Saved Audits
 * and Run 2 LHR correlator.
 */
export function normalizePageSpeedResponse(rawPayload, { requestedUrl, strategy = 'mobile' } = {}) {
  const lhr = rawPayload?.lighthouseResult;
  if (!lhr || typeof lhr !== 'object' || !lhr.categories) {
    throw new Error('PageSpeed Insights response did not include a valid Lighthouse result (LHR).');
  }

  const cats = lhr.categories || {};
  const audits = lhr.audits || {};

  const scores = {
    performance: roundScore(cats.performance?.score),
    accessibility: roundScore(cats.accessibility?.score),
    bestPractices: roundScore(cats['best-practices']?.score),
    seo: roundScore(cats.seo?.score)
  };

  // Map audit IDs to their parent Lighthouse category
  const auditCategoryMap = new Map();
  for (const [catKey, catObj] of Object.entries(cats)) {
    const refs = Array.isArray(catObj?.auditRefs) ? catObj.auditRefs : [];
    for (const ref of refs) {
      if (ref?.id && !auditCategoryMap.has(ref.id)) {
        auditCategoryMap.set(ref.id, catKey);
      }
    }
  }

  const failingAudits = [];
  for (const [auditId, audit] of Object.entries(audits)) {
    if (!audit || typeof audit !== 'object') continue;
    if (typeof audit.score !== 'number' || audit.score >= 0.9) continue;
    if (
      audit.scoreDisplayMode === 'informative' ||
      audit.scoreDisplayMode === 'notApplicable' ||
      audit.scoreDisplayMode === 'manual'
    ) {
      continue;
    }

    const parentCat = auditCategoryMap.get(auditId) || 'performance';
    failingAudits.push({
      id: auditId,
      title: sanitizeText(audit.title || auditId, 180),
      description: sanitizeText(audit.description || '', 320),
      category: ALLOWED_CATEGORIES.has(parentCat) ? parentCat : 'performance',
      score: Math.round(audit.score * 100),
      displayValue: sanitizeText(audit.displayValue || '', 120),
      numericValue:
        typeof audit.numericValue === 'number' && Number.isFinite(audit.numericValue)
          ? Math.round(audit.numericValue * 100) / 100
          : null
    });
  }

  failingAudits.sort((a, b) => a.score - b.score);

  const lcpAudit = audits['largest-contentful-paint'];
  const fcpAudit = audits['first-contentful-paint'];
  const clsAudit = audits['cumulative-layout-shift'];
  const tbtAudit = audits['total-blocking-time'];
  const siAudit = audits['speed-index'];
  const inpField = rawPayload?.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT;

  const coreWebVitals = {
    lcpMs:
      typeof lcpAudit?.numericValue === 'number' ? Math.round(lcpAudit.numericValue) : null,
    lcpDisplay: sanitizeText(lcpAudit?.displayValue || '—', 40),
    fcpMs:
      typeof fcpAudit?.numericValue === 'number' ? Math.round(fcpAudit.numericValue) : null,
    fcpDisplay: sanitizeText(fcpAudit?.displayValue || '—', 40),
    cls:
      typeof clsAudit?.numericValue === 'number'
        ? Math.round(clsAudit.numericValue * 1000) / 1000
        : null,
    clsDisplay: sanitizeText(clsAudit?.displayValue || '—', 40),
    inpMs:
      typeof inpField?.percentile === 'number' ? Math.round(inpField.percentile) : null,
    inpDisplay:
      typeof inpField?.percentile === 'number' ? `${Math.round(inpField.percentile)} ms` : 'Field N/A',
    tbtMs:
      typeof tbtAudit?.numericValue === 'number' ? Math.round(tbtAudit.numericValue) : null,
    tbtDisplay: sanitizeText(tbtAudit?.displayValue || '—', 40),
    speedIndexMs:
      typeof siAudit?.numericValue === 'number' ? Math.round(siAudit.numericValue) : null,
    speedIndexDisplay: sanitizeText(siAudit?.displayValue || '—', 40)
  };

  // Compact LHR retaining full categories & core audit entries without giant base64 filmstrip thumbnails
  const compactAudits = {};
  for (const [id, entry] of Object.entries(audits)) {
    if (!entry || typeof entry !== 'object') continue;
    if (id === 'screenshot-thumbnails' || id === 'final-screenshot' || id === 'full-page-screenshot') {
      continue;
    }
    compactAudits[id] = {
      id: entry.id || id,
      title: entry.title,
      description: entry.description,
      score: entry.score,
      scoreDisplayMode: entry.scoreDisplayMode,
      numericValue: entry.numericValue,
      numericUnit: entry.numericUnit,
      displayValue: entry.displayValue,
      metricSavings: entry.metricSavings
    };
  }

  const compactLhr = {
    lighthouseVersion: lhr.lighthouseVersion || '12.0.0',
    fetchTime: lhr.fetchTime || new Date().toISOString(),
    requestedUrl: lhr.requestedUrl || requestedUrl || '',
    finalDisplayedUrl: lhr.finalDisplayedUrl || lhr.finalUrl || requestedUrl || '',
    formFactor: strategy === 'desktop' ? 'desktop' : 'mobile',
    categories: cats,
    audits: compactAudits
  };

  return {
    source: 'google-pagespeed-insights',
    requestedUrl: compactLhr.requestedUrl,
    finalUrl: compactLhr.finalDisplayedUrl,
    strategy: strategy === 'desktop' ? 'desktop' : 'mobile',
    fetchTime: compactLhr.fetchTime,
    lighthouseVersion: compactLhr.lighthouseVersion,
    scores,
    coreWebVitals,
    failingAudits: failingAudits.slice(0, 24),
    totalAuditsEvaluated: Object.keys(audits).length,
    lhr: compactLhr,
    lhrJson: JSON.stringify(compactLhr, null, 2)
  };
}

/**
 * Executes a real Google PageSpeed Insights v5 Lighthouse run on a validated public URL.
 */
export async function runPageSpeedInsightsAudit({
  targetUrl,
  strategy = 'mobile',
  categories = ['performance', 'accessibility', 'best-practices', 'seo'],
  fetchImpl = fetch,
  timeoutMs = 45000
} = {}) {
  const safeTargetUrl = await validatePublicTargetUrl(targetUrl);
  const normalizedStrategy = strategy === 'desktop' ? 'desktop' : 'mobile';

  const normalizedCategories = Array.isArray(categories)
    ? categories
        .map((c) => String(c || '').trim().toLowerCase())
        .filter((c) => ALLOWED_CATEGORIES.has(c))
    : [];
  const activeCategories =
    normalizedCategories.length > 0
      ? Array.from(new Set(normalizedCategories))
      : ['performance', 'accessibility', 'best-practices', 'seo'];

  const params = new URLSearchParams();
  params.set('url', safeTargetUrl);
  params.set('strategy', normalizedStrategy);
  for (const cat of activeCategories) {
    params.append('category', cat);
  }

  // Server-side optional API key — never exposed to client or logged
  const serverApiKey =
    typeof process !== 'undefined' && process.env && typeof process.env.PAGESPEED_API_KEY === 'string'
      ? process.env.PAGESPEED_API_KEY.trim()
      : '';
  if (serverApiKey) {
    params.set('key', serverApiKey);
  }

  const requestUrl = `${PAGESPEED_ENDPOINT}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(requestUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(
        `Google PageSpeed Insights timed out after ${Math.round(timeoutMs / 1000)}s while auditing ${safeTargetUrl}.`
      );
    }
    throw new Error(
      `Unable to reach Google PageSpeed Insights API for ${safeTargetUrl}. Check outbound network access and try again.`
    );
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const apiMessage = sanitizeText(
      payload?.error?.message || `HTTP ${response.status} ${response.statusText}`,
      240
    );
    if (response.status === 429) {
      throw new Error(
        'Google PageSpeed Insights rate limit reached for unauthenticated requests. Configure PAGESPEED_API_KEY in the server environment or wait a moment and retry.'
      );
    }
    throw new Error(`Google PageSpeed Insights audit failed: ${apiMessage}`);
  }

  return normalizePageSpeedResponse(payload, {
    requestedUrl: safeTargetUrl,
    strategy: normalizedStrategy
  });
}
