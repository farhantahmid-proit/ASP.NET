import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getAuditClientId, getFresnelApiBaseUrl } from '@/api/client'
import { siteAuditKeys } from '@/api/site-audit/site-audit.query'
import type { SiteAuditSession } from '@/api/$types/site-audit/response'

export interface ConnectSiteAuditStreamOptions {
  sessionId: string
  queryClient: QueryClient
  onCompleted?: (sessionId: string, session?: SiteAuditSession) => void
  onError?: () => void
}

export function connectSiteAuditStream({
  sessionId,
  queryClient,
  onCompleted,
  onError,
}: ConnectSiteAuditStreamOptions): () => void {
  if (!sessionId || typeof EventSource === 'undefined') {
    return () => undefined
  }

  const baseUrl = getFresnelApiBaseUrl()
  const cid = encodeURIComponent(getAuditClientId())
  const streamUrl = `${baseUrl}/api/audit/site/${encodeURIComponent(sessionId)}/stream?cid=${cid}`
  const source = new EventSource(streamUrl)

  const handleStateEvent = (event: MessageEvent<string>) => {
    try {
      const nextState = JSON.parse(event.data) as SiteAuditSession
      queryClient.setQueryData(siteAuditKeys.status(sessionId), nextState)
    } catch {
      // Ignore malformed SSE packets
    }
  }

  const handlePillarEvent = (event: MessageEvent<string>) => {
    try {
      const packet = JSON.parse(event.data) as {
        pillar?: keyof SiteAuditSession['pillars']
        status?: SiteAuditSession['pillars']['web-check']['status']
        progressPercent?: number
        session?: SiteAuditSession
      }
      if (packet?.session) {
        queryClient.setQueryData(siteAuditKeys.status(sessionId), packet.session)
        return
      }
      if (packet?.pillar && packet?.status) {
        queryClient.setQueryData<SiteAuditSession>(siteAuditKeys.status(sessionId), (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            progressPercent:
              typeof packet.progressPercent === 'number'
                ? packet.progressPercent
                : prev.progressPercent,
            pillars: {
              ...prev.pillars,
              [packet.pillar!]: {
                ...prev.pillars[packet.pillar!],
                status: packet.status!,
              },
            },
          }
        })
      }
    } catch {
      // Ignore malformed pillar packets
    }
  }

  const handleCompletedEvent = (event: MessageEvent<string>) => {
    let completedId = sessionId
    let finalSession: SiteAuditSession | undefined
    try {
      const payload = JSON.parse(event.data) as {
        sessionId?: string
        session?: SiteAuditSession
      }
      if (payload?.sessionId) completedId = payload.sessionId
      if (payload?.session) {
        finalSession = payload.session
        queryClient.setQueryData(siteAuditKeys.status(sessionId), finalSession)
      }
    } catch {
      // Fall back to active sessionId
    }
    source.close()
    onCompleted?.(completedId, finalSession)
  }

  const handleError = () => {
    source.close()
    onError?.()
  }

  source.addEventListener('state', handleStateEvent as EventListener)
  source.addEventListener('pillar', handlePillarEvent as EventListener)
  source.addEventListener('completed', handleCompletedEvent as EventListener)
  source.addEventListener('error', handleError)

  return () => {
    source.removeEventListener('state', handleStateEvent as EventListener)
    source.removeEventListener('pillar', handlePillarEvent as EventListener)
    source.removeEventListener('completed', handleCompletedEvent as EventListener)
    source.removeEventListener('error', handleError)
    source.close()
  }
}

export function useSiteAuditStream(
  sessionId: string | null | undefined,
  enabled = true,
  callbacks?: {
    onCompleted?: (sessionId: string, session?: SiteAuditSession) => void
    onError?: () => void
  },
): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled || !sessionId) return undefined
    return connectSiteAuditStream({
      sessionId,
      queryClient,
      onCompleted: callbacks?.onCompleted,
      onError: callbacks?.onError,
    })
  }, [sessionId, enabled, queryClient, callbacks?.onCompleted, callbacks?.onError])
}
