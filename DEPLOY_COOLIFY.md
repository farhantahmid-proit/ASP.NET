# Deploying Fresnel (`ASP-FTS-KB`) on Coolify

## 1. Prerequisites
- Coolify v4+ with Traefik TLS proxy
- Minimum container shared memory: **`shm_size: 1gb`** (required by headless Chromium for live Lighthouse audits)
- Persistent volume mounted at **`/data/fresnel`** (`FRESNEL_AUTH_DATA_DIR`)

## 2. Coolify Resource Setup
1. Create a new **Dockerfile** (or **Docker Compose** pointing to `docker-compose.coolify.yml`) resource from `farhantahmid-proit/ASP.NET`.
2. Set the **Port** to `3000` and assign your domain (e.g., `https://fresnel.yourdomain.com`).
3. Add a **Persistent Storage** volume mounted to `/data/fresnel`.
4. Set **Health Check** path to `/api/health` (port `3000`, expected `200`).
5. Configure environment variables:
   - `JWT_SECRET`: 32+ random bytes (`openssl rand -hex 32`)
   - `FRESNEL_CORS_ORIGINS`: comma-separated exact origins of `KnowledgeBaseAI-Web` (e.g., `https://app.yourdomain.com,https://staging.yourdomain.com`) — no trailing slashes
   - `PAGESPEED_API_KEY` *(optional)*: raises Google PageSpeed Insights v5 quota
   - `GEMINI_API_KEY` *(optional)*: enables AI Executive Summary synthesis

## 3. Traefik & SSE Streaming Notes
- `/api/audit/:id/stream` and `/api/audit/site/:id/stream` use Server-Sent Events (`text/event-stream`). Ensure any upstream proxy/CDN disables response buffering for `/api/audit/*/stream`.

## 4. Post-Deploy Smoke Tests
```bash
# 1. Readiness check (expect status: "ok", chromiumAvailable: true, siteOneAvailable: true)
curl -fsS https://fresnel.yourdomain.com/api/health

# 2. CORS preflight for allowlisted KnowledgeBaseAI-Web origin (expect HTTP 204)
curl -i -X OPTIONS https://fresnel.yourdomain.com/api/audit/site/start \
  -H "Origin: https://app.yourdomain.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Authorization, Content-Type, X-Client-Id"

# 3. Unlisted origin must NOT receive Access-Control-Allow-Origin
curl -i https://fresnel.yourdomain.com/api/engine/info \
  -H "Origin: https://evil.example.com"
```
