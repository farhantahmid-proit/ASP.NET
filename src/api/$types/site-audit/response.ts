export type SiteAuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type SiteAuditPillarStatusValue = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface SiteAuditFinding {
  id: string
  pillar: 'infra' | 'security' | 'seo' | 'geo' | 'cms' | string
  severity: SiteAuditSeverity
  title: string
  evidence: string
  remediation: string
}

export interface SecurityHeaderCheckItem {
  header: string
  label: string
  present: boolean
  value: string | null
  recommended: string
  severity: SiteAuditSeverity
}

export interface CookieHygieneItem {
  name: string
  hasSecure: boolean
  hasHttpOnly: boolean
  sameSite: string | null
  warnings: string[]
}

export interface WebCheckResult {
  requestedUrl: string
  finalUrl: string
  status: number
  elapsedMs: number
  durationMs: number
  redirectChain: Array<{ hop: number; from: string; to: string; status: number }>
  dns: {
    a: string[]
    aaaa: string[]
    mx: Array<{ exchange: string; priority: number }>
    ns: string[]
    cname: string[]
    soa: unknown
    txtCount: number
    spfPresent: boolean
    spfRecord: string | null
    dmarcPresent: boolean
    dmarcPolicy: string | null
  }
  tls: {
    enabled: boolean
    host: string
    protocol: string | null
    cipher: string | null
    authorized: boolean
    authorizationError: string | null
    issuer: string | null
    subject: string | null
    validFrom: string | null
    validTo: string | null
    daysRemaining: number | null
    elapsedMs: number
  }
  securityHeaders: {
    score: number
    matrix: SecurityHeaderCheckItem[]
    leaks: Array<{ header: string; value: string }>
  }
  cookies: CookieHygieneItem[]
  geo: {
    llmsTxtPresent: boolean
    llmsTxtExcerpt: string | null
    robotsTxtPresent: boolean
    sitemapXmlPresent: boolean
    sitemaps: string[]
    aiBots: Array<{ bot: string; status: string }>
    geoReadinessScore: number
  }
  detectedCms: string
  generator: string | null
  techStack: string[]
  infraScore: number
  securityScore: number
  geoScore: number
  findings: SiteAuditFinding[]
}

export interface CrawledPageItem {
  url: string
  depth: number
  status: number
  ttfbMs: number
  contentType: string
  title: string
  titleLength: number
  metaDescription: string
  h1Count: number
  h1Text: string
  canonical: string
  ogTitle: string
  imagesTotal: number
  imagesMissingAlt: number
  internalLinksCount: number
  externalLinksCount: number
  markdownExtractableChars: number
  issues: Array<{ ruleId: string; severity: SiteAuditSeverity; message: string }>
}

export interface SiteCrawlResult {
  engine: 'siteone-rust' | 'fresnel-cheerio-bfs' | string
  rootUrl: string
  crawledCount: number
  brokenCount: number
  duplicateTitleCount: number
  avgTtfbMs: number
  seoScore: number
  durationMs: number
  pages: CrawledPageItem[]
  findings: SiteAuditFinding[]
}

export interface WordPressChecklistItem {
  id: string
  category: string
  title: string
  checkType: 'automated' | 'manual'
  guidance: string
}

export interface ThreatIntelResult {
  domain: string
  subdomains: string[]
  emailAuth: {
    spfPresent: boolean
    spfStrict: boolean
    dmarcPresent: boolean
    dmarcPolicy: string | null
  }
  supplyChainScripts: Array<{
    src: string
    origin: string
    thirdParty: boolean
    hasSri: boolean
    mixedContent: boolean
    crossOrigin: string | null
  }>
  missingSriCount: number
  mixedContentCount: number
  cmsAudit: {
    detectedCms: string
    probes: Array<{
      id: string
      path: string
      title: string
      status: number
      exposed: boolean
    }>
    checklist: WordPressChecklistItem[]
  }
  threatScore: number
  cmsScore: number
  durationMs: number
  findings: SiteAuditFinding[]
}

export interface SiteAuditSession {
  id: string
  targetUrl: string
  source: string
  status: 'in_progress' | 'completed' | 'failed'
  progressPercent: number
  error: string | null
  createdAt: string
  completedAt: string | null
  pillars: {
    'web-check': { status: SiteAuditPillarStatusValue; durationMs?: number; error: string | null }
    'threat-intel': { status: SiteAuditPillarStatusValue; durationMs?: number; error: string | null }
    'site-crawl': { status: SiteAuditPillarStatusValue; durationMs?: number; error: string | null }
  }
  scores: {
    overall: number | null
    infra: number | null
    security: number | null
    seo: number | null
    geo: number | null
    cms: number | null
  }
  webCheck: WebCheckResult | null
  threatIntel: ThreatIntelResult | null
  siteCrawl: SiteCrawlResult | null
  findings: SiteAuditFinding[]
  sidecarAdapters: Record<string, { configured: boolean; license: string }>
}

export interface WidgetSiteAuditResponse {
  publicKey: string
  workspaceName: string
  targetUrl: string
  finalUrl: string
  auditedAt: string
  durationMs: number
  scores: {
    overall: number
    infra: number
    security: number
    seo: number
    geo: number
    cms: number
  }
  detectedCms: string
  techStack: string[]
  geoReadiness: {
    llmsTxtPresent: boolean
    robotsTxtPresent: boolean
    sitemapXmlPresent: boolean
  }
  findings: SiteAuditFinding[]
  totalFindingsCount: number
}
