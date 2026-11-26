import type { LighthouseCategory, LocalSavedAuditRecord } from '@/types/audit'

export interface PageSpeedFailingAudit {
  id: string
  title: string
  description: string
  category: Exclude<LighthouseCategory, 'all' | 'security'>
  score: number
  displayValue: string
  numericValue: number | null
}

export interface PageSpeedAuditResult {
  source: 'google-pagespeed-insights'
  requestedUrl: string
  finalUrl: string
  strategy: 'mobile' | 'desktop'
  fetchTime: string
  lighthouseVersion: string
  scores: {
    performance: number
    accessibility: number
    bestPractices: number
    seo: number
  }
  coreWebVitals: {
    lcpMs: number | null
    lcpDisplay: string
    fcpMs: number | null
    fcpDisplay: string
    cls: number | null
    clsDisplay: string
    inpMs: number | null
    inpDisplay: string
    tbtMs: number | null
    tbtDisplay: string
    speedIndexMs: number | null
    speedIndexDisplay: string
  }
  failingAudits: PageSpeedFailingAudit[]
  totalAuditsEvaluated: number
  lhrJson: string
  savedRecord?: LocalSavedAuditRecord
}

export interface LiveLighthouseResponse {
  source: string
  lhrJson: string
  lighthouseVersion?: string
  requestedUrl?: string
  fetchTime?: string
  scores?: PageSpeedAuditResult['scores']
  coreWebVitals?: PageSpeedAuditResult['coreWebVitals']
}

export interface AxeViolationSummary {
  id: string
  impact: 'critical' | 'serious' | 'moderate' | 'minor'
  help: string
  description: string
  helpUrl: string
  nodesCount: number
  sampleSelector: string
}

export interface AxeRunSummary {
  url: string
  timestampIso: string
  passesCount: number
  incompleteCount: number
  violations: AxeViolationSummary[]
  accessibilityScore: number
  savedRecord: LocalSavedAuditRecord
}

export type WebVitalName = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'

export interface WebVitalReading {
  name: WebVitalName
  label: string
  value: number | null
  displayValue: string
  rating: 'good' | 'needs-improvement' | 'poor' | 'pending'
  updatedAtIso: string | null
}
