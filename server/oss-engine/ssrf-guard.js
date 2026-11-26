import dns from 'node:dns/promises';
import net from 'node:net';

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
]);

/**
 * Checks whether a canonical or mapped IPv4/IPv6 address belongs to a private,
 * loopback, link-local, metadata, CGNAT, ULA, or reserved network range.
 */
export function isPrivateIp(ip) {
  if (typeof ip !== 'string') return true;
  const cleaned = ip.trim().split('%')[0];
  if (!cleaned) return true;

  if (net.isIPv4(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // Link-local & cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
    if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  const lower = cleaned.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    if (net.isIPv4(mapped)) {
      return isPrivateIp(mapped);
    }
    const hexPair = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexPair) {
      const hi = Number.parseInt(hexPair[1], 16);
      const lo = Number.parseInt(hexPair[2], 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIp(ipv4);
    }
    return true;
  }

  if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') {
    return true;
  }
  // Unique Local Addresses fc00::/7 (fc.. / fd..)
  if (/^f[cd][0-9a-f]{0,2}:/i.test(lower)) return true;
  // Link-local fe80::/10 (fe80..febf)
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
  // Multicast ff00::/8
  if (lower.startsWith('ff')) return true;

  // Embedded IPv4-compatible ::<hex>:<hex> or 6to4 2002::/16 containing private IPv4
  if (lower.startsWith('2002:')) {
    const segments = lower.split(':');
    if (segments.length >= 3 && segments[1] && segments[2]) {
      const hi = Number.parseInt(segments[1], 16);
      const lo = Number.parseInt(segments[2], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const embeddedIpv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        if (isPrivateIp(embeddedIpv4)) return true;
      }
    }
  }

  return false;
}

/**
 * Validates that a URL uses public HTTP(S), carries no embedded credentials,
 * is not a local/internal hostname, and resolves solely to public IP addresses.
 */
export async function assertPublicHttpUrl(rawUrl, options = {}) {
  const { lookupImpl = dns.lookup } = options;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('Enter a valid public http:// or https:// URL.');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Enter a valid public http:// or https:// URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs containing embedded credentials are not allowed.');
  }

  const rawHost = parsed.hostname.toLowerCase();
  const host =
    rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;

  if (
    !host ||
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa')
  ) {
    throw new Error('Private or internal hosts cannot be audited.');
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new Error('Private, loopback, or metadata IP addresses are blocked.');
    }
    return parsed;
  }

  let resolved = [];
  try {
    const res = await lookupImpl(host, { all: true });
    resolved = Array.isArray(res) ? res : res ? [res] : [];
  } catch {
    resolved = [];
  }

  if (resolved.length === 0) {
    throw new Error(`Could not resolve public DNS for "${host}".`);
  }

  for (const entry of resolved) {
    const addr = typeof entry === 'string' ? entry : entry?.address;
    if (!addr || isPrivateIp(addr)) {
      throw new Error('Target host resolves to a restricted private or loopback IP range.');
    }
  }

  return parsed;
}

/**
 * Resolves a public URL to its validated URL object and public IP addresses.
 */
export async function resolvePublicTarget(rawUrl, options = {}) {
  const { lookupImpl = dns.lookup } = options;
  const parsed = await assertPublicHttpUrl(rawUrl, { lookupImpl });
  const rawHost = parsed.hostname.toLowerCase();
  const host =
    rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (net.isIP(host)) {
    return { url: parsed, host, addresses: [host] };
  }
  const resolved = await lookupImpl(host, { all: true });
  const addresses = (Array.isArray(resolved) ? resolved : [resolved])
    .map((e) => (typeof e === 'string' ? e : e?.address))
    .filter(Boolean);
  return { url: parsed, host, addresses };
}

async function readResponseTextBounded(response, maxBytes) {
  if (!response?.body || typeof response.body.getReader !== 'function') {
    const text = await response.text().catch(() => '');
    return text.slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    // Return partial body read up to error
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

function normalizeHeadersObject(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  } else if (typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined) {
        out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      }
    }
  }
  return out;
}

function extractSetCookieList(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const raw = typeof headers.get === 'function' ? headers.get('set-cookie') : headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [String(raw)];
}

/**
 * Fetches an external HTTP(S) resource while enforcing SSRF checks on the initial URL
 * and on every manual redirect hop up to maxRedirects.
 */
export async function fetchPublicUrlWithSafeRedirects(rawUrl, options = {}) {
  const {
    maxRedirects = 5,
    timeoutMs = 10000,
    maxBytes = 2_000_000,
    headers = {},
    method = 'GET',
    fetchImpl = fetch,
    lookupImpl = dns.lookup,
    signal: externalSignal,
  } = options;

  let currentUrl = await assertPublicHttpUrl(rawUrl, { lookupImpl });
  const initialUrl = currentUrl.toString();
  const redirectChain = [];
  const startedAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      throw new Error('Request aborted.');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await fetchImpl(currentUrl.toString(), {
        method,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });

      const location = response.headers?.get?.('location') || '';
      if (!REDIRECT_STATUS_CODES.has(response.status)) {
        const bodyText =
          method.toUpperCase() === 'HEAD'
            ? ''
            : await readResponseTextBounded(response, maxBytes);
        return {
          initialUrl,
          finalUrl: currentUrl.toString(),
          status: response.status,
          statusText: response.statusText || '',
          headers: normalizeHeadersObject(response.headers),
          setCookieHeaders: extractSetCookieList(response.headers),
          bodyText,
          redirectChain,
          elapsedMs: Math.max(1, Date.now() - startedAt),
        };
      }

      // Drain body of redirect response before moving on
      await response.body?.cancel?.().catch(() => undefined);

      if (!location) {
        throw new Error(`Remote server returned HTTP ${response.status} redirect without a Location header.`);
      }
      if (hop === maxRedirects) {
        throw new Error(`Exceeded maximum redirect limit (${maxRedirects} hops).`);
      }

      const nextTarget = new URL(location, currentUrl);
      const nextUrl = await assertPublicHttpUrl(nextTarget.toString(), { lookupImpl });
      redirectChain.push({
        hop: hop + 1,
        from: currentUrl.toString(),
        to: nextUrl.toString(),
        status: response.status,
      });
      currentUrl = nextUrl;
    }

    throw new Error('Exceeded maximum redirect limit.');
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
