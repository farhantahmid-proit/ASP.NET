import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { auditKeys } from '@/api/audit/audit.query'
import { getAuditClientId, getFresnelApiBaseUrl } from '@/api/client'
import type { AuditSession } from '@/types/audit'

export interface ConnectAuditStreamOptions {
  sessionId: string
  queryClient: QueryClient
  onCompleted?: (sessionId: string) => void
  onError?: () => void
}

export function connectAuditStream({
  sessionId,
  queryClient,
  onCompleted,
  onError,
}: ConnectAuditStreamOptions): () => void {
  if (!sessionId || typeof EventSource === 'undefined') {
    return () => undefined
  }

  const baseUrl = getFresnelApiBaseUrl()
  const cid = encodeURIComponent(getAuditClientId())
  const streamUrl = `${baseUrl}/api/audit/${encodeURIComponent(sessionId)}/stream?cid=${cid}`
  const source = new EventSource(streamUrl)

  const handleStateEvent = (event: MessageEvent<string>) => {
    try {
      const nextState = JSON.parse(event.data) as AuditSession
      queryClient.setQueryData(auditKeys.session(sessionId), nextState)
    } catch {
      // Ignore malformed telemetry packets
    }
  }

  const handleCompletedEvent = (event: MessageEvent<string>) => {
    let completedId = sessionId
    try {
      const payload = JSON.parse(event.data) as { sessionId?: string }
      if (payload?.sessionId) {
        completedId = payload.sessionId
      }
    } catch {
      // Fall back to active sessionId
    }
    source.close()
    onCompleted?.(completedId)
  }

  const handleError = () => {
    source.close()
    onError?.()
  }

  source.addEventListener('state', handleStateEvent as EventListener)
  source.addEventListener('completed', handleCompletedEvent as EventListener)
  source.addEventListener('error', handleError)

  return () => {
    source.removeEventListener('state', handleStateEvent as EventListener)
    source.removeEventListener('completed', handleCompletedEvent as EventListener)
    source.removeEventListener('error', handleError)
    source.close()
  }
}

export function useAuditStream(
  sessionId: string | null | undefined,
  enabled = true,
  callbacks?: {
    onCompleted?: (sessionId: string) => void
    onError?: () => void
  },
): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled || !sessionId) return undefined
    return connectAuditStream({
      sessionId,
      queryClient,
      onCompleted: callbacks?.onCompleted,
      onError: callbacks?.onError,
    })
  }, [sessionId, enabled, queryClient, callbacks?.onCompleted, callbacks?.onError])
}
