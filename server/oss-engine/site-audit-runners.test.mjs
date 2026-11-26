import { describe, expect, it } from 'vitest'
import { runWebCheckAudit } from './web-check-runner.js'
import { runSiteCrawlAudit, serializeSiteCrawlToCsv } from './siteone-runner.js'
import { runThreatIntelAudit } from './threat-intel-runner.js'
import { checkWidgetRateLimit, clearWidgetRateLimits } from './site-audit-orchestrator.js'

const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34', family: 4 }]

describe('PR 5 deterministic site-audit engines', () => {
  it('evaluates headers, cookies, llms.txt GEO readiness, and WordPress detection in web-check-runner', async () => {
    const wpHtml = `<!doctype html>
      <html>
        <head>
          <title>Acme WP Site</title>
          <meta name="generator" content="WordPress 6.7" />
          <link rel="stylesheet" href="/wp-content/themes/acme/style.css" />
        </head>
        <body><h1>Hello Acme</h1></body>
      </html>`

    const fetchMock = async (url) => {
      if (url === 'https://acme-example.org/') {
        return new Response(wpHtml, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'strict-transport-security': 'max-age=31536000; includeSubDomains',
            'x-content-type-options': 'nosniff',
            'set-cookie': 'session=abc; Path=/',
          },
        })
      }
      if (url === 'https://acme-example.org/robots.txt') {
        return new Response('User-agent: GPTBot\nDisallow: /\nSitemap: https://acme-example.org/sitemap.xml\n', {
          status: 200,
        })
      }
      if (url === 'https://acme-example.org/sitemap.xml') {
        return new Response('<urlset><url><loc>https://acme-example.org/</loc></url></urlset>', {
          status: 200,
        })
      }
      if (url === 'https://acme-example.org/llms.txt') {
        return new Response('# Acme Docs\n> Documentation for LLM assistants\n- [Home](https://acme-example.org/)', {
          status: 200,
        })
      }
      return new Response('Not Found', { status: 404 })
    }

    const res = await runWebCheckAudit('https://acme-example.org/', {
      fetchImpl: fetchMock,
      lookupImpl: PUBLIC_LOOKUP,
      dnsResolvers: {
        resolve4: async () => ['93.184.216.34'],
        resolve6: async () => [],
        resolveMx: async () => [{ exchange: 'mail.acme-example.org', priority: 10 }],
        resolveTxt: async (h) =>
          h.startsWith('_dmarc.')
            ? [['v=DMARC1; p=reject;']]
            : [['v=spf1 include:_spf.acme-example.org -all']],
        resolveNs: async () => ['ns1.acme-example.org'],
        resolveCname: async () => [],
        resolveSoa: async () => null,
      },
      tlsConnectImpl: async ({ host }) => ({
        enabled: true,
        host,
        protocol: 'TLSv1.3',
        cipher: 'TLS_AES_256_GCM_SHA384',
        authorized: true,
        authorizationError: null,
        issuer: "Let's Encrypt",
        subject: host,
        validFrom: '2026-01-01',
        validTo: '2027-01-01',
        daysRemaining: 90,
        elapsedMs: 12,
      }),
    })

    expect(res.detectedCms).toBe('wordpress')
    expect(res.techStack).toContain('WordPress')
    expect(res.geo.llmsTxtPresent).toBe(true)
    expect(res.geo.robotsTxtPresent).toBe(true)
    expect(res.geo.sitemapXmlPresent).toBe(true)
    expect(res.geo.aiBots.find((b) => b.bot === 'GPTBot')?.status).toBe('blocked')
    expect(res.securityHeaders.matrix.find((h) => h.header === 'strict-transport-security')?.present).toBe(true)
    expect(res.securityHeaders.matrix.find((h) => h.header === 'content-security-policy')?.present).toBe(false)
    expect(res.cookies[0].warnings.length).toBeGreaterThan(0)
  })

  it('crawls internal pages with Cheerio BFS fallback, flags SEO issues, and exports CSV', async () => {
    const pagesMap = {
      'https://crawl-demo.org/': {
        status: 200,
        body: `<html><head><title>Shared Title</title></head><body>
          <h1>Home</h1>
          <img src="/hero.png" />
          <a href="/about">About</a>
          <a href="/broken">Broken</a>
        </body></html>`,
      },
      'https://crawl-demo.org/about': {
        status: 200,
        body: `<html><head><title>Shared Title</title><meta name="description" content="About page description text here" /><link rel="canonical" href="https://crawl-demo.org/about" /></head><body>
          <h1>About</h1>
        </body></html>`,
      },
      'https://crawl-demo.org/broken': {
        status: 404,
        body: '<html><head><title>Not Found</title></head><body>Not found</body></html>',
      },
    }

    const crawl = await runSiteCrawlAudit('https://crawl-demo.org/', {
      maxUrls: 10,
      maxDepth: 2,
      forceFallback: true,
      lookupImpl: PUBLIC_LOOKUP,
      fetchImpl: async (url) => {
        const hit = pagesMap[url] || { status: 404, body: '' }
        return new Response(hit.body, {
          status: hit.status,
          headers: { 'content-type': 'text/html' },
        })
      },
    })

    expect(crawl.engine).toBe('fresnel-cheerio-bfs')
    expect(crawl.crawledCount).toBe(3)
    expect(crawl.brokenCount).toBe(1)
    expect(crawl.duplicateTitleCount).toBe(1)
    expect(crawl.findings.some((f) => f.id === 'crawl-broken-urls')).toBe(true)

    const csv = serializeSiteCrawlToCsv(crawl)
    expect(csv).toContain('URL,Depth,Status,TTFB (ms)')
    expect(csv).toContain('https://crawl-demo.org/broken')
    expect(csv).toContain('broken-internal-link')
  })

  it('runs threat-intel & WordPress passive checks with WORDPRESS_AUDIT_CHECKLIST attachment', async () => {
    const html = `<html><body>
      <script src="https://cdn.example.net/sdk.js"></script>
      <script src="http://legacy.cdn.example/insecure.js"></script>
    </body></html>`

    const fetchMock = async (url) => {
      if (url.startsWith('https://crt.sh/')) {
        return new Response(JSON.stringify([{ name_value: 'app.wp-demo.org\napi.wp-demo.org' }]), {
          status: 200,
        })
      }
      if (url === 'https://wp-demo.org/wp-json/wp/v2/users') {
        return new Response(JSON.stringify([{ id: 1, slug: 'admin' }]), { status: 200 })
      }
      if (url === 'https://wp-demo.org/xmlrpc.php') {
        return new Response('XML-RPC server accepts POST requests only.', { status: 405 })
      }
      if (url === 'https://wp-demo.org/readme.html') {
        return new Response('<title>WordPress Readme</title>', { status: 200 })
      }
      return new Response('', { status: 404 })
    }

    const res = await runThreatIntelAudit('https://wp-demo.org/', {
      webCheckResult: {
        detectedCms: 'wordpress',
        dns: { spfPresent: false, spfRecord: null, dmarcPresent: false, dmarcPolicy: null },
      },
      htmlSample: html,
      enableExternalCti: true,
      fetchImpl: fetchMock,
      lookupImpl: PUBLIC_LOOKUP,
    })

    expect(res.subdomains).toEqual(['api.wp-demo.org', 'app.wp-demo.org'])
    expect(res.missingSriCount).toBe(2)
    expect(res.mixedContentCount).toBe(1)
    expect(res.cmsAudit.detectedCms).toBe('wordpress')
    expect(res.cmsAudit.probes.every((p) => p.exposed)).toBe(true)
    expect(res.cmsAudit.checklist.length).toBeGreaterThanOrEqual(8)
    expect(res.findings.some((f) => f.id === 'ti-wp-user-enum')).toBe(true)
  })

  it('enforces per-IP sliding window rate limits for public widget audits', () => {
    clearWidgetRateLimits()
    for (let i = 0; i < 10; i += 1) {
      expect(checkWidgetRateLimit('203.0.113.9', { nowMs: 1_000_000 + i }).allowed).toBe(true)
    }
    const blocked = checkWidgetRateLimit('203.0.113.9', { nowMs: 1_000_100 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
    clearWidgetRateLimits()
  })
})
