export interface StartSiteAuditRequest {
  targetUrl: string
  maxUrls?: number
  maxDepth?: number
  includeCrawl?: boolean
  includeThreatIntel?: boolean
  source?: string
}

export interface RunWidgetSiteAuditRequest {
  publicKey: string
  targetUrl: string
}
