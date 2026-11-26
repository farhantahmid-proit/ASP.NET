const FRESNEL_CLIENT_ID_STORAGE_KEY = 'fresnel-client-id'
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/

let inMemoryClientId = ''

export function getFresnelApiBaseUrl(
  env: { VITE_FRESNEL_API_BASE_URL?: string; VITE_API_BASE_URL?: string } = import.meta.env,
): string {
  return (env.VITE_FRESNEL_API_BASE_URL ?? env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
}

export const apiBaseUrl = getFresnelApiBaseUrl()

function generateClientId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return `cid-${globalThis.crypto.randomUUID()}`
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function getAuditClientId(): string {
  if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
    try {
      const existing = window.sessionStorage.getItem(FRESNEL_CLIENT_ID_STORAGE_KEY)?.trim()
      if (existing && CLIENT_ID_PATTERN.test(existing)) {
        inMemoryClientId = existing
        return existing
      }
      const generated = generateClientId()
      window.sessionStorage.setItem(FRESNEL_CLIENT_ID_STORAGE_KEY, generated)
      inMemoryClientId = generated
      return generated
    } catch {
      // Fall back to in-memory client ID when storage is restricted
    }
  }
  if (!inMemoryClientId || !CLIENT_ID_PATTERN.test(inMemoryClientId)) {
    inMemoryClientId = generateClientId()
  }
  return inMemoryClientId
}

export async function parseApiError(response: Response, fallback: string): Promise<Error> {
  const body: unknown = await response.json().catch(() => null)
  if (typeof body === 'object' && body !== null) {
    if ('detail' in body) {
      const detail = (body as { detail: unknown }).detail
      if (typeof detail === 'string') return new Error(detail)
      if (Array.isArray(detail)) {
        const firstMsg = detail.find(
          (item): item is { msg: string } =>
            typeof item === 'object' && item !== null && 'msg' in item && typeof item.msg === 'string',
        )?.msg
        if (firstMsg) return new Error(firstMsg)
      }
    }
    if ('error' in body) {
      const err = (body as { error: unknown }).error
      if (typeof err === 'string') return new Error(err)
      if (
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        typeof (err as { message: unknown }).message === 'string'
      ) {
        return new Error((err as { message: string }).message)
      }
    }
  }
  return new Error(fallback)
}

export type ApiFetchOptions = RequestInit & {
  accessToken?: string
  fallbackError?: string
  includeClientId?: boolean
}

async function performApiRequest(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const {
    accessToken,
    fallbackError = 'Request failed. Please try again.',
    includeClientId = false,
    headers,
    ...init
  } = options
  const mergedHeaders = new Headers(headers)
  if (accessToken && !mergedHeaders.has('Authorization')) {
    mergedHeaders.set('Authorization', `Bearer ${accessToken}`)
  }
  if (includeClientId && !mergedHeaders.has('x-client-id')) {
    mergedHeaders.set('x-client-id', getAuditClientId())
  }
  if (init.body && !(init.body instanceof FormData) && !mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${getFresnelApiBaseUrl()}${path}`, {
    ...init,
    headers: mergedHeaders,
  })

  if (!response.ok) {
    throw await parseApiError(response, fallbackError)
  }

  return response
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const response = await performApiRequest(path, options)
  return response.json() as Promise<T>
}

export async function apiFetchText(path: string, options: ApiFetchOptions = {}): Promise<string> {
  const response = await performApiRequest(path, options)
  return response.text()
}

export async function apiFetchBlob(path: string, options: ApiFetchOptions = {}): Promise<Blob> {
  const response = await performApiRequest(path, options)
  return response.blob()
}
