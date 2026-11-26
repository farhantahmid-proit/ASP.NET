import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { siteAuditKeys } from '@/api/site-audit/site-audit.query'
import type { SiteAuditSession } from '@/api/$types/site-audit/response'
import { connectSiteAuditStream } from './useSiteAuditStream'

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  listeners = new Map<string, Set<(ev: MessageEvent<string>) => void>>()
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, cb: (ev: MessageEvent<string>) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(cb)
  }

  removeEventListener(type: string, cb: (ev: MessageEvent<string>) => void) {
    this.listeners.get(type)?.delete(cb)
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent<string>
    this.listeners.get(type)?.forEach((cb) => cb(event))
  }

  close() {
    this.closed = true
  }
}

describe('connectSiteAuditStream', () => {
  const originalEventSource = globalThis.EventSource

  afterEach(() => {
    MockEventSource.instances = []
    globalThis.EventSource = originalEventSource
  })

  it('updates React Query cache on state, pillar, and completed SSE events', () => {
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
    const qc = new QueryClient()
    let completedSessionId = ''

    const disconnect = connectSiteAuditStream({
      sessionId: 'site-123',
      queryClient: qc,
      onCompleted: (id) => {
        completedSessionId = id
      },
    })

    const es = MockEventSource.instances[0]
    expect(es.url).toContain('/api/audit/site/site-123/stream?cid=')

    const initial = {
      id: 'site-123',
      targetUrl: 'https://example.com',
      source: 'web',
      status: 'in_progress',
      progressPercent: 15,
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      pillars: {
        'web-check': { status: 'running', error: null },
        'threat-intel': { status: 'pending', error: null },
        'site-crawl': { status: 'pending', error: null },
      },
      scores: { overall: null, infra: null, security: null, seo: null, geo: null, cms: null },
      webCheck: null,
      threatIntel: null,
      siteCrawl: null,
      findings: [],
      sidecarAdapters: {},
    } satisfies SiteAuditSession

    es.emit('state', initial)
    expect(qc.getQueryData<SiteAuditSession>(siteAuditKeys.status('site-123'))?.progressPercent).toBe(15)

    es.emit('pillar', { pillar: 'web-check', status: 'completed', progressPercent: 45 })
    const afterPillar = qc.getQueryData<SiteAuditSession>(siteAuditKeys.status('site-123'))
    expect(afterPillar?.pillars['web-check'].status).toBe('completed')
    expect(afterPillar?.progressPercent).toBe(45)

    es.emit('completed', {
      sessionId: 'site-123',
      session: { ...initial, status: 'completed', progressPercent: 100 },
    })
    expect(completedSessionId).toBe('site-123')
    expect(es.closed).toBe(true)
    disconnect()
  })
})
