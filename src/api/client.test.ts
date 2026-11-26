import { describe, expect, it } from 'vitest'
import { parseApiError } from './client'

function jsonResponse(payload: unknown, status = 400): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('api/client parseApiError', () => {
  it('extracts string detail errors', async () => {
    const err = await parseApiError(
      jsonResponse({ detail: 'An account with this email already exists.' }, 409),
      'Fallback message',
    )
    expect(err.message).toBe('An account with this email already exists.')
  })

  it('extracts FastAPI-style validation array detail[{ msg }]', async () => {
    const err = await parseApiError(
      jsonResponse({ detail: [{ loc: ['body', 'email'], msg: 'Invalid email address' }] }, 422),
      'Fallback message',
    )
    expect(err.message).toBe('Invalid email address')
  })

  it('extracts Fresnel string { error } payloads', async () => {
    const err = await parseApiError(
      jsonResponse({ error: 'Provide a valid public http(s) targetUrl to audit.' }, 400),
      'Fallback message',
    )
    expect(err.message).toBe('Provide a valid public http(s) targetUrl to audit.')
  })

  it('extracts Fresnel structured { error: { message } } payloads', async () => {
    const err = await parseApiError(
      jsonResponse(
        {
          error: {
            code: 'zero_ai_mode',
            message: 'Fresnel operates in 100% Zero-AI Open-Source mode.',
          },
        },
        410,
      ),
      'Fallback message',
    )
    expect(err.message).toBe('Fresnel operates in 100% Zero-AI Open-Source mode.')
  })

  it('falls back when body is non-JSON or lacks known fields', async () => {
    const textRes = new Response('Internal Server Error', { status: 500 })
    const err1 = await parseApiError(textRes, 'Fallback message')
    expect(err1.message).toBe('Fallback message')

    const err2 = await parseApiError(jsonResponse({ ok: false }, 500), 'Fallback message')
    expect(err2.message).toBe('Fallback message')
  })
})
