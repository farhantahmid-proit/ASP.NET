import { describe, it, expect } from 'vitest';
import { parseAllowedCorsOrigins, applyApiCorsHeaders } from './cors.js';
import { handleFresnelApiRequest } from './index.js';

function createMockRes() {
  const headers = new Map();
  let statusCode = null;
  let body = '';
  let ended = false;
  return {
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    writeHead(code, extraHeaders = {}) {
      statusCode = code;
      for (const [k, v] of Object.entries(extraHeaders)) {
        headers.set(k.toLowerCase(), v);
      }
    },
    end(chunk = '') {
      body += chunk;
      ended = true;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get ended() {
      return ended;
    },
    headers,
  };
}

describe('CORS & /api/health', () => {
  it('parses allowlisted origins and strips trailing slashes', () => {
    const allowed = parseAllowedCorsOrigins('https://app.example.com/, http://localhost:4179 , invalid-origin');
    expect(allowed.has('https://app.example.com')).toBe(true);
    expect(allowed.has('http://localhost:4179')).toBe(true);
    expect(allowed.size).toBe(2);
  });

  it('sets CORS headers and handles OPTIONS preflight for allowlisted origins', () => {
    const allowedOrigins = parseAllowedCorsOrigins('https://app.example.com');
    const res = createMockRes();
    const handled = applyApiCorsHeaders(
      { method: 'OPTIONS', headers: { origin: 'https://app.example.com' } },
      res,
      { pathname: '/api/audit/site/start', allowedOrigins }
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.getHeader('access-control-allow-origin')).toBe('https://app.example.com');
    expect(res.getHeader('vary')).toBe('Origin');
    expect(res.getHeader('access-control-allow-headers')).toContain('X-Client-Id');
    expect(res.getHeader('access-control-allow-headers')).toContain('Authorization');
  });

  it('omits Access-Control-Allow-Origin for unlisted origins', () => {
    const allowedOrigins = parseAllowedCorsOrigins('https://app.example.com');
    const res = createMockRes();
    const handled = applyApiCorsHeaders(
      { method: 'GET', headers: { origin: 'https://evil.example.com' } },
      res,
      { pathname: '/api/engine/info', allowedOrigins }
    );
    expect(handled).toBe(false);
    expect(res.getHeader('access-control-allow-origin')).toBeUndefined();
  });

  it('allows cross-origin requests on public widget endpoints', () => {
    const allowedOrigins = new Set();
    const res = createMockRes();
    const handled = applyApiCorsHeaders(
      { method: 'POST', headers: { origin: 'https://thirdparty.example.com' } },
      res,
      { pathname: '/api/widget/pk_test123/audit', allowedOrigins }
    );
    expect(handled).toBe(false);
    expect(res.getHeader('access-control-allow-origin')).toBe('*');
  });

  it('serves GET /api/health with readiness status JSON', async () => {
    const res = createMockRes();
    const handled = await handleFresnelApiRequest(
      { method: 'GET', url: '/api/health', headers: { host: '127.0.0.1:3000' } },
      res
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.status).toBe('ok');
    expect(payload.service).toBe('fresnel');
    expect(typeof payload.uptimeSec).toBe('number');
    expect(typeof payload.chromiumAvailable).toBe('boolean');
    expect(typeof payload.siteOneAvailable).toBe('boolean');
    expect(payload.nodeVersion).toBe(process.version);
  });
});
