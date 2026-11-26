import dns from 'node:dns/promises';
import tls from 'node:tls';
import * as cheerio from 'cheerio';
import {
  assertPublicHttpUrl,
  fetchPublicUrlWithSafeRedirects,
  resolvePublicTarget,
} from './ssrf-guard.js';

const WEB_CHECK_UA = 'Fresnel-WebCheck/2.0 (+https://fresnel.local/security-policy)';

const AI_BOT_NAMES = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
];

function createDefaultDnsResolvers() {
  return {
    resolve4: (host) => dns.resolve4(host).catch(() => []),
    resolve6: (host) => dns.resolve6(host).catch(() => []),
    resolveMx: (host) => dns.resolveMx(host).catch(() => []),
    resolveTxt: (host) => dns.resolveTxt(host).catch(() => []),
    resolveNs: (host) => dns.resolveNs(host).catch(() => []),
    resolveCname: (host) => dns.resolveCname(host).catch(() => []),
    resolveSoa: (host) => dns.resolveSoa(host).catch(() => null),
  };
}

function defaultTlsConnect({ host, address, port = 443, timeoutMs = 4500 }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = tls.connect(
      {
        host: address || host,
        servername: host,
        port,
        rejectUnauthorized: false,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(false);
          const protocol = socket.getProtocol?.() || null;
          const cipher = socket.getCipher?.() || null;
          const authorized = Boolean(socket.authorized);
          const authorizationError = socket.authorizationError
            ? String(socket.authorizationError)
            : null;
          socket.end();

          if (!cert || !cert.valid_to) {
            finish({
              enabled: true,
              host,
              protocol,
              cipher: cipher?.name || null,
              authorized,
              authorizationError: authorizationError || 'No peer certificate presented.',
              issuer: null,
              subject: null,
              validFrom: null,
              validTo: null,
              daysRemaining: null,
              elapsedMs: Date.now() - startedAt,
            });
            return;
          }

          const validToMs = Date.parse(cert.valid_to);
          const daysRemaining = Number.isFinite(validToMs)
            ? Math.floor((validToMs - Date.now()) / (1000 * 60 * 60 * 24))
            : null;

          finish({
            enabled: true,
            host,
            protocol,
            cipher: cipher?.name || null,
            authorized,
            authorizationError,
            issuer: cert.issuer?.O || cert.issuer?.CN || null,
            subject: cert.subject?.CN || null,
            validFrom: cert.valid_from || null,
            validTo: cert.valid_to || null,
            daysRemaining,
            elapsedMs: Date.now() - startedAt,
          });
        } catch (err) {
          socket.destroy();
          finish({
            enabled: false,
            host,
            protocol: null,
            cipher: null,
            authorized: false,
            authorizationError: err?.message || 'TLS inspection failed.',
            issuer: null,
            subject: null,
            validFrom: null,
            validTo: null,
            daysRemaining: null,
            elapsedMs: Date.now() - startedAt,
          });
        }
      },
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      finish({
        enabled: false,
        host,
        protocol: null,
        cipher: null,
        authorized: false,
        authorizationError: 'TLS handshake timed out.',
        issuer: null,
        subject: null,
        validFrom: null,
        validTo: null,
        daysRemaining: null,
        elapsedMs: Date.now() - startedAt,
      });
    });

    socket.on('error', (err) => {
      socket.destroy();
      finish({
        enabled: false,
        host,
        protocol: null,
        cipher: null,
        authorized: false,
        authorizationError: err?.message || 'TLS connection error.',
        issuer: null,
        subject: null,
        validFrom: null,
        validTo: null,
        daysRemaining: null,
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

function evaluateSecurityHeaders(headers, isHttps) {
  const specs = [
    {
      key: 'strict-transport-security',
      label: 'Strict-Transport-Security (HSTS)',
      weight: 20,
      recommended: 'max-age=31536000; includeSubDomains; preload',
      severity: isHttps ? 'high' : 'medium',
      presentCheck: (v) => Boolean(v && /max-age=\d+/i.test(v)),
    },
    {
      key: 'content-security-policy',
      label: 'Content-Security-Policy (CSP)',
      weight: 25,
      recommended: "default-src 'self'; object-src 'none'; base-uri 'self'",
      severity: 'high',
      presentCheck: (v) => Boolean(v && v.trim().length > 0),
    },
    {
      key: 'x-frame-options',
      label: 'X-Frame-Options / frame-ancestors',
      weight: 15,
      recommended: 'DENY or SAMEORIGIN',
      severity: 'medium',
      presentCheck: (v, all) =>
        Boolean(v && /(deny|sameorigin)/i.test(v)) ||
        Boolean(all['content-security-policy'] && /frame-ancestors/i.test(all['content-security-policy'])),
    },
    {
      key: 'x-content-type-options',
      label: 'X-Content-Type-Options',
      weight: 15,
      recommended: 'nosniff',
      severity: 'medium',
      presentCheck: (v) => Boolean(v && v.toLowerCase().includes('nosniff')),
    },
    {
      key: 'referrer-policy',
      label: 'Referrer-Policy',
      weight: 15,
      recommended: 'strict-origin-when-cross-origin',
      severity: 'low',
      presentCheck: (v) => Boolean(v && v.trim().length > 0),
    },
    {
      key: 'permissions-policy',
      label: 'Permissions-Policy',
      weight: 10,
      recommended: 'camera=(), microphone=(), geolocation=()',
      severity: 'low',
      presentCheck: (v) => Boolean(v && v.trim().length > 0),
    },
  ];

  const matrix = [];
  let earned = 0;

  for (const spec of specs) {
    const rawValue = headers[spec.key] || null;
    const present = spec.presentCheck(rawValue, headers);
    if (present) earned += spec.weight;
    matrix.push({
      header: spec.key,
      label: spec.label,
      present,
      value: rawValue,
      recommended: spec.recommended,
      severity: spec.severity,
    });
  }

  const leaks = [];
  if (headers['x-powered-by']) {
    leaks.push({ header: 'x-powered-by', value: headers['x-powered-by'] });
    earned = Math.max(0, earned - 5);
  }
  if (headers['x-aspnet-version']) {
    leaks.push({ header: 'x-aspnet-version', value: headers['x-aspnet-version'] });
    earned = Math.max(0, earned - 5);
  }
  if (headers.server && /\d+\.\d+/.test(headers.server)) {
    leaks.push({ header: 'server', value: headers.server });
  }

  return {
    score: Math.max(0, Math.min(100, earned)),
    matrix,
    leaks,
  };
}

function evaluateCookies(setCookieHeaders, isHttps) {
  return setCookieHeaders.slice(0, 20).map((raw) => {
    const parts = raw.split(';').map((s) => s.trim());
    const [nameVal] = parts;
    const eqIdx = nameVal ? nameVal.indexOf('=') : -1;
    const name = eqIdx > 0 ? nameVal.slice(0, eqIdx).trim() : nameVal || 'cookie';
    const flagsLower = parts.slice(1).map((p) => p.toLowerCase());
    const hasSecure = flagsLower.some((f) => f === 'secure');
    const hasHttpOnly = flagsLower.some((f) => f === 'httponly');
    const sameSitePart = flagsLower.find((f) => f.startsWith('samesite='));
    const sameSite = sameSitePart ? sameSitePart.split('=')[1] : null;
    const warnings = [];
    if (isHttps && !hasSecure) warnings.push('Missing Secure flag on HTTPS response');
    if (!hasHttpOnly) warnings.push('Missing HttpOnly flag');
    if (!sameSite) warnings.push('Missing SameSite attribute');
    return { name, hasSecure, hasHttpOnly, sameSite, warnings };
  });
}

function detectTechStackAndCms({ headers, html }) {
  const stack = new Set();
  const server = (headers.server || '').toLowerCase();
  const poweredBy = (headers['x-powered-by'] || '').toLowerCase();
  const htmlLower = (html || '').toLowerCase();

  let generator = null;
  if (html) {
    try {
      const $ = cheerio.load(html.slice(0, 120_000));
      generator = $('meta[name="generator"]').attr('content')?.trim() || null;
      if (generator) stack.add(generator);
    } catch {
      // Ignore HTML parser errors on non-HTML payloads
    }
  }

  if (headers['cf-ray'] || server.includes('cloudflare')) stack.add('Cloudflare');
  if (headers['x-vercel-id'] || server.includes('vercel')) stack.add('Vercel');
  if (server.includes('nginx')) stack.add('Nginx');
  if (server.includes('apache')) stack.add('Apache');
  if (poweredBy.includes('express')) stack.add('Express');
  if (poweredBy.includes('php')) stack.add('PHP');
  if (poweredBy.includes('asp.net')) stack.add('ASP.NET');

  let detectedCms = 'custom';
  if (
    /wp-content\/|wp-includes\/|wp-json/i.test(htmlLower) ||
    /wordpress/i.test(generator || '')
  ) {
    detectedCms = 'wordpress';
    stack.add('WordPress');
  } else if (/cdn\.shopify\.com|shopify\.theme/i.test(htmlLower) || headers['x-shopify-stage']) {
    detectedCms = 'shopify';
    stack.add('Shopify');
  } else if (htmlLower.includes('/_next/static') || headers['x-nextjs-cache'] || poweredBy.includes('next.js')) {
    detectedCms = 'nextjs';
    stack.add('Next.js');
  } else if (htmlLower.includes('ng-version') || htmlLower.includes('app-root')) {
    detectedCms = 'angular';
    stack.add('Angular');
  } else if (htmlLower.includes('data-reactroot') || htmlLower.includes('__vite')) {
    detectedCms = 'react';
    stack.add('React');
  }

  return {
    detectedCms,
    generator,
    techStack: Array.from(stack),
  };
}

function parseRobotsAiDirectives(robotsText) {
  if (!robotsText) {
    return {
      present: false,
      sitemaps: [],
      aiBots: AI_BOT_NAMES.map((bot) => ({ bot, status: 'unspecified' })),
      disallowAll: false,
    };
  }

  const lines = robotsText.split(/\r?\n/);
  const sitemaps = [];
  const rulesByAgent = new Map();
  let currentAgents = [];

  for (const rawLine of lines) {
    const clean = rawLine.replace(/#.*$/, '').trim();
    if (!clean) continue;
    const colon = clean.indexOf(':');
    if (colon === -1) continue;
    const key = clean.slice(0, colon).trim().toLowerCase();
    const val = clean.slice(colon + 1).trim();

    if (key === 'sitemap' && val) {
      sitemaps.push(val);
    } else if (key === 'user-agent') {
      currentAgents = [val.toLowerCase()];
      if (!rulesByAgent.has(val.toLowerCase())) {
        rulesByAgent.set(val.toLowerCase(), []);
      }
    } else if ((key === 'disallow' || key === 'allow') && currentAgents.length > 0) {
      for (const agent of currentAgents) {
        rulesByAgent.get(agent)?.push({ directive: key, path: val });
      }
    }
  }

  const wildcardRules = rulesByAgent.get('*') || [];
  const disallowAll = wildcardRules.some((r) => r.directive === 'disallow' && r.path === '/');

  const aiBots = AI_BOT_NAMES.map((bot) => {
    const specific = rulesByAgent.get(bot.toLowerCase());
    if (specific && specific.some((r) => r.directive === 'disallow' && r.path === '/')) {
      return { bot, status: 'blocked' };
    }
    if (specific && specific.some((r) => r.directive === 'allow' && r.path === '/')) {
      return { bot, status: 'allowed' };
    }
    if (disallowAll) {
      return { bot, status: 'blocked_by_wildcard' };
    }
    return { bot, status: 'allowed_default' };
  });

  return {
    present: true,
    sitemaps: Array.from(new Set(sitemaps)).slice(0, 10),
    aiBots,
    disallowAll,
  };
}

/**
 * Runs native Node checks adapted from FarhanSabit/web-check (MIT):
 * DNS, TLS certificate, redirects, security headers, cookies, robots/sitemap/llms.txt, and tech stack.
 */
export async function runWebCheckAudit(targetUrl, options = {}) {
  const {
    timeoutMs = 9000,
    fetchImpl = fetch,
    lookupImpl = dns.lookup,
    dnsResolvers: customDns = null,
    tlsConnectImpl = defaultTlsConnect,
  } = options;

  const startedAt = Date.now();
  const { url: parsedUrl, host, addresses } = await resolvePublicTarget(targetUrl, { lookupImpl });
  const dnsApi = { ...createDefaultDnsResolvers(), ...(customDns || {}) };
  const isHttps = parsedUrl.protocol === 'https:';

  const safeFetch = (url, opts = {}) =>
    fetchPublicUrlWithSafeRedirects(url, {
      fetchImpl,
      lookupImpl,
      timeoutMs: Math.min(timeoutMs, opts.timeoutMs || 6500),
      maxRedirects: 5,
      headers: {
        'User-Agent': WEB_CHECK_UA,
        Accept: opts.accept || 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
      ...opts,
    });

  // 1. Primary page + DNS + TLS + robots/sitemap/llms concurrently
  const origin = parsedUrl.origin;
  const [
    pageResult,
    aRecords,
    aaaaRecords,
    mxRecords,
    txtRecords,
    nsRecords,
    cnameRecords,
    soaRecord,
    dmarcTxt,
    tlsInfo,
    robotsRes,
    sitemapRes,
    llmsRes,
  ] = await Promise.all([
    safeFetch(parsedUrl.toString()).catch((err) => ({ error: err?.message || 'HTTP fetch failed.' })),
    dnsApi.resolve4(host),
    dnsApi.resolve6(host),
    dnsApi.resolveMx(host),
    dnsApi.resolveTxt(host),
    dnsApi.resolveNs(host),
    dnsApi.resolveCname(host),
    dnsApi.resolveSoa(host),
    dnsApi.resolveTxt(`_dmarc.${host}`),
    isHttps
      ? tlsConnectImpl({
          host,
          address: addresses[0],
          port: parsedUrl.port ? Number(parsedUrl.port) : 443,
          timeoutMs: Math.min(timeoutMs, 4500),
        })
      : Promise.resolve({
          enabled: false,
          host,
          protocol: null,
          cipher: null,
          authorized: false,
          authorizationError: 'Target uses plain HTTP without TLS.',
          issuer: null,
          subject: null,
          validFrom: null,
          validTo: null,
          daysRemaining: null,
          elapsedMs: 0,
        }),
    safeFetch(`${origin}/robots.txt`, { timeoutMs: 4500, maxBytes: 150_000, accept: 'text/plain,*/*' }).catch(
      () => null,
    ),
    safeFetch(`${origin}/sitemap.xml`, { timeoutMs: 4500, maxBytes: 250_000, accept: 'application/xml,text/xml,*/*' }).catch(
      () => null,
    ),
    safeFetch(`${origin}/llms.txt`, { timeoutMs: 4500, maxBytes: 150_000, accept: 'text/plain,text/markdown,*/*' }).catch(
      () => null,
    ),
  ]);

  if (pageResult?.error) {
    throw new Error(pageResult.error);
  }

  const finalIsHttps = pageResult.finalUrl.startsWith('https://');
  const flatTxt = (Array.isArray(txtRecords) ? txtRecords : []).map((r) =>
    Array.isArray(r) ? r.join('') : String(r),
  );
  const spfRecord = flatTxt.find((t) => /v=spf1/i.test(t)) || null;
  const flatDmarc = (Array.isArray(dmarcTxt) ? dmarcTxt : []).map((r) =>
    Array.isArray(r) ? r.join('') : String(r),
  );
  const dmarcRecord = flatDmarc.find((t) => /v=dmarc1/i.test(t)) || null;
  const dmarcPolicyMatch = dmarcRecord?.match(/p=(none|quarantine|reject)/i);

  const dnsSummary = {
    a: aRecords || [],
    aaaa: aaaaRecords || [],
    mx: (mxRecords || []).slice(0, 8),
    ns: (nsRecords || []).slice(0, 8),
    cname: (cnameRecords || []).slice(0, 8),
    soa: soaRecord || null,
    txtCount: flatTxt.length,
    spfPresent: Boolean(spfRecord),
    spfRecord,
    dmarcPresent: Boolean(dmarcRecord),
    dmarcPolicy: dmarcPolicyMatch ? dmarcPolicyMatch[1].toLowerCase() : null,
  };

  const securityHeaders = evaluateSecurityHeaders(pageResult.headers, finalIsHttps);
  const cookies = evaluateCookies(pageResult.setCookieHeaders || [], finalIsHttps);
  const tech = detectTechStackAndCms({ headers: pageResult.headers, html: pageResult.bodyText });

  const robotsOk = Boolean(robotsRes && robotsRes.status >= 200 && robotsRes.status < 300);
  const sitemapOk = Boolean(
    sitemapRes &&
      sitemapRes.status >= 200 &&
      sitemapRes.status < 300 &&
      /<(urlset|sitemapindex)\b/i.test(sitemapRes.bodyText || ''),
  );
  const llmsOk = Boolean(
    llmsRes &&
      llmsRes.status >= 200 &&
      llmsRes.status < 300 &&
      (llmsRes.bodyText || '').trim().length >= 20,
  );

  const robotsAnalysis = parseRobotsAiDirectives(robotsOk ? robotsRes.bodyText : '');

  // GEO readiness score (AI crawler friendliness + llms.txt + structured robots/sitemap)
  let geoScore = 35;
  if (robotsOk) geoScore += 20;
  if (sitemapOk || robotsAnalysis.sitemaps.length > 0) geoScore += 20;
  if (llmsOk) geoScore += 25;
  if (robotsAnalysis.disallowAll) geoScore -= 25;
  geoScore = Math.max(0, Math.min(100, geoScore));

  // Infra score (DNS, TLS, TTFB, HTTPS enforcement)
  let infraScore = 100;
  if (!finalIsHttps) infraScore -= 35;
  if (finalIsHttps && (!tlsInfo.enabled || !tlsInfo.authorized)) infraScore -= 20;
  if (typeof tlsInfo.daysRemaining === 'number' && tlsInfo.daysRemaining < 14) infraScore -= 15;
  if (pageResult.elapsedMs > 1500) infraScore -= 15;
  else if (pageResult.elapsedMs > 800) infraScore -= 5;
  if (aRecords.length === 0 && aaaaRecords.length === 0) infraScore -= 10;
  infraScore = Math.max(0, Math.min(100, infraScore));

  // Build normalized findings
  const findings = [];
  if (!finalIsHttps) {
    findings.push({
      id: 'wc-no-https',
      pillar: 'infra',
      severity: 'critical',
      title: 'Site did not resolve to HTTPS',
      evidence: `Final URL: ${pageResult.finalUrl}`,
      remediation: 'Enable TLS with a trusted certificate and 301-redirect all HTTP traffic to HTTPS.',
    });
  } else if (!tlsInfo.authorized) {
    findings.push({
      id: 'wc-tls-untrusted',
      pillar: 'infra',
      severity: 'high',
      title: 'TLS certificate validation warning',
      evidence: tlsInfo.authorizationError || 'Untrusted or self-signed certificate chain.',
      remediation: 'Install a valid CA-signed full certificate chain covering the audited hostname.',
    });
  } else if (typeof tlsInfo.daysRemaining === 'number' && tlsInfo.daysRemaining < 21) {
    findings.push({
      id: 'wc-tls-expiring',
      pillar: 'infra',
      severity: tlsInfo.daysRemaining < 7 ? 'critical' : 'high',
      title: `TLS certificate expires in ${tlsInfo.daysRemaining} day(s)`,
      evidence: `Valid to: ${tlsInfo.validTo}`,
      remediation: 'Configure automated ACME certificate renewal before expiration.',
    });
  }

  for (const item of securityHeaders.matrix) {
    if (!item.present) {
      findings.push({
        id: `wc-header-${item.header}`,
        pillar: 'security',
        severity: item.severity,
        title: `Missing ${item.label} response header`,
        evidence: `${item.header} was not set on ${pageResult.finalUrl}`,
        remediation: `Add "${item.header}: ${item.recommended}" at the edge CDN or application server.`,
      });
    }
  }

  for (const leak of securityHeaders.leaks) {
    findings.push({
      id: `wc-leak-${leak.header}`,
      pillar: 'security',
      severity: 'low',
      title: `Server banner leaks ${leak.header}`,
      evidence: `${leak.header}: ${leak.value}`,
      remediation: `Strip or obfuscate the "${leak.header}" header in production responses.`,
    });
  }

  for (const cookie of cookies) {
    if (cookie.warnings.length > 0) {
      findings.push({
        id: `wc-cookie-${cookie.name}`,
        pillar: 'security',
        severity: 'medium',
        title: `Cookie "${cookie.name}" missing hardening attributes`,
        evidence: cookie.warnings.join('; '),
        remediation: 'Set Secure; HttpOnly; SameSite=Lax (or Strict) on sensitive session cookies.',
      });
    }
  }

  if (!robotsOk) {
    findings.push({
      id: 'wc-geo-robots',
      pillar: 'geo',
      severity: 'medium',
      title: 'Missing /robots.txt crawl directives',
      evidence: `GET ${origin}/robots.txt returned ${robotsRes?.status ?? 'unreachable'}`,
      remediation: 'Publish /robots.txt declaring sitemap location and explicit AI/search crawler policy.',
    });
  }
  if (!sitemapOk && robotsAnalysis.sitemaps.length === 0) {
    findings.push({
      id: 'wc-geo-sitemap',
      pillar: 'seo',
      severity: 'medium',
      title: 'No XML sitemap detected at /sitemap.xml',
      evidence: `GET ${origin}/sitemap.xml returned ${sitemapRes?.status ?? 'unreachable'}`,
      remediation: 'Expose an up-to-date XML sitemap and reference it inside /robots.txt.',
    });
  }
  if (!llmsOk) {
    findings.push({
      id: 'wc-geo-llms',
      pillar: 'geo',
      severity: 'low',
      title: 'Missing /llms.txt AI discovery manifest',
      evidence: `GET ${origin}/llms.txt returned ${llmsRes?.status ?? 'unreachable'}`,
      remediation:
        'Publish a concise Markdown /llms.txt summarizing primary docs, pricing, and canonical URLs for AI answer engines.',
    });
  }

  return {
    requestedUrl: parsedUrl.toString(),
    finalUrl: pageResult.finalUrl,
    status: pageResult.status,
    elapsedMs: pageResult.elapsedMs,
    durationMs: Math.max(1, Date.now() - startedAt),
    redirectChain: pageResult.redirectChain,
    dns: dnsSummary,
    tls: tlsInfo,
    securityHeaders,
    cookies,
    geo: {
      llmsTxtPresent: llmsOk,
      llmsTxtExcerpt: llmsOk ? (llmsRes.bodyText || '').trim().slice(0, 320) : null,
      robotsTxtPresent: robotsOk,
      sitemapXmlPresent: sitemapOk,
      sitemaps: robotsAnalysis.sitemaps,
      aiBots: robotsAnalysis.aiBots,
      geoReadinessScore: geoScore,
    },
    detectedCms: tech.detectedCms,
    generator: tech.generator,
    techStack: tech.techStack,
    infraScore,
    securityScore: securityHeaders.score,
    geoScore,
    findings,
    _htmlSample: (pageResult.bodyText || '').slice(0, 150_000),
  };
}
