# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Stage 1: Build Vite SPA, embed widget.js, Workbox SW, and browser-ext
# ---------------------------------------------------------------------------
FROM node:22-trixie-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm run build:ext

# ---------------------------------------------------------------------------
# Stage 2: Fetch native Rust siteone-crawler v2.5.1 (amd64 & arm64 aware)
# ---------------------------------------------------------------------------
FROM node:22-trixie-slim AS siteone-fetcher
ARG TARGETARCH
ARG SITEONE_VERSION=v2.5.1

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates tar \
  && rm -rf /var/lib/apt/lists/* \
  && case "${TARGETARCH:-amd64}" in \
       amd64) ARCH="x64" ;; \
       arm64) ARCH="arm64" ;; \
       *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://github.com/janreges/siteone-crawler/releases/download/${SITEONE_VERSION}/siteone-crawler-${SITEONE_VERSION}-linux-${ARCH}.tar.gz" \
     -o /tmp/siteone.tar.gz \
  && mkdir -p /tmp/siteone \
  && tar -xzf /tmp/siteone.tar.gz -C /tmp/siteone \
  && BIN_PATH="$(find /tmp/siteone -type f -name 'siteone-crawler' | head -n 1)" \
  && install -m 0755 "${BIN_PATH}" /usr/local/bin/siteone-crawler \
  && /usr/local/bin/siteone-crawler --version \
  && rm -rf /tmp/siteone /tmp/siteone.tar.gz

# ---------------------------------------------------------------------------
# Stage 3: Production Runtime (Node 22 + Chromium + siteone-crawler + prod deps)
# ---------------------------------------------------------------------------
FROM node:22-trixie-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CHROME_PATH=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    SITEONE_BIN_PATH=/usr/local/bin/siteone-crawler \
    FRESNEL_AUTH_DATA_DIR=/data/fresnel

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-noto-color-emoji \
      ca-certificates \
      git \
      openssh-client \
      curl \
      dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/fresnel \
  && chown -R node:node /app /data/fresnel

COPY --from=siteone-fetcher /usr/local/bin/siteone-crawler /usr/local/bin/siteone-crawler

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/fresnel ./dist/fresnel
COPY --from=builder /app/dist/browser-ext ./dist/browser-ext
COPY --from=builder /app/server ./server
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/public ./public
COPY --from=builder /app/transforms ./transforms
COPY --from=builder /app/server.ts ./server.ts

# Remove test files from runtime image
RUN find /app/server -type f \( -name '*.test.*' -o -name '*.spec.*' \) -delete \
  && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/fresnel/server/server.mjs"]
