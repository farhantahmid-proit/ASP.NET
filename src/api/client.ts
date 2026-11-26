export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

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

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { accessToken?: string; fallbackError?: string } = {},
): Promise<T> {
  const { accessToken, fallbackError = 'Request failed. Please try again.', headers, ...init } = options
  const mergedHeaders = new Headers(headers)
  if (accessToken) {
    mergedHeaders.set('Authorization', `Bearer ${accessToken}`)
  }
  if (init.body && !(init.body instanceof FormData) && !mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: mergedHeaders,
  })

  if (!response.ok) {
    throw await parseApiError(response, fallbackError)
  }

  return response.json() as Promise<T>
}
