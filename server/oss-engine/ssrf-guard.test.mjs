import { describe, expect, it } from 'vitest'
import {
  assertPublicHttpUrl,
  fetchPublicUrlWithSafeRedirects,
  isPrivateIp,
} from './ssrf-guard.js'

describe('ssrf-guard', () => {
  it('detects private IPv4, loopback, metadata, CGNAT, ULA, link-local, and IPv4-mapped IPv6 addresses', () => {
    const blocked = [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456:789a::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '::ffff:7f00:1',
    ]
    for (const ip of blocked) {
      expect(isPrivateIp(ip), `Expected ${ip} to be blocked`).toBe(true)
    }
    expect(isPrivateIp('93.184.216.34')).toBe(false)
    expect(isPrivateIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false)
  })

  it('rejects private/loopback/metadata hosts, non-HTTP schemes, credentials, and private hex-mapped IPs', async () => {
    const blockedUrls = [
      'http://127.0.0.1:3000',
      'http://localhost:8000/admin',
      'http://10.0.0.1/internal',
      'http://172.16.0.1/status',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:3000/',
      'http://[fc00::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://[::ffff:7f00:1]/',
      'file:///etc/passwd',
      'http://user:pass@example.com',
    ]

    const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

    for (const raw of blockedUrls) {
      await expect(assertPublicHttpUrl(raw, { lookupImpl: publicLookup })).rejects.toThrow()
    }
  })

  it('blocks DNS rebinding where a hostname resolves to a private IP', async () => {
    await expect(
      assertPublicHttpUrl('https://rebind.attacker.example/secret', {
        lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
      }),
    ).rejects.toThrow(/restricted private/i)
  })

  it('blocks a public URL that returns an HTTP 302 redirect to http://127.0.0.1/admin', async () => {
    const publicLookup = async (host) => {
      if (host === 'example.com') return [{ address: '93.184.216.34', family: 4 }]
      return [{ address: '127.0.0.1', family: 4 }]
    }

    const fetchMock = async (url) => {
      if (url.startsWith('https://example.com')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/admin' },
        })
      }
      throw new Error('Should never fetch internal redirect target')
    }

    await expect(
      fetchPublicUrlWithSafeRedirects('https://example.com/start', {
        lookupImpl: publicLookup,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow(/private|loopback|blocked/i)
  })
})
