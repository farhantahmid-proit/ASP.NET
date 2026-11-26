import dns from 'node:dns/promises';
import * as cheerio from 'cheerio';
import { WORDPRESS_AUDIT_CHECKLIST } from './standards-registry.js';
import { assertPublicHttpUrl, fetchPublicUrlWithSafeRedirects } from './ssrf-guard.js';

const THREAT_UA = 'Fresnel-PassiveThreatIntel/2.0 (+read-only)';

async function fetchCrtShSubdomains(domain, { fetchImpl = fetch, timeoutMs = 4500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(
      `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`,
      {
        headers: { 'User-Agent': THREAT_UA, Accept: 'application/json' },
        signal: controller.signal,
      },
    );
    if (!res.ok) return [];
    const text = (await res.text()).slice(0, 350_000);
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) return [];
    const found = new Set();
    for (const row of rows) {
      const names = String(row?.name_value || '').split('\n');
      for (const rawName of names) {
        const cleaned = rawName.trim().toLowerCase().replace(/^\*\./, '');
        if (cleaned && cleaned !== domain && cleaned.endsWith(`.${domain}`) && !cleaned.includes(' ')) {
          found.add(cleaned);
          if (found.size >= 50) break;
        }
      }
      if (found.size >= 50) break;
    }
    return Array.from(found).sort();
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function inspectSupplyChainScripts(htmlSample, targetOrigin) {
  if (!htmlSample) return { scripts: [], missingSriCount: 0, mixedContentCount: 0 };
  try {
    const $ = cheerio.load(htmlSample);
    const scripts = [];
    const seen = new Set();
    let missingSriCount = 0;
    let mixedContentCount = 0;

    $('script[src]').each((_, el) => {
      const rawSrc = $(el).attr('src')?.trim();
      if (!rawSrc || seen.has(rawSrc)) return;
      seen.add(rawSrc);
      let resolved;
      try {
        resolved = new URL(rawSrc, targetOrigin);
      } catch {
        return;
      }
      const isThirdParty = resolved.origin !== targetOrigin;
      const hasSri = Boolean($(el).attr('integrity')?.trim());
      const mixedContent = targetOrigin.startsWith('https://') && resolved.protocol === 'http:';
      if (isThirdParty && !hasSri) missingSriCount += 1;
      if (mixedContent) mixedContentCount += 1;
      scripts.push({
        src: resolved.toString(),
        origin: resolved.origin,
        thirdParty: isThirdParty,
        hasSri,
        mixedContent,
        crossOrigin: $(el).attr('crossorigin') || null,
      });
    });

    return {
      scripts: scripts.slice(0, 30),
      missingSriCount,
      mixedContentCount,
    };
  } catch {
    return { scripts: [], missingSriCount: 0, mixedContentCount: 0 };
  }
}

async function runWordPressPassiveChecks(origin, { fetchImpl = fetch, lookupImpl = dns.lookup } = {}) {
  const probeDefs = [
    {
      path: '/wp-json/wp/v2/users',
      id: 'wp-user-enum',
      title: 'WordPress REST user enumeration (/wp-json/wp/v2/users)',
      detectExposed: (res) =>
        res.status === 200 && /"slug"\s*:/.test(res.bodyText || ''),
    },
    {
      path: '/xmlrpc.php',
      id: 'wp-xmlrpc',
      title: 'WordPress XML-RPC endpoint (/xmlrpc.php)',
      detectExposed: (res) =>
        res.status === 200 ||
        (res.status === 405 && /xml-rpc server accepts post requests/i.test(res.bodyText || '')),
    },
    {
      path: '/readme.html',
      id: 'wp-readme',
      title: 'WordPress core version readme (/readme.html)',
      detectExposed: (res) =>
        res.status === 200 && /wordpress/i.test(res.bodyText || ''),
    },
  ];

  const probes = await Promise.all(
    probeDefs.map(async (def) => {
      try {
        const res = await fetchPublicUrlWithSafeRedirects(`${origin}${def.path}`, {
          fetchImpl,
          lookupImpl,
          timeoutMs: 3500,
          maxRedirects: 2,
          maxBytes: 40_000,
          headers: { 'User-Agent': THREAT_UA, Accept: 'application/json,text/html,*/*' },
        });
        const exposed = def.detectExposed(res);
        return {
          id: def.id,
          path: def.path,
          title: def.title,
          status: res.status,
          exposed,
        };
      } catch {
        return {
          id: def.id,
          path: def.path,
          title: def.title,
          status: 0,
          exposed: false,
        };
      }
    }),
  );

  return probes;
}

/**
 * Runs passive ASM & CTI checks adapted from feat/business-website-auditools:server/asmScanner.ts
 * plus automatic read-only WordPress hygiene probes when WordPress is detected.
 */
export async function runThreatIntelAudit(targetUrl, options = {}) {
  const {
    webCheckResult = null,
    htmlSample = '',
    timeoutMs = 5500,
    enableExternalCti = true,
    fetchImpl = fetch,
    lookupImpl = dns.lookup,
  } = options;

  const startedAt = Date.now();
  const parsedUrl = await assertPublicHttpUrl(targetUrl, { lookupImpl });
  const domain = parsedUrl.hostname.toLowerCase();
  const origin = parsedUrl.origin;

  const effectiveHtml = htmlSample || webCheckResult?._htmlSample || '';
  const detectedCms = webCheckResult?.detectedCms || 'custom';

  const [subdomains, wpProbes] = await Promise.all([
    enableExternalCti ? fetchCrtShSubdomains(domain, { fetchImpl, timeoutMs }) : Promise.resolve([]),
    detectedCms === 'wordpress'
      ? runWordPressPassiveChecks(origin, { fetchImpl, lookupImpl })
      : Promise.resolve([]),
  ]);

  const dnsSummary = webCheckResult?.dns || {};
  const spfPresent = Boolean(dnsSummary.spfPresent);
  const spfStrict = Boolean(dnsSummary.spfRecord && /-all/i.test(dnsSummary.spfRecord));
  const dmarcPresent = Boolean(dnsSummary.dmarcPresent);
  const dmarcPolicy = dnsSummary.dmarcPolicy || null;

  const supplyChain = inspectSupplyChainScripts(effectiveHtml, origin);
  const findings = [];

  if (!spfPresent) {
    findings.push({
      id: 'ti-email-no-spf',
      pillar: 'security',
      severity: 'medium',
      title: 'Missing SPF DNS TXT record (email spoofing risk)',
      evidence: `No v=spf1 record found on ${domain}`,
      remediation: 'Publish a TXT SPF policy restricting authorized outbound mail servers with -all or ~all.',
    });
  } else if (!spfStrict) {
    findings.push({
      id: 'ti-email-softfail-spf',
      pillar: 'security',
      severity: 'low',
      title: 'SPF policy does not enforce hardfail (-all)',
      evidence: dnsSummary.spfRecord || 'SPF record uses softfail (~all) or neutral qualifier.',
      remediation: 'Audit mail senders and tighten the SPF qualifier to -all where possible.',
    });
  }

  if (!dmarcPresent) {
    findings.push({
      id: 'ti-email-no-dmarc',
      pillar: 'security',
      severity: 'high',
      title: 'Missing DMARC policy (_dmarc TXT record)',
      evidence: `No v=DMARC1 record found on _dmarc.${domain}`,
      remediation: 'Configure DMARC starting with p=quarantine or p=reject and aggregate reporting (rua).',
    });
  } else if (dmarcPolicy === 'none') {
    findings.push({
      id: 'ti-email-dmarc-none',
      pillar: 'security',
      severity: 'medium',
      title: 'DMARC record is in monitor-only mode (p=none)',
      evidence: `DMARC policy resolved as p=${dmarcPolicy}`,
      remediation: 'Progress DMARC enforcement to p=quarantine or p=reject to block spoofed mail.',
    });
  }

  if (supplyChain.mixedContentCount > 0) {
    findings.push({
      id: 'ti-mixed-content-scripts',
      pillar: 'security',
      severity: 'high',
      title: `${supplyChain.mixedContentCount} insecure http:// script reference(s) on HTTPS origin`,
      evidence: supplyChain.scripts
        .filter((s) => s.mixedContent)
        .slice(0, 3)
        .map((s) => s.src)
        .join(', '),
      remediation: 'Serve all script assets over HTTPS.',
    });
  }

  if (supplyChain.missingSriCount > 0) {
    findings.push({
      id: 'ti-missing-sri',
      pillar: 'security',
      severity: 'medium',
      title: `${supplyChain.missingSriCount} third-party script(s) loaded without Subresource Integrity (SRI)`,
      evidence: supplyChain.scripts
        .filter((s) => s.thirdParty && !s.hasSri)
        .slice(0, 3)
        .map((s) => s.origin)
        .join(', '),
      remediation: 'Self-host third-party CDN scripts or attach integrity="sha384-..." and crossorigin="anonymous".',
    });
  }

  let wpExposedCount = 0;
  for (const probe of wpProbes) {
    if (probe.exposed) {
      wpExposedCount += 1;
      findings.push({
        id: `ti-${probe.id}`,
        pillar: 'security',
        severity: probe.id === 'wp-user-enum' ? 'high' : 'medium',
        title: `${probe.title} is publicly exposed`,
        evidence: `${origin}${probe.path} returned HTTP ${probe.status}`,
        remediation:
          probe.id === 'wp-user-enum'
            ? 'Restrict /wp-json/wp/v2/users to authenticated users.'
            : probe.id === 'wp-xmlrpc'
              ? 'Disable xmlrpc.php at Nginx/Apache or Cloudflare WAF.'
              : 'Delete or block public access to /readme.html.',
      });
    }
  }

  let threatScore = 100;
  if (!spfPresent) threatScore -= 15;
  else if (!spfStrict) threatScore -= 5;
  if (!dmarcPresent) threatScore -= 25;
  else if (dmarcPolicy === 'none') threatScore -= 10;
  if (supplyChain.mixedContentCount > 0) threatScore -= 20;
  if (supplyChain.missingSriCount > 0) threatScore -= Math.min(18, supplyChain.missingSriCount * 4);
  if (wpExposedCount > 0) threatScore -= Math.min(24, wpExposedCount * 10);
  threatScore = Math.max(0, Math.min(100, threatScore));

  const cmsScore =
    detectedCms === 'wordpress'
      ? Math.max(0, 100 - wpExposedCount * 18)
      : 100;

  return {
    domain,
    subdomains,
    emailAuth: {
      spfPresent,
      spfStrict,
      dmarcPresent,
      dmarcPolicy,
    },
    supplyChainScripts: supplyChain.scripts,
    missingSriCount: supplyChain.missingSriCount,
    mixedContentCount: supplyChain.mixedContentCount,
    cmsAudit: {
      detectedCms,
      probes: wpProbes,
      checklist: detectedCms === 'wordpress' ? WORDPRESS_AUDIT_CHECKLIST : [],
    },
    threatScore,
    cmsScore,
    durationMs: Math.max(1, Date.now() - startedAt),
    findings,
  };
}
