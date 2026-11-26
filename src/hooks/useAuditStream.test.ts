import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { auditKeys } from '@/api/audit/audit.query'
import { connectAuditStream } from './useAuditStream'

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly url: string
  closed = false
  private listeners = new Map<string, Set<(ev: Event) => void>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, cb: (ev: Event) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)?.add(cb)
  }

  removeEventListener(type: string, cb: (ev: Event) => void) {
    this.listeners.get(type)?.delete(cb)
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent<string>
    for (const cb of this.listeners.get(type) ?? []) {
      cb(event)
    }
  }

  close() {
    this.closed = true
  }
}

describe('useAuditStream / connectAuditStream', () => {
  afterEach(() => {
    MockEventSource.instances = []
    vi.unstubAllGlobals()
  })

  it('updates TanStack Query cache on SSE state events and closes on completed', () => {
    vi.stubGlobal('EventSource', MockEventSource)
    const queryClient = new QueryClient()
    const onCompleted = vi.fn()

    const stop = connectAuditStream({
      sessionId: 'fresnel-oss-99',
      queryClient,
      onCompleted,
    })

    expect(MockEventSource.instances.length).toBe(1)
    const source = MockEventSource.instances[0]
    expect(source.url).toContain('/api/audit/fresnel-oss-99/stream?cid=')

    source.emit('state', { id: 'fresnel-oss-99', status: 'in_progress', progressPercent: 60 })
    const cached = queryClient.getQueryData<{ progressPercent: number }>(
      auditKeys.session('fresnel-oss-99'),
    )
    expect(cached?.progressPercent).toBe(60)

    source.emit('completed', { sessionId: 'fresnel-oss-99' })
    expect(source.closed).toBe(true)
    expect(onCompleted).toHaveBeenCalledWith('fresnel-oss-99')

    stop()
  })
})
