export const MESSAGE_SOURCE = 'fresnel-audit'
export const EMBED_PARAM = 'embed'
export const PARENT_ORIGIN_PARAM = 'origin'
export const TARGET_URL_PARAM = 'target'

export type WidgetEvent =
  | { source: typeof MESSAGE_SOURCE; type: 'ready' }
  | { source: typeof MESSAGE_SOURCE; type: 'close' }
  | { source: typeof MESSAGE_SOURCE; type: 'audit_started'; targetUrl: string }
  | { source: typeof MESSAGE_SOURCE; type: 'audit_completed'; score: number }

export type HostEvent =
  | { source: typeof MESSAGE_SOURCE; type: 'opened' }
  | { source: typeof MESSAGE_SOURCE; type: 'closed' }
  | { source: typeof MESSAGE_SOURCE; type: 'run_audit'; targetUrl?: string }

const WIDGET_EVENT_TYPES = new Set(['ready', 'close', 'audit_started', 'audit_completed'])
const HOST_EVENT_TYPES = new Set(['opened', 'closed', 'run_audit'])

function hasType(data: unknown): data is { source: unknown; type: unknown } {
  return typeof data === 'object' && data !== null && 'source' in data && 'type' in data
}

export function isWidgetEvent(data: unknown): data is WidgetEvent {
  return hasType(data) && data.source === MESSAGE_SOURCE && WIDGET_EVENT_TYPES.has(String(data.type))
}

export function isHostEvent(data: unknown): data is HostEvent {
  return hasType(data) && data.source === MESSAGE_SOURCE && HOST_EVENT_TYPES.has(String(data.type))
}

export function readEmbedContext(search: string = window.location.search): {
  embedded: boolean
  parentOrigin: string | null
  targetUrl: string | null
} {
  const params = new URLSearchParams(search)
  const parentOrigin = parseOrigin(params.get(PARENT_ORIGIN_PARAM))
  const embedded = params.get(EMBED_PARAM) === '1' && window.parent !== window && parentOrigin !== null
  const rawTarget = params.get(TARGET_URL_PARAM)
  const targetUrl = rawTarget && parseOrigin(rawTarget) ? rawTarget : parentOrigin
  return { embedded, parentOrigin: embedded ? parentOrigin : null, targetUrl }
}

export function parseOrigin(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}
