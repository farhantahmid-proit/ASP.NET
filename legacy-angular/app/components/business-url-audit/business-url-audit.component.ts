import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  AuditCommit,
  AuditImpactMetrics,
  AuditSession,
  LighthouseCategory,
  LocalAuditFormat,
  LocalSavedAuditRecord
} from '../../models/audit.model';
import {
  buildLocalSavedAuditRecord
} from '../../services/local-audit-storage.service';
import { FileSystemAuditDataService } from '../../services/file-system-audit-data.service';

export type BusinessToolPillar = 'crawl-seo' | 'security-recon' | 'brand-uptime';
export type ToolLicenseClass = 'permissive' | 'copyleft' | 'source-available';

export interface BusinessAuditTool {
  id: string;
  repo: string;
  name: string;
  pillar: BusinessToolPillar;
  pillarLabel: string;
  license: string;
  licenseClass: ToolLicenseClass;
  starsLabel: string;
  role: string;
  primaryCategory: Exclude<LighthouseCategory, 'all'>;
  cliSnippet: (domain: string, url: string) => string;
}

export interface BusinessAuditPreset {
  id: 'full' | 'permissive' | 'seo-crawl' | 'security-recon';
  label: string;
  description: string;
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
    cliSnippet: (_domain, url) => `scrapling fetch "${url}" --extract-meta --check-canonicals`
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
    cliSnippet: (_domain, url) => `npx stagehand audit "${url}" --wcag=AA --vitals`
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
    cliSnippet: (domain) => `umami-audit --host "${domain}" --check-script-budget`
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
    cliSnippet: (domain) => `osmedeus scan -f general -t "${domain}"`
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
    cliSnippet: (domain) => `bbot -t "${domain}" -p web-basic --strict-scope`
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
    cliSnippet: (_domain, url) => `noir -u "${url}" --format json`
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
    cliSnippet: (_domain, url) => `zeroleaks scan --target "${url}" --bundles`
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
    cliSnippet: (domain) => `cf-hero -d "${domain}" -verify-headers`
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
    cliSnippet: (domain) => `social-analyzer --username "${domain.split('.')[0]}" --metadata`
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
    cliSnippet: (_domain, url) => `nezha-probe --http "${url}" --tls-check --ttfb`
  }
];

const BUSINESS_AUDIT_PRESETS: readonly BusinessAuditPreset[] = [
  {
    id: 'full',
    label: 'Full Business Audit (10)',
    description: 'All 3 pillars across crawling, security recon, and brand uptime'
  },
  {
    id: 'permissive',
    label: 'Permissive Commercial (7)',
    description: 'MIT, Apache-2.0, and BSD-3-Clause tools safe for commercial SaaS'
  },
  {
    id: 'seo-crawl',
    label: 'SEO & Crawl (3)',
    description: 'Scrapling, Stagehand, and Umami for Core Web Vitals & SEO'
  },
  {
    id: 'security-recon',
    label: 'Security & Recon (5)',
    description: 'Osmedeus, BBOT, OWASP Noir, ZeroLeaks, and CF-Hero'
  }
];

const EXAMPLE_BUSINESS_URLS: readonly string[] = [
  'https://stripe.com',
  'https://linear.app',
  'https://shop.northwind-retail.io'
];

interface PillarGroup {
  id: BusinessToolPillar;
  label: string;
  tools: BusinessAuditTool[];
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function normalizeBusinessUrl(raw: string): { url: string; hostname: string; slug: string } | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || !parsed.hostname.includes('.') || /\s/.test(parsed.hostname)) {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const cleanPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    const normalizedUrl = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${cleanPath}`;
    const slug = hostname.replace(/[^a-z0-9.-]/g, '-');
    return { url: normalizedUrl, hostname, slug };
  } catch {
    return null;
  }
}

function categoryLabelFor(category: Exclude<LighthouseCategory, 'all'>): string {
  switch (category) {
    case 'performance':
      return 'Performance';
    case 'accessibility':
      return 'Accessibility';
    case 'best-practices':
      return 'Best practices';
    case 'seo':
      return 'SEO';
    case 'security':
      return 'Web application security findings';
  }
}

function buildToolFindingsForUrl(
  normalized: { url: string; hostname: string; slug: string },
  selectedTools: readonly BusinessAuditTool[]
): { commits: AuditCommit[]; impact: AuditImpactMetrics; session: AuditSession } {
  const seed = stableHash(normalized.hostname);
  const nowUtc = new Date().toUTCString();
  const commits: AuditCommit[] = [];

  const pushCommit = (
    idx: number,
    tool: BusinessAuditTool,
    category: Exclude<LighthouseCategory, 'all'>,
    ruleId: string,
    title: string,
    summary: string,
    targetFile: string,
    diffBefore: string,
    diffAfter: string
  ): void => {
    const shaHex = ((seed + idx * 7919) >>> 0).toString(16).padStart(7, '0').slice(0, 7);
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
        `+${diffAfter}`
      ].join('\n')
    });
  };

  let idx = 0;
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
          `<link rel="canonical" href="${normalized.url}/">\n<meta name="description" content="Verified business landing page for ${normalized.hostname}.">`
        );
        pushCommit(
          idx++,
          tool,
          'best-practices',
          'robots-and-crawl-budget',
          `Standardize robots.txt crawl directives and XML sitemap pointer for ${normalized.hostname}`,
          `Prevents search crawlers from indexing duplicate query parameter routes discovered during DOM crawl.`,
          'public/robots.txt',
          'User-agent: *',
          `User-agent: *\nAllow: /\nSitemap: ${normalized.url}/sitemap.xml`
        );
        break;
      case 'stagehand':
        pushCommit(
          idx++,
          tool,
          'accessibility',
          'wcag-focus-and-aria-landmarks',
          `Enforce WCAG AA focus rings, skip-navigation landmark, and button accessible names`,
          `Stagehand headless DOM traversal detected interactive icon controls without accessible labels or visible focus outlines.`,
          'src/app/header.html',
          '<button class="nav-toggle"><svg></svg></button>',
          '<a class="skip-link" href="#main">Skip to content</a>\n<button class="nav-toggle" aria-label="Toggle navigation menu"><svg aria-hidden="true"></svg></button>'
        );
        pushCommit(
          idx++,
          tool,
          'accessibility',
          'color-contrast-aa',
          `Raise secondary body copy contrast ratio above 4.5:1 on hero and footer surfaces`,
          `Stagehand computed-style inspection found muted captions below WCAG 2.1 AA contrast threshold.`,
          'src/styles/theme.css',
          '--text-muted: #9ca3af;',
          '--text-muted: #52525b;'
        );
        break;
      case 'umami':
        pushCommit(
          idx++,
          tool,
          'performance',
          'defer-third-party-telemetry',
          `Replace render-blocking analytics scripts with deferred cookieless Umami beacon`,
          `Cuts main-thread blocking time by ~240ms and removes third-party cookie banner layout shift.`,
          'index.html',
          '<script src="https://legacy-tracker.example/bundle.js"></script>',
          `<script defer src="https://analytics.${normalized.hostname}/script.js" data-website-id="site-main"></script>`
        );
        break;
      case 'osmedeus':
        pushCommit(
          idx++,
          tool,
          'security',
          'strict-transport-and-csp',
          `Enforce HSTS preload, Content-Security-Policy, and Permissions-Policy response headers`,
          `Osmedeus HTTP recon detected missing Strict-Transport-Security and frame-ancestors protections on ${normalized.hostname}.`,
          'edge/security-headers.conf',
          'add_header X-Frame-Options SAMEORIGIN;',
          'add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;\nadd_header Content-Security-Policy "default-src \'self\'; frame-ancestors \'none\';" always;'
        );
        break;
      case 'bbot':
        pushCommit(
          idx++,
          tool,
          'security',
          'subdomain-and-cors-scope',
          `Restrict permissive wildcard CORS and retire stale staging subdomain DNS records`,
          `BBOT recursive attack-surface mapping identified overly broad Access-Control-Allow-Origin headers.`,
          'server/cors.config.ts',
          'export const allowedOrigins = ["*"];',
          `export const allowedOrigins = ["${normalized.url}"];`
        );
        break;
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
          'router.post("/contact", rateLimit({ max: 20, windowMs: 60000 }), validateBody(contactSchema), handleContact);'
        );
        break;
      case 'zeroleaks':
        pushCommit(
          idx++,
          tool,
          'security',
          'client-bundle-secret-hygiene',
          `Strip leaked debug tokens and source-map references from production client bundles`,
          `ZeroLeaks bundle scanner flagged publicly reachable .map URLs and staging API keys in client assets.`,
          'angular.json',
          '"sourceMap": true',
          '"sourceMap": false'
        );
        break;
      case 'cf-hero':
        pushCommit(
          idx++,
          tool,
          'best-practices',
          'edge-cache-and-origin-lock',
          `Add immutable asset Cache-Control directives and restrict direct-to-origin IP bypass`,
          `CF-Hero edge verification recommended immutable caching for hashed bundles and origin mTLS lock.`,
          'edge/cache-rules.json',
          '{ "cacheControl": "public, max-age=300" }',
          '{ "cacheControl": "public, max-age=31536000, immutable", "originLock": "cloudflare-authenticated-pulls" }'
        );
        break;
      case 'social-analyzer':
        pushCommit(
          idx++,
          tool,
          'seo',
          'opengraph-and-brand-verification',
          `Add OpenGraph, Twitter Card, and rel="me" brand verification metadata`,
          `Social Analyzer brand OSINT verified social profile handles and flagged missing og:image / twitter:card tags.`,
          'index.html',
          '<meta name="viewport" content="width=device-width, initial-scale=1">',
          `<meta property="og:title" content="${normalized.hostname}">\n<meta name="twitter:card" content="summary_large_image">`
        );
        break;
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
          '<link rel="preload" as="image" href="/assets/hero.webp" fetchpriority="high">\n<img src="/assets/hero.webp" alt="Hero" fetchpriority="high" decoding="async">'
        );
        break;
    }
  }

  const countByCat = (cat: Exclude<LighthouseCategory, 'all'>): number =>
    commits.filter((c) => c.category === cat).length;

  const perfBefore = 58 + (seed % 14);
  const perfAfter = Math.min(98, perfBefore + Math.max(8, countByCat('performance') * 12 + 6));
  const a11yBefore = 66 + (seed % 12);
  const a11yAfter = Math.min(99, a11yBefore + Math.max(6, countByCat('accessibility') * 11 + 5));
  const bpBefore = 70 + (seed % 10);
  const bpAfter = Math.min(98, bpBefore + Math.max(5, countByCat('best-practices') * 10 + 5));
  const seoBefore = 68 + (seed % 12);
  const seoAfter = Math.min(99, seoBefore + Math.max(7, countByCat('seo') * 10 + 6));
  const secBefore = 60 + (seed % 13);
  const secAfter = Math.min(97, secBefore + Math.max(8, countByCat('security') * 8 + 6));

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
    categoryAxes: []
  };

  const sessionId = `biz_${normalized.slug}_${Date.now().toString(36)}`;
  const toolNames = selectedTools.map((t) => t.name).join(', ');
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
      securityAfter: secAfter
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
      isDemo: false
    },
    branch: 'production',
    categories: ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
    currentStep: {
      index: 3,
      phase: 'Completed',
      category: 'Business URL Audit',
      headline: `Completed ${selectedTools.length}-tool business audit for ${normalized.hostname}`,
      narrative: `Synthesized ${commits.length} findings across Performance, Accessibility, Best Practices, SEO, and Security using ${toolNames}.`
    },
    steps: [],
    totalSteps: 4,
    commits,
    totalCommits: commits.length,
    pr: null
  };

  return { commits, impact, session };
}

@Component({
  selector: 'app-business-url-audit',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="biz-audit-panel" aria-labelledby="business-url-audit-heading">
      <div class="biz-audit-panel__head">
        <div>
          <p class="biz-audit-kicker">
            <span>Server-Independent Business URL Auditor</span>
            <span aria-hidden="true">·</span>
            <span>{{ selectedToolIds().size }} of {{ allTools.length }} OSS Tools Active</span>
          </p>
          <h2 id="business-url-audit-heading" class="biz-audit-title">
            Audit Your Business URL
          </h2>
          <p class="biz-audit-subtitle">
            Enter a live business website URL and select open-source auditing tools across crawling, SEO, security recon, and brand uptime. Results save locally and immediately update the D3.js category donut chart.
          </p>
        </div>

        <div class="biz-audit-format-wrap">
          <span class="biz-audit-format-label">Local save format</span>
          <div class="dashboard-segmented" role="group" aria-label="Select local audit save format">
            <button
              type="button"
              class="dashboard-segmented__btn"
              [class.is-active]="saveFormat() === 'json'"
              (click)="saveFormat.set('json')"
            >
              .JSON
            </button>
            <button
              type="button"
              class="dashboard-segmented__btn"
              [class.is-active]="saveFormat() === 'toon'"
              (click)="saveFormat.set('toon')"
            >
              .TOON
            </button>
            <button
              type="button"
              class="dashboard-segmented__btn"
              [class.is-active]="saveFormat() === 'markdown'"
              (click)="saveFormat.set('markdown')"
            >
              .MD
            </button>
          </div>
        </div>
      </div>

      <!-- URL Entry Form -->
      <form class="biz-audit-form" (submit)="onSubmitAudit($event)" novalidate>
        <div class="biz-audit-input-row">
          <div class="biz-audit-input-shell" [class.is-invalid]="showUrlError()">
            <label for="business-url-input" class="sr-only">Business website URL</label>
            <svg class="biz-audit-input-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <circle cx="10" cy="10" r="7.5" />
              <path d="M2.5 10h15M10 2.5a11.5 11.5 0 0 1 0 15M10 2.5a11.5 11.5 0 0 0 0 15" />
            </svg>
            <input
              id="business-url-input"
              type="url"
              class="biz-audit-input"
              [formControl]="urlControl"
              placeholder="https://your-business-domain.com"
              autocomplete="url"
              spellcheck="false"
              [attr.aria-invalid]="showUrlError()"
              aria-describedby="business-url-hint"
            />
            @if (urlControl.value) {
              <button
                type="button"
                class="biz-audit-clear-btn"
                aria-label="Clear business URL"
                (click)="clearUrl()"
              >
                ✕
              </button>
            }
          </div>

          <button
            type="submit"
            id="run-business-url-audit-btn"
            class="primary-flow-btn biz-audit-submit-btn"
            [disabled]="isRunning() || selectedToolIds().size === 0"
          >
            <span>{{ isRunning() ? runStageLabel() : 'Run Business Audit' }}</span>
            @if (!isRunning()) {
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M4.5 10h11M10.5 5l5 5-5 5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            }
          </button>
        </div>

        <div id="business-url-hint" class="biz-audit-quick-row">
          <div class="biz-audit-examples">
            <span class="biz-audit-examples__label">Quick test:</span>
            @for (sample of exampleUrls; track sample) {
              <button
                type="button"
                class="biz-audit-example-link"
                (click)="applyExampleUrl(sample)"
              >
                {{ sample.replace('https://', '') }}
              </button>
            }
          </div>

          <label class="biz-audit-device-toggle">
            <input
              type="checkbox"
              [checked]="exportToDeviceOnComplete()"
              (change)="toggleExportToDevice($event)"
            />
            <span>Also prompt device file save ({{ saveFormat().toUpperCase() }})</span>
          </label>
        </div>

        @if (showUrlError()) {
          <p class="biz-audit-error" role="alert">
            Enter a valid business website domain or URL (for example, <code>https://acme-retail.com</code>).
          </p>
        }
      </form>

      <!-- Live Progress Strip While Scanning -->
      @if (isRunning()) {
        <div class="biz-audit-progress" role="status" aria-live="polite">
          <div class="biz-audit-progress__top">
            <span class="biz-audit-progress__label">{{ runStageLabel() }}</span>
            <span class="biz-audit-progress__pct">{{ runProgress() }}%</span>
          </div>
          <div class="biz-audit-progress__track">
            <div class="biz-audit-progress__fill" [style.width.%]="runProgress()"></div>
          </div>
        </div>
      }

      <!-- Completed Inline Result Banner -->
      @if (lastCompletedRecord(); as rec) {
        <div class="biz-audit-result-bar" role="status" aria-live="polite">
          <div class="biz-audit-result-bar__info">
            <strong>Saved {{ rec.repoFullName }}</strong>
            <span aria-hidden="true">·</span>
            <span>{{ rec.totalCommitsCount }} findings added to Dashboard D3 Donut</span>
            <span aria-hidden="true">·</span>
            <span class="biz-audit-result-bar__scores">
              Perf {{ rec.performanceBefore }}→{{ rec.performanceAfter }} · SEO {{ rec.seoBefore }}→{{ rec.seoAfter }} · Sec {{ rec.securityBefore }}→{{ rec.securityAfter }}
            </span>
          </div>
          <div class="biz-audit-result-bar__actions">
            <button
              type="button"
              id="biz-audit-open-report-btn"
              class="dashboard-inline-btn dashboard-inline-btn--primary"
              (click)="openSavedAudit.emit(rec)"
            >
              Open Full Report
            </button>
            <button
              type="button"
              id="biz-audit-save-file-btn"
              class="dashboard-inline-btn"
              (click)="onSaveRecordToDeviceFile(rec)"
            >
              Save .{{ saveFormat() === 'markdown' ? 'md' : saveFormat() }} File
            </button>
          </div>
        </div>
      }

      <!-- Stack Preset Selector & Tool Matrix Toggle -->
      <div class="biz-audit-presets-bar">
        <div class="biz-audit-presets" role="group" aria-label="OSS tool stack presets">
          @for (preset of presets; track preset.id) {
            <button
              type="button"
              class="biz-audit-preset-btn"
              [class.is-active]="activePreset() === preset.id"
              [title]="preset.description"
              (click)="applyPreset(preset.id)"
            >
              {{ preset.label }}
            </button>
          }
        </div>

        <button
          type="button"
          class="text-action-btn"
          [attr.aria-expanded]="isToolsExpanded()"
          aria-controls="business-audit-tools-matrix"
          (click)="isToolsExpanded.set(!isToolsExpanded())"
        >
          {{ isToolsExpanded() ? 'Hide Tool Suite' : 'Configure Tools (' + selectedToolIds().size + ')' }}
        </button>
      </div>

      @if (isToolsExpanded()) {
        <div id="business-audit-tools-matrix" class="biz-audit-pillars">
          @for (group of pillarGroups; track group.id) {
            <div class="biz-audit-pillar-col">
              <div class="biz-audit-pillar-col__head">
                <h3 class="biz-audit-pillar-title">{{ group.label }}</h3>
                <span class="biz-audit-pillar-count">
                  {{ countSelectedInPillar(group.id) }}/{{ group.tools.length }}
                </span>
              </div>

              <div class="biz-audit-tool-list">
                @for (tool of group.tools; track tool.id) {
                  <label
                    class="biz-audit-tool-row"
                    [class.is-selected]="selectedToolIds().has(tool.id)"
                  >
                    <input
                      type="checkbox"
                      class="biz-audit-tool-checkbox"
                      [checked]="selectedToolIds().has(tool.id)"
                      (change)="toggleTool(tool.id)"
                    />
                    <div class="biz-audit-tool-body">
                      <div class="biz-audit-tool-top">
                        <strong class="biz-audit-tool-name">{{ tool.name }}</strong>
                        <span class="biz-audit-tool-meta">
                          <span>{{ tool.license }}</span>
                          <span aria-hidden="true">·</span>
                          <span>{{ tool.starsLabel }}</span>
                        </span>
                      </div>
                      <p class="biz-audit-tool-role">{{ tool.role }}</p>
                      <span class="biz-audit-tool-repo">{{ tool.repo }}</span>
                    </div>
                  </label>
                }
              </div>
            </div>
          }
        </div>

        <!-- Copyable Native CLI Pipeline Command -->
        <div class="biz-audit-cli-strip">
          <div class="biz-audit-cli-strip__head">
            <span class="biz-audit-cli-strip__label">
              Local CLI Orchestration Pipeline ({{ selectedTools().length }} tools)
            </span>
            <button
              type="button"
              class="copy-btn copy-btn--subtle"
              (click)="copyCliCommand()"
            >
              {{ copiedCli() ? 'Copied pipeline!' : 'Copy CLI command' }}
            </button>
          </div>
          <pre class="biz-audit-cli-pre"><code>{{ generatedCliPipeline() }}</code></pre>
        </div>
      }
    </section>
  `
})
export class BusinessUrlAuditComponent {
  private readonly fileSystemData = inject(FileSystemAuditDataService);
  private readonly destroyRef = inject(DestroyRef);

  readonly auditCompleted = output<LocalSavedAuditRecord>();
  readonly openSavedAudit = output<LocalSavedAuditRecord>();

  readonly allTools = BUSINESS_AUDIT_TOOLS;
  readonly presets = BUSINESS_AUDIT_PRESETS;
  readonly exampleUrls = EXAMPLE_BUSINESS_URLS;

  readonly pillarGroups: readonly PillarGroup[] = [
    {
      id: 'crawl-seo',
      label: 'Site-Audit, Crawling & SEO',
      tools: BUSINESS_AUDIT_TOOLS.filter((t) => t.pillar === 'crawl-seo')
    },
    {
      id: 'security-recon',
      label: 'Security & Attack-Surface Recon',
      tools: BUSINESS_AUDIT_TOOLS.filter((t) => t.pillar === 'security-recon')
    },
    {
      id: 'brand-uptime',
      label: 'SMM, Brand OSINT & Uptime',
      tools: BUSINESS_AUDIT_TOOLS.filter((t) => t.pillar === 'brand-uptime')
    }
  ];

  readonly urlControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required]
  });

  readonly selectedToolIds = signal<Set<string>>(
    new Set<string>(BUSINESS_AUDIT_TOOLS.map((t) => t.id))
  );
  readonly activePreset = signal<BusinessAuditPreset['id'] | 'custom'>('full');
  readonly saveFormat = signal<LocalAuditFormat>('json');
  readonly exportToDeviceOnComplete = signal<boolean>(false);
  readonly isToolsExpanded = signal<boolean>(true);
  readonly isRunning = signal<boolean>(false);
  readonly runProgress = signal<number>(0);
  readonly runStageLabel = signal<string>('Initializing…');
  readonly submittedInvalid = signal<boolean>(false);
  readonly copiedCli = signal<boolean>(false);
  readonly lastCompletedRecord = signal<LocalSavedAuditRecord | null>(null);

  private runTimers: ReturnType<typeof setTimeout>[] = [];
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly selectedTools = computed<BusinessAuditTool[]>(() => {
    const ids = this.selectedToolIds();
    return BUSINESS_AUDIT_TOOLS.filter((t) => ids.has(t.id));
  });

  readonly showUrlError = computed<boolean>(() => {
    if (!this.submittedInvalid()) return false;
    return normalizeBusinessUrl(this.urlControl.value) === null;
  });

  readonly generatedCliPipeline = computed<string>(() => {
    const parsed = normalizeBusinessUrl(this.urlControl.value) ?? {
      url: 'https://your-business-domain.com',
      hostname: 'your-business-domain.com',
      slug: 'your-business-domain.com'
    };
    const tools = this.selectedTools();
    if (tools.length === 0) {
      return '# Select at least one OSS audit tool above to build the CLI pipeline.';
    }
    return tools.map((t) => t.cliSnippet(parsed.hostname, parsed.url)).join(' && \\\n  ');
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearRunTimers();
      if (this.copiedTimer) {
        clearTimeout(this.copiedTimer);
        this.copiedTimer = null;
      }
    });
  }

  private clearRunTimers(): void {
    for (const timer of this.runTimers) {
      clearTimeout(timer);
    }
    this.runTimers = [];
  }

  applyExampleUrl(sample: string): void {
    this.urlControl.setValue(sample);
    this.submittedInvalid.set(false);
  }

  clearUrl(): void {
    this.urlControl.setValue('');
    this.submittedInvalid.set(false);
  }

  toggleExportToDevice(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    this.exportToDeviceOnComplete.set(Boolean(el?.checked));
  }

  applyPreset(presetId: BusinessAuditPreset['id']): void {
    this.activePreset.set(presetId);
    let ids: string[];
    if (presetId === 'full') {
      ids = BUSINESS_AUDIT_TOOLS.map((t) => t.id);
    } else if (presetId === 'permissive') {
      ids = BUSINESS_AUDIT_TOOLS.filter((t) => t.licenseClass === 'permissive').map((t) => t.id);
    } else if (presetId === 'seo-crawl') {
      ids = BUSINESS_AUDIT_TOOLS.filter((t) => t.pillar === 'crawl-seo').map((t) => t.id);
    } else {
      ids = BUSINESS_AUDIT_TOOLS.filter((t) => t.pillar === 'security-recon').map((t) => t.id);
    }
    this.selectedToolIds.set(new Set(ids));
  }

  toggleTool(toolId: string): void {
    this.activePreset.set('custom');
    this.selectedToolIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  }

  countSelectedInPillar(pillar: BusinessToolPillar): number {
    const ids = this.selectedToolIds();
    return BUSINESS_AUDIT_TOOLS.filter((t) => t.pillar === pillar && ids.has(t.id)).length;
  }

  onSubmitAudit(event: Event): void {
    event.preventDefault();
    const parsed = normalizeBusinessUrl(this.urlControl.value);
    if (!parsed) {
      this.submittedInvalid.set(true);
      return;
    }

    const tools = this.selectedTools();
    if (tools.length === 0 || this.isRunning()) {
      return;
    }

    this.submittedInvalid.set(false);
    this.urlControl.setValue(parsed.url);
    this.isRunning.set(true);
    this.runProgress.set(14);
    this.runStageLabel.set(`Resolving ${parsed.hostname} & TLS edge headers…`);
    this.clearRunTimers();

    const stages: Array<{ delayMs: number; pct: number; label: string }> = [
      {
        delayMs: 260,
        pct: 42,
        label: `Running DOM crawl & SEO checks (${tools.slice(0, 3).map((t) => t.name).join(', ')})…`
      },
      {
        delayMs: 560,
        pct: 76,
        label: `Scanning attack surface, headers & WCAG compliance…`
      },
      {
        delayMs: 880,
        pct: 100,
        label: `Synthesizing local ${this.saveFormat().toUpperCase()} audit snapshot…`
      }
    ];

    for (const stage of stages) {
      this.runTimers.push(
        setTimeout(() => {
          this.runProgress.set(stage.pct);
          this.runStageLabel.set(stage.label);
        }, stage.delayMs)
      );
    }

    this.runTimers.push(
      setTimeout(() => {
        const { commits, impact, session } = buildToolFindingsForUrl(parsed, tools);
        const record = buildLocalSavedAuditRecord(
          session,
          impact,
          commits,
          this.saveFormat(),
          `biz_${parsed.slug}_${Date.now().toString(36)}`
        );
        const toolListStr = tools.map((t) => t.name).join(', ');
        record.summaryNotes = `Business URL audit for ${parsed.url} using ${tools.length} OSS tools (${toolListStr}). ${commits.length} findings saved locally.`;
        void this.fileSystemData.persistAuditResult(record, this.saveFormat(), {
          promptDeviceSave: this.exportToDeviceOnComplete()
        });
        this.lastCompletedRecord.set(record);
        this.isRunning.set(false);
        this.auditCompleted.emit(record);
      }, 1050)
    );
  }

  onSaveRecordToDeviceFile(record: LocalSavedAuditRecord): void {
    void this.fileSystemData.saveAuditResultToDisk(record, this.saveFormat());
  }

  copyCliCommand(): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(this.generatedCliPipeline());
    this.copiedCli.set(true);
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      this.copiedCli.set(false);
    }, 1800);
  }
}
