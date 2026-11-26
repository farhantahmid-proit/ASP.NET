/**
 * CORS allowlist & preflight helpers for Fresnel API routes.
 */

const PUBLIC_WIDGET_RE = /^\/api\/widget\/[^/]+\/(?:audit|meta)$/;

/**
 * Parses `FRESNEL_CORS_ORIGINS` (comma-separated) into a normalized Set of
 * http(s) origins (trailing slashes stripped). Supports `*` if explicitly set.
 */
export function parseAllowedCorsOrigins(raw = process.env.FRESNEL_CORS_ORIGINS) {
  const allowed = new Set();
  if (!raw || typeof raw !== 'string') return allowed;

  for (const part of raw.split(',')) {
    const trimmed = part.trim().replace(/\/+$/, '');
    if (!trimmed) continue;
    if (trimmed === '*') {
      allowed.add('*');
      continue;
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        allowed.add(parsed.origin);
      }
    } catch {
      // Ignore malformed origin entries
    }
  }
  return allowed;
}

/**
 * Applies CORS headers on `/api/*` requests and handles `OPTIONS` preflight.
 * Returns `true` if the response was already completed (preflight), else `false`.
 */
export function applyApiCorsHeaders(req, res, { pathname, allowedOrigins } = {}) {
  if (!pathname || !pathname.startsWith('/api/')) {
    return false;
  }

  const originHeader = typeof req.headers?.origin === 'string' ? req.headers.origin.trim() : '';
  const isPublicWidget = PUBLIC_WIDGET_RE.test(pathname);
  const origins = allowedOrigins instanceof Set ? allowedOrigins : new Set();

  if (isPublicWidget) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  } else if (originHeader) {
    const normalizedOrigin = originHeader.replace(/\/+$/, '');
    if (origins.has('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client-Id');
      res.setHeader('Access-Control-Max-Age', '86400');
    } else if (origins.has(normalizedOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', normalizedOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client-Id');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
