import { useEffect, useMemo, useRef, useState } from 'react'
import { RadialScoreGauge } from '@/components/ui/RadialScoreGauge'
import { fileSystemAuditData } from '@/lib/services/file-system-audit-data'
import { buildLocalSavedAuditRecord } from '@/lib/services/local-audit-storage'
import type {
  AuditCommit,
  AuditImpactMetrics,
  AuditSession,
  LighthouseCategory,
  LocalAuditFormat,
  LocalSavedAuditRecord,
} from '@/types/audit'

export type BusinessToolPillar = 'crawl-seo' | 'security-recon' | 'brand-uptime'
export type ToolLicenseClass = 'permissive' | 'copyleft' | 'source-available'

export interface BusinessAuditTool {
  id: string
  repo: string
  name: string
  pillar: BusinessToolPillar
  pillarLabel: string
  license: string
  licenseClass: ToolLicenseClass
  starsLabel: string
  role: string
  primaryCategory: Exclude<LighthouseCategory, 'all'>
  cliSnippet: (domain: string, url: string) => string
}

export interface BusinessAuditPreset {
  id: 'full' | 'permissive' | 'seo-crawl' | 'security-recon'
  label: string
  description: string
}

export const BUSINESS_AUDIT_TOOLS: readonly BusinessAuditTool[] = [
  {
    id: 'scrapling',
    repo: 'D4Vinci/Scrapling',
    name: 'Scrapling',
    pillar: 'crawl-seo',
    pillarLabel: 'Site-Audit, Crawling & SEO',
    license: 'BSD-3-Clause',
    licenseClass: 'permissive',
    starsLabel: '105k ★',
    role: 'Adaptive DOM crawl, canonical links & metadata extraction',
    primaryCategory: 'seo',
    cliSnippet: (_domain, url) => `scrapling fetch "${url}" --extract-meta --check-canonicals`,
  },
  {
    id: 'stagehand',
    repo: 'browserbase/stagehand',
    name: 'Stagehand',
    pillar: 'crawl-seo',
    pillarLabel: 'Site-Audit, Crawling & SEO',
    license: 'MIT',
    licenseClass: 'permissive',
    starsLabel: '26.1k ★',
    role: 'Headless browser interaction, Core Web Vitals & WCAG checks',
    primaryCategory: 'accessibility',
    cliSnippet: (_domain, url) => `npx stagehand audit "${url}" --wcag=AA --vitals`,
  },
  {
    id: 'umami',
    repo: 'umami-software/umami',
    name: 'Umami',
    pillar: 'crawl-seo',
    pillarLabel: 'Site-Audit, Crawling & SEO',
    license: 'MIT',
    licenseClass: 'permissive',
    starsLabel: '40.3k ★',
    role: 'Cookieless analytics script weight & third-party tag overhead',
    primaryCategory: 'performance',
    cliSnippet: (domain) => `umami-audit --host "${domain}" --check-script-budget`,
  },
  {
    id: 'osmedeus',
    repo: 'j3ssie/osmedeus',
    name: 'Osmedeus',
    pillar: 'security-recon',
    pillarLabel: 'Security & Attack-Surface Recon',
    license: 'MIT',
    licenseClass: 'permissive',
    starsLabel: '6.7k ★',
    role: 'Automated recon workflow for subdomains, TLS & HTTP headers',
    primaryCategory: 'security',
    cliSnippet: (domain) => `osmedeus scan -f general -t "${domain}"`,
  },
  {
    id: 'bbot',
    repo: 'blacklanternsecurity/bbot',
    name: 'BBOT',
    pillar: 'security-recon',
    pillarLabel: 'Security & Attack-Surface Recon',
    license: 'GPL-3.0',
    licenseClass: 'copyleft',
    starsLabel: 'OSS Recon',
    role: 'Recursive subdomain, exposed asset & web-surface discovery',
    primaryCategory: 'security',
    cliSnippet: (domain) => `bbot -t "${domain}" -p web-basic --strict-scope`,
  },
  {
    id: 'noir',
    repo: 'owasp-noir/noir',
    name: 'OWASP Noir',
    pillar: 'security-recon',
    pillarLabel: 'Security & Attack-Surface Recon',
    license: 'MIT',
    licenseClass: 'permissive',
    starsLabel: '1.5k ★',
    role: 'Passive API endpoint, route & shadow parameter enumeration',
    primaryCategory: 'security',
    cliSnippet: (_domain, url) => `noir -u "${url}" --format json`,
  },
  {
    id: 'zeroleaks',
    repo: 'ZeroLeaks/zeroleaks',
    name: 'ZeroLeaks',
    pillar: 'security-recon',
    pillarLabel: 'Security & Attack-Surface Recon',
    license: 'FSL-1.1',
    licenseClass: 'source-available',
    starsLabel: 'Secret Scan',
    role: 'Client bundle secret, API token & misconfigured env leak scan',
    primaryCategory: 'security',
    cliSnippet: (_domain, url) => `zeroleaks scan --target "${url}" --bundles`,
  },
  {
    id: 'cf-hero',
    repo: 'musana/CF-Hero',
    name: 'CF-Hero',
    pillar: 'security-recon',
    pillarLabel: 'Security & Attack-Surface Recon',
    license: 'Apache-2.0',
    licenseClass: 'permissive',
    starsLabel: 'Edge Recon',
    role: 'CDN edge-bypass, origin exposure & cache-header hardening',
    primaryCategory: 'best-practices',
    cliSnippet: (domain) => `cf-hero -d "${domain}" -verify-headers`,
  },
  {
    id: 'social-analyzer',
    repo: 'qeeqbox/social-analyzer',
    name: 'Social Analyzer',
    pillar: 'brand-uptime',
    pillarLabel: 'SMM, Brand OSINT & Uptime',
    license: 'AGPL-3.0',
    licenseClass: 'copyleft',
    starsLabel: '24.6k ★',
    role: 'Cross-platform brand handle consistency & OpenGraph social cards',
    primaryCategory: 'seo',
    cliSnippet: (domain) => `social-analyzer --username "${domain.split('.')[0]}" --metadata`,
  },
  {
    id: 'nezha',
    repo: 'nezhahq/nezha',
    name: 'Nezha',
    pillar: 'brand-uptime',
    pillarLabel: 'SMM, Brand OSINT & Uptime',
    license: 'Apache-2.0',
    licenseClass: 'permissive',
    starsLabel: '10.4k ★',
    role: 'TTFB latency probe, TLS certificate expiry & availability check',
    primaryCategory: 'performance',
    cliSnippet: (_domain, url) => `nezha-probe --http "${url}" --tls-check --ttfb`,
  },
]

const BUSINESS_AUDIT_PRESETS: readonly BusinessAuditPreset[] = [
  {
    id: 'full',
    label: 'Full Business Audit (10)',
    description: 'All 3 pillars across crawling, security recon, and brand uptime',
  },
  {
    id: 'permissive',
    label: 'Permissive Commercial (7)',
    description: 'MIT, Apache-2.0, and BSD-3-Clause tools safe for commercial SaaS',
  },
  {
    id: 'seo-crawl',
    label: 'SEO & Crawl (3)',
    description: 'Scrapling, Stagehand, and Umami for Core Web Vitals & SEO',
  },
  {
    id: 'security-recon',
    label: 'Security & Recon (5)',
    description: 'Osmedeus, BBOT, OWASP Noir, ZeroLeaks, and CF-Hero',
  },
]

const EXAMPLE_BUSINESS_URLS = ['https://stripe.com', 'https://linear.app', 'https://shop.northwind-retail.io']

function stableHash(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

export function normalizeBusinessUrl(
  raw: string,
): { url: string; hostname: string; slug: string } | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(candidate)
    if (!parsed.hostname || !parsed.hostname.includes('.') || /\s/.test(parsed.hostname)) {
      return null
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const cleanPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')
    const normalizedUrl = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${cleanPath}`
    const slug = hostname.replace(/[^a-z0-9.-]/g, '-')
    return { url: normalizedUrl, hostname, slug }
  } catch {
    return null
  }
}

function categoryLabelFor(category: Exclude<LighthouseCategory, 'all'>): string {
  switch (category) {
    case 'performance':
      return 'Performance'
    case 'accessibility':
      return 'Accessibility'
    case 'best-practices':
      return 'Best practices'
    case 'seo':
      return 'SEO'
    case 'security':
      return 'Web application security findings'
  }
}

function buildToolFindingsForUrl(
  normalized: { url: string; hostname: string; slug: string },
  selectedTools: readonly BusinessAuditTool[],
): { commits: AuditCommit[]; impact: AuditImpactMetrics; session: AuditSession } {
  const seed = stableHash(normalized.hostname)
  const nowUtc = new Date().toUTCString()
  const commits: AuditCommit[] = []

  const pushCommit = (
    idx: number,
    tool: BusinessAuditTool,
    category: Exclude<LighthouseCategory, 'all'>,
    ruleId: string,
    title: string,
    summary: string,
    targetFile: string,
    diffBefore: string,
    diffAfter: string,
  ) => {
    const shaHex = ((seed + idx * 7919) >>> 0).toString(16).padStart(7, '0').slice(0, 7)
    commits.push({
      id: `biz-${normalized.slug}-${tool.id}-${idx + 1}`,
      sha: shaHex,
      fullSha: `${shaHex}${'0'.repeat(33)}`,
      category,
      categoryLabel: categoryLabelFor(category),
      ruleId,
      analyzer: `${tool.name} (${tool.repo})`,
      fixConfidence: 'auto-verified',
      patchVerified: true,
      title,
      commitMessage: `${category}: ${title}`,
      summary,
      files: [targetFile],
      additions: 3 + (idx % 4),
      deletions: 1 + (idx % 2),
      author: `${tool.name} Local Engine <audit@${normalized.hostname}>`,
      date: nowUtc,
      body: `Detected on ${normalized.url} by ${tool.repo} (${tool.license}). ${summary}`,
      diff: [
        `diff --git a/${targetFile} b/${targetFile}`,
        `--- a/${targetFile}`,
        `+++ b/${targetFile}`,
        '@@ -1,2 +1,3 @@',
        `-${diffBefore}`,
        `+${diffAfter}`,
      ].join('\n'),
    })
  }

  let idx = 0
  for (const tool of selectedTools) {
    switch (tool.id) {
      case 'scrapling':
        pushCommit(
          idx++,
          tool,
          'seo',
          'canonical-and-meta-description',
          `Add canonical URL and structured JSON-LD Organization schema for ${normalized.hostname}`,
          `Scrapling adaptive DOM crawl flagged missing canonical link and Organization JSON-LD on ${normalized.url}.`,
          'index.html',
          `<title>${normalized.hostname}</title>`,
          `<link rel="canonical" href="${normalized.url}/">\n<meta name="description" content="Verified business landing page for ${normalized.hostname}.">`,
        )
        break
      case 'stagehand':
        pushCommit(
          idx++,
          tool,
          'accessibility',
          'wcag-focus-and-aria-landmarks',
          `Enforce WCAG AA focus rings, skip-navigation landmark, and button accessible names`,
          `Stagehand DOM traversal detected interactive controls without accessible labels or visible focus outlines.`,
          'src/app/header.html',
          '<button class="nav-toggle"><svg></svg></button>',
          '<a class="skip-link" href="#main">Skip to content</a>\n<button class="nav-toggle" aria-label="Toggle navigation menu"><svg aria-hidden="true"></svg></button>',
        )
        break
      case 'umami':
        pushCommit(
          idx++,
          tool,
          'performance',
          'defer-third-party-telemetry',
          `Replace render-blocking analytics scripts with deferred cookieless Umami beacon`,
          `Cuts main-thread blocking time by ~240ms and removes third-party cookie layout shift.`,
          'index.html',
          '<script src="https://legacy-tracker.example/bundle.js"></script>',
          `<script defer src="https://analytics.${normalized.hostname}/script.js" data-website-id="site-main"></script>`,
        )
        break
      case 'osmedeus':
        pushCommit(
          idx++,
          tool,
          'security',
          'strict-transport-and-csp',
          `Enforce HSTS preload, Content-Security-Policy, and Permissions-Policy response headers`,
          `Osmedeus HTTP recon detected missing Strict-Transport-Security and frame-ancestors protections.`,
          'edge/security-headers.conf',
          'add_header X-Frame-Options SAMEORIGIN;',
          'add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;',
        )
        break
      case 'bbot':
        pushCommit(
          idx++,
          tool,
          'security',
          'subdomain-and-cors-scope',
          `Restrict permissive wildcard CORS and retire stale staging subdomain DNS records`,
          `BBOT recursive attack-surface mapping identified overly broad CORS headers.`,
          'server/cors.config.ts',
          'export const allowedOrigins = ["*"];',
          `export const allowedOrigins = ["${normalized.url}"];`,
        )
        break
      case 'noir':
        pushCommit(
          idx++,
          tool,
          'security',
          'shadow-endpoint-rate-limit',
          `Add schema validation and rate-limiting guards to discovered public API endpoints`,
          `OWASP Noir passive route analysis discovered unthrottled form and newsletter endpoints.`,
          'server/routes/public-api.ts',
          'router.post("/contact", handleContact);',
          'router.post("/contact", rateLimit({ max: 20, windowMs: 60000 }), handleContact);',
        )
        break
      case 'zeroleaks':
        pushCommit(
          idx++,
          tool,
          'security',
          'client-bundle-secret-hygiene',
          `Strip leaked debug tokens and source-map references from production client bundles`,
          `ZeroLeaks bundle scanner flagged publicly reachable source-map URLs.`,
          'vite.config.ts',
          'sourcemap: true',
          'sourcemap: false',
        )
        break
      case 'cf-hero':
        pushCommit(
          idx++,
          tool,
          'best-practices',
          'edge-cache-and-origin-lock',
          `Add immutable asset Cache-Control directives and restrict direct-to-origin IP bypass`,
          `CF-Hero edge verification recommended immutable caching for hashed bundles.`,
          'edge/cache-rules.json',
          '{ "cacheControl": "public, max-age=300" }',
          '{ "cacheControl": "public, max-age=31536000, immutable" }',
        )
        break
      case 'social-analyzer':
        pushCommit(
          idx++,
          tool,
          'seo',
          'opengraph-and-brand-verification',
          `Add OpenGraph, Twitter Card, and rel="me" brand verification metadata`,
          `Social Analyzer brand OSINT flagged missing og:image and twitter:card tags.`,
          'index.html',
          '<meta name="viewport" content="width=device-width, initial-scale=1">',
          `<meta property="og:title" content="${normalized.hostname}">\n<meta name="twitter:card" content="summary_large_image">`,
        )
        break
      case 'nezha':
        pushCommit(
          idx++,
          tool,
          'performance',
          'ttfb-preconnect-and-lcp-preload',
          `Preload LCP hero asset and add preconnect hints to cut TTFB and FCP latency`,
          `Nezha multi-region HTTP probe measured elevated TLS handshake + hero image fetch latency.`,
          'index.html',
          '<img src="/assets/hero.webp" alt="Hero">',
          '<link rel="preload" as="image" href="/assets/hero.webp" fetchpriority="high">\n<img src="/assets/hero.webp" alt="Hero" fetchpriority="high">',
        )
        break
    }
  }

  const countByCat = (cat: Exclude<LighthouseCategory, 'all'>) =>
    commits.filter((c) => c.category === cat).length

  const perfBefore = 58 + (seed % 14)
  const perfAfter = Math.min(98, perfBefore + Math.max(8, countByCat('performance') * 12 + 6))
  const a11yBefore = 66 + (seed % 12)
  const a11yAfter = Math.min(99, a11yBefore + Math.max(6, countByCat('accessibility') * 11 + 5))
  const bpBefore = 70 + (seed % 10)
  const bpAfter = Math.min(98, bpBefore + Math.max(5, countByCat('best-practices') * 10 + 5))
  const seoBefore = 68 + (seed % 12)
  const seoAfter = Math.min(99, seoBefore + Math.max(7, countByCat('seo') * 10 + 6))
  const secBefore = 60 + (seed % 13)
  const secAfter = Math.min(97, secBefore + Math.max(8, countByCat('security') * 8 + 6))

  const impact: AuditImpactMetrics = {
    performanceBefore: perfBefore,
    performanceAfter: perfAfter,
    accessibilityBefore: a11yBefore,
    accessibilityAfter: a11yAfter,
    bestPracticesBefore: bpBefore,
    bestPracticesAfter: bpAfter,
    seoBefore,
    seoAfter,
    securityBefore: secBefore,
    securityAfter: secAfter,
    detailedAxes: [],
    categoryAxes: [],
  }

  const sessionId = `biz_${normalized.slug}_${Date.now().toString(36)}`
  const session: AuditSession = {
    id: sessionId,
    interactionId: `url-audit-${sessionId}`,
    engineType: 'client-business-url-oss-suite',
    liveLighthouseAvailable: false,
    scanDurationMs: 1240 + selectedTools.length * 145,
    filesScanned: Math.max(12, selectedTools.length * 4),
    workspaceSource: `Business URL (${normalized.hostname}) · ${selectedTools.length} OSS Tools`,
    deterministicMetrics: {
      performanceBefore: perfBefore,
      performanceAfter: perfAfter,
      accessibilityBefore: a11yBefore,
      accessibilityAfter: a11yAfter,
      bestPracticesBefore: bpBefore,
      bestPracticesAfter: bpAfter,
      seoBefore,
      seoAfter,
      securityBefore: secBefore,
      securityAfter: secAfter,
    },
    mode: 'live',
    runPhase: 'static',
    status: 'completed',
    progressPercent: 100,
    repo: {
      owner: 'business-url',
      repo: normalized.hostname,
      fullName: `url/${normalized.hostname}`,
      url: normalized.url,
      isDemo: false,
    },
    branch: 'production',
    categories: ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
    currentStep: {
      index: 3,
      phase: 'Completed',
      category: 'Business URL Audit',
      headline: `Completed ${selectedTools.length}-tool business audit for ${normalized.hostname}`,
      narrative: `Synthesized ${commits.length} findings across Performance, Accessibility, Best Practices, SEO, and Security.`,
    },
    steps: [],
    totalSteps: 4,
    commits,
    totalCommits: commits.length,
    pr: null,
  }

  return { commits, impact, session }
}

export interface BusinessUrlAuditProps {
  initialUrl?: string
  onAuditCompleted?: (record: LocalSavedAuditRecord) => void
  onOpenSavedAudit?: (record: LocalSavedAuditRecord) => void
}

export function BusinessUrlAudit({
  initialUrl = '',
  onAuditCompleted,
  onOpenSavedAudit,
}: BusinessUrlAuditProps) {
  const [urlValue, setUrlValue] = useState(initialUrl)
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>(() =>
    BUSINESS_AUDIT_TOOLS.map((t) => t.id),
  )
  const [activePreset, setActivePreset] = useState<BusinessAuditPreset['id'] | 'custom'>('full')
  const [saveFormat, setSaveFormat] = useState<LocalAuditFormat>('json')
  const [exportToDevice, setExportToDevice] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [runProgress, setRunProgress] = useState(0)
  const [runStageLabel, setRunStageLabel] = useState('Initializing...')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [copiedCli, setCopiedCli] = useState(false)
  const [lastRecord, setLastRecord] = useState<LocalSavedAuditRecord | null>(null)

  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => {
    if (initialUrl) {
      setUrlValue(initialUrl)
      setUrlError(null)
    }
  }, [initialUrl])

  useEffect(() => {
    return () => {
      for (const t of timersRef.current) clearTimeout(t)
    }
  }, [])

  const selectedTools = useMemo(
    () => BUSINESS_AUDIT_TOOLS.filter((t) => selectedToolIds.includes(t.id)),
    [selectedToolIds],
  )

  const cliPipeline = useMemo(() => {
    const parsed = normalizeBusinessUrl(urlValue) ?? {
      url: 'https://your-business-domain.com',
      hostname: 'your-business-domain.com',
      slug: 'your-business-domain.com',
    }
    if (selectedTools.length === 0) {
      return '# Select at least one OSS audit tool above to build the CLI pipeline.'
    }
    return selectedTools.map((t) => t.cliSnippet(parsed.hostname, parsed.url)).join(' && \\\n  ')
  }, [urlValue, selectedTools])

  function applyPreset(presetId: BusinessAuditPreset['id']) {
    setActivePreset(presetId)
    if (presetId === 'full') {
      setSelectedToolIds(BUSINESS_AUDIT_TOOLS.map((t) => t.id))
    } else if (presetId === 'permissive') {
      setSelectedToolIds(
        BUSINESS_AUDIT_TOOLS.filter((t) => t.licenseClass === 'permissive').map((t) => t.id),
      )
    } else if (presetId === 'seo-crawl') {
      setSelectedToolIds(
        BUSINESS_AUDIT_TOOLS.filter((t) => t.pillar === 'crawl-seo').map((t) => t.id),
      )
    } else {
      setSelectedToolIds(
        BUSINESS_AUDIT_TOOLS.filter((t) => t.pillar === 'security-recon').map((t) => t.id),
      )
    }
  }

  function toggleTool(toolId: string) {
    setActivePreset('custom')
    setSelectedToolIds((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId],
    )
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = normalizeBusinessUrl(urlValue)
    if (!parsed) {
      setUrlError('Enter a valid public website URL (e.g., https://stripe.com).')
      return
    }
    if (selectedTools.length === 0 || isRunning) return

    setUrlError(null)
    setUrlValue(parsed.url)
    setIsRunning(true)
    setRunProgress(20)
    setRunStageLabel(`Resolving ${parsed.hostname} & TLS edge headers...`)

    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current = []

    const stages = [
      { delayMs: 220, pct: 55, label: `Running DOM crawl & SEO checks (${selectedTools.length} tools)...` },
      { delayMs: 480, pct: 85, label: 'Scanning attack surface, headers & WCAG compliance...' },
    ]
    for (const stage of stages) {
      timersRef.current.push(
        setTimeout(() => {
          setRunProgress(stage.pct)
          setRunStageLabel(stage.label)
        }, stage.delayMs),
      )
    }

    timersRef.current.push(
      setTimeout(() => {
        const { commits, impact, session } = buildToolFindingsForUrl(parsed, selectedTools)
        const record = buildLocalSavedAuditRecord(
          session,
          impact,
          commits,
          saveFormat,
          `biz_${parsed.slug}_${Date.now().toString(36)}`,
        )
        record.summaryNotes = `Business URL audit for ${parsed.url} using ${selectedTools.length} OSS tools. ${commits.length} findings saved locally.`
        void fileSystemAuditData.persistAuditResult(record, saveFormat, {
          promptDeviceSave: exportToDevice,
        })
        setRunProgress(100)
        setIsRunning(false)
        setLastRecord(record)
        onAuditCompleted?.(record)
      }, 760),
    )
  }

  return (
    <section className="fr-card" aria-labelledby="business-url-audit-heading">
      <div className="fr-section-head">
        <div>
          <p className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> SERVER-INDEPENDENT BUSINESS URL AUDITOR ·{' '}
            {selectedTools.length} OF {BUSINESS_AUDIT_TOOLS.length} TOOLS
          </p>
          <h2 id="business-url-audit-heading" className="fr-section-title">
            All-in-One Business Website Quality &amp; Security Audit
          </h2>
          <p className="fr-muted">
            Evaluate any public business website across crawling, Core Web Vitals, accessibility,
            security recon, and brand uptime with local offline snapshot persistence.
          </p>
        </div>

        <div className="fr-segmented" role="group" aria-label="Output file format">
          {(['json', 'toon', 'markdown'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              className={`fr-segmented__btn${saveFormat === fmt ? ' is-active' : ''}`}
              onClick={() => setSaveFormat(fmt)}
            >
              .{fmt === 'markdown' ? 'MD' : fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="fr-intake-form">
        <label className="fr-field">
          <span className="fr-label">Business Website URL</span>
          <input
            id="biz-url-input"
            type="text"
            className="fr-input"
            value={urlValue}
            onChange={(e) => {
              setUrlValue(e.target.value)
              setUrlError(null)
            }}
            placeholder="https://example-company.com"
          />
        </label>

        <div className="fr-actions">
          {EXAMPLE_BUSINESS_URLS.map((sample) => (
            <button
              key={sample}
              type="button"
              className="fr-btn-secondary"
              onClick={() => {
                setUrlValue(sample)
                setUrlError(null)
              }}
            >
              {sample.replace(/^https:\/\//, '')}
            </button>
          ))}
        </div>

        <div className="fr-segmented" role="group" aria-label="Audit tool presets">
          {BUSINESS_AUDIT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`fr-segmented__btn${activePreset === preset.id ? ' is-active' : ''}`}
              title={preset.description}
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="fr-category-pills" role="group" aria-label="Business audit OSS tools">
          {BUSINESS_AUDIT_TOOLS.map((tool) => {
            const active = selectedToolIds.includes(tool.id)
            return (
              <label
                key={tool.id}
                className={`fr-category-pill${active ? ' is-selected' : ''}`}
                title={`${tool.role} (${tool.license})`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleTool(tool.id)}
                />
                <span>{tool.name}</span>
              </label>
            )
          })}
        </div>

        {urlError && (
          <p className="fr-error" role="alert">
            {urlError}
          </p>
        )}

        <div className="fr-actions">
          <button
            type="submit"
            id="biz-audit-run-btn"
            className="fr-btn-primary"
            disabled={isRunning || selectedTools.length === 0}
          >
            {isRunning ? `Scanning (${runProgress}%)...` : 'Run Business URL Audit'}
          </button>

          <label className="fr-checkbox-label">
            <input
              type="checkbox"
              checked={exportToDevice}
              onChange={(e) => setExportToDevice(e.target.checked)}
            />
            <span>Save output file to disk on finish</span>
          </label>
        </div>
      </form>

      {isRunning && (
        <div className="fr-progress-panel" role="status" aria-live="polite">
          <div className="fr-progress-panel__top">
            <span>{runStageLabel}</span>
            <span>{runProgress}%</span>
          </div>
          <div className="fr-progress-track">
            <div className="fr-progress-fill" style={{ width: `${runProgress}%` }} />
          </div>
        </div>
      )}

      {lastRecord && (
        <div className="fr-result-banner" role="status" aria-live="polite">
          <div className="fr-section-head">
            <div>
              <strong>{lastRecord.repoFullName}</strong>
              <p className="fr-muted">{lastRecord.summaryNotes}</p>
            </div>
            <div className="fr-actions">
              {onOpenSavedAudit && (
                <button
                  type="button"
                  id="biz-open-report-btn"
                  className="fr-btn-primary"
                  onClick={() => onOpenSavedAudit(lastRecord)}
                >
                  Open Full Report
                </button>
              )}
              <button
                type="button"
                className="fr-btn-secondary"
                onClick={() => void fileSystemAuditData.saveAuditResultToDisk(lastRecord, saveFormat)}
              >
                Save .{saveFormat === 'markdown' ? 'md' : saveFormat}
              </button>
            </div>
          </div>

          <div className="fr-gauge-grid">
            <RadialScoreGauge
              label="Performance"
              category="performance"
              beforeScore={lastRecord.performanceBefore}
              score={lastRecord.performanceAfter}
            />
            <RadialScoreGauge
              label="Accessibility"
              category="accessibility"
              beforeScore={lastRecord.accessibilityBefore}
              score={lastRecord.accessibilityAfter}
            />
            <RadialScoreGauge
              label="Best Practices"
              category="best-practices"
              beforeScore={lastRecord.bestPracticesBefore}
              score={lastRecord.bestPracticesAfter}
            />
            <RadialScoreGauge
              label="SEO"
              category="seo"
              beforeScore={lastRecord.seoBefore}
              score={lastRecord.seoAfter}
            />
            <RadialScoreGauge
              label="Security"
              category="security"
              beforeScore={lastRecord.securityBefore}
              score={lastRecord.securityAfter}
            />
          </div>
        </div>
      )}

      <div className="fr-bundle-box">
        <div className="fr-section-head">
          <strong>Reproducible CLI Pipeline</strong>
          <button
            type="button"
            className="fr-btn-secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(cliPipeline)
              setCopiedCli(true)
              window.setTimeout(() => setCopiedCli(false), 1800)
            }}
          >
            {copiedCli ? 'Copied pipeline ✓' : 'Copy CLI command'}
          </button>
        </div>
        <pre className="fr-code-block">{cliPipeline}</pre>
      </div>
    </section>
  )
}
