import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MESSAGE_SOURCE,
  isHostEvent,
  isWidgetEvent,
  parseOrigin,
  readEmbedContext,
} from './protocol'

describe('embed/protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('parseOrigin', () => {
    it('normalizes valid http and https origins', () => {
      expect(parseOrigin('https://example.com/some/path?x=1')).toBe('https://example.com')
      expect(parseOrigin('http://localhost:3000/widget')).toBe('http://localhost:3000')
    })

    it('rejects javascript:, data:, file:, empty, and malformed URLs', () => {
      expect(parseOrigin('javascript:alert(1)')).toBeNull()
      expect(parseOrigin('data:text/html,hi')).toBeNull()
      expect(parseOrigin('file:///etc/passwd')).toBeNull()
      expect(parseOrigin('')).toBeNull()
      expect(parseOrigin(null)).toBeNull()
      expect(parseOrigin(undefined)).toBeNull()
      expect(parseOrigin('not-a-url')).toBeNull()
    })
  })

  describe('isWidgetEvent', () => {
    it('accepts valid fresnel-audit widget events', () => {
      expect(isWidgetEvent({ source: MESSAGE_SOURCE, type: 'ready' })).toBe(true)
      expect(isWidgetEvent({ source: MESSAGE_SOURCE, type: 'close' })).toBe(true)
      expect(
        isWidgetEvent({ source: MESSAGE_SOURCE, type: 'audit_started', targetUrl: 'https://a.test' }),
      ).toBe(true)
      expect(isWidgetEvent({ source: MESSAGE_SOURCE, type: 'audit_completed', score: 94 })).toBe(
        true,
      )
    })

    it('rejects wrong source, unknown types, and primitives', () => {
      expect(isWidgetEvent({ source: 'kbchat', type: 'ready' })).toBe(false)
      expect(isWidgetEvent({ source: MESSAGE_SOURCE, type: 'opened' })).toBe(false)
      expect(isWidgetEvent(null)).toBe(false)
      expect(isWidgetEvent('ready')).toBe(false)
    })
  })

  describe('isHostEvent', () => {
    it('accepts valid fresnel-audit host events', () => {
      expect(isHostEvent({ source: MESSAGE_SOURCE, type: 'opened' })).toBe(true)
      expect(isHostEvent({ source: MESSAGE_SOURCE, type: 'closed' })).toBe(true)
      expect(
        isHostEvent({ source: MESSAGE_SOURCE, type: 'run_audit', targetUrl: 'https://a.test' }),
      ).toBe(true)
    })

    it('rejects widget events or invalid payloads', () => {
      expect(isHostEvent({ source: MESSAGE_SOURCE, type: 'ready' })).toBe(false)
      expect(isHostEvent({ source: 'other', type: 'opened' })).toBe(false)
      expect(isHostEvent(undefined)).toBe(false)
    })
  })

  describe('readEmbedContext', () => {
    it('treats top-level window as standalone even when ?embed=1 is set', () => {
      const topWin = { location: { search: '' } } as unknown as Window & typeof globalThis
      Object.defineProperty(topWin, 'parent', { value: topWin, configurable: true })
      vi.stubGlobal('window', topWin)

      const ctx = readEmbedContext('?embed=1&origin=https%3A%2F%2Fhost.example')
      expect(ctx.embedded).toBe(false)
      expect(ctx.parentOrigin).toBeNull()
      expect(ctx.targetUrl).toBe('https://host.example')
    })

    it('marks embedded=true inside iframe with valid http(s) parent origin', () => {
      const parentWin = {} as Window
      const childWin = { parent: parentWin, location: { search: '' } } as unknown as Window &
        typeof globalThis
      vi.stubGlobal('window', childWin)

      const ctx = readEmbedContext(
        '?embed=1&origin=https%3A%2F%2Fapp.example%2Fpage&target=https%3A%2F%2Fapp.example%2Fpricing',
      )
      expect(ctx.embedded).toBe(true)
      expect(ctx.parentOrigin).toBe('https://app.example')
      expect(ctx.targetUrl).toBe('https://app.example/pricing')
    })

    it('rejects javascript: origin inside iframe', () => {
      const parentWin = {} as Window
      const childWin = { parent: parentWin, location: { search: '' } } as unknown as Window &
        typeof globalThis
      vi.stubGlobal('window', childWin)

      const ctx = readEmbedContext('?embed=1&origin=javascript%3Aalert(1)')
      expect(ctx.embedded).toBe(false)
      expect(ctx.parentOrigin).toBeNull()
    })
  })
})
