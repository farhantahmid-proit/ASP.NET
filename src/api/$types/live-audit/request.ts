import type { LighthouseCategory } from '@/types/audit'

export type RunPageSpeedRequest = {
  targetUrl: string
  strategy?: 'mobile' | 'desktop'
  categories?: Array<Exclude<LighthouseCategory, 'all' | 'security'>>
}

export type RunLiveLighthouseRequest = {
  sessionId: string
  targetUrl: string
  strategy?: 'mobile' | 'desktop'
}
