import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAuditStatus,
  generateAuditPatch,
  generateExecutiveSummary,
  startAudit,
} from './audit'

describe('api/audit', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends POST /api/audit/start with x-client-id header and returns session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'fresnel-oss-123', status: 'in_progress' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const session = await startAudit({
      repoUrl: 'https://github.com/fresnel-sandbox/lumina-web-app',
      mode: 'demo',
    })

    expect(session.id).toBe('fresnel-oss-123')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/audit/start')
    expect(init.method).toBe('POST')
    const headers = init.headers as Headers
    expect(headers.get('x-client-id')).toMatch(/^[a-zA-Z0-9_-]{8,128}$/)
  })

  it('fetches status, patch bundle, and executive summary via expected endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'sess/1', status: 'completed' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ filename: 'fresnel.patch', selectedCount: 2 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ headline: 'Great improvements' }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const status = await fetchAuditStatus('sess/1')
    expect(status.status).toBe('completed')
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/audit/sess%2F1/status')

    const patch = await generateAuditPatch({ sessionId: 'sess-1', selectedCommitIds: ['c1', 'c2'] })
    expect(patch.selectedCount).toBe(2)
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe('/api/audit/sess-1/patch')

    const summary = await generateExecutiveSummary({
      sessionId: 'sess-1',
      repoFullName: 'org/repo',
    })
    expect(summary.headline).toBe('Great improvements')
    expect((fetchMock.mock.calls[2] as [string])[0]).toBe('/api/audit/sess-1/executive-summary')
  })
})
