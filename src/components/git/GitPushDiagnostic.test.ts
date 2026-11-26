import { describe, expect, it } from 'vitest'
import { parseAndValidateClientPushUrl } from '@/api/git/git'
import { buildSshCliSteps, classifyPushErrorText } from './GitHubSshGuide'

describe('components/git troubleshooting helpers', () => {
  it('validates SSH, HTTPS, and owner/repo push URLs and rejects shell-injection inputs', () => {
    const ssh = parseAndValidateClientPushUrl('git@github.com:fresnel-sandbox/lumina-web-app.git')
    expect(ssh.valid).toBe(true)
    expect(ssh.protocol).toBe('ssh')
    expect(ssh.owner).toBe('fresnel-sandbox')
    expect(ssh.repo).toBe('lumina-web-app')

    const https = parseAndValidateClientPushUrl('https://github.com/fresnel-sandbox/lumina-web-app')
    expect(https.valid).toBe(true)
    expect(https.protocol).toBe('https')

    const badProto = parseAndValidateClientPushUrl('ext::sh -c whoami')
    expect(badProto.valid).toBe(false)

    const shellChars = parseAndValidateClientPushUrl('https://github.com/org/repo;rm -rf /')
    expect(shellChars.valid).toBe(false)
  })

  it('classifies publickey errors and sanitizes generated SSH setup commands', () => {
    const classified = classifyPushErrorText('git@github.com: Permission denied (publickey).')
    expect(classified.isMissingSshKey).toBe(true)

    const steps = buildSshCliSteps({
      email: 'dev@example.com;rm -rf /',
      algorithm: 'ed25519',
      os: 'linux',
      repoFullName: 'fresnel-sandbox/lumina-web-app',
      headBranch: 'fresnel/fix-1',
    })
    expect(steps.length).toBe(5)
    expect(steps[1]?.command).not.toContain(';')
    expect(steps[4]?.command).toContain('git push -u origin fresnel/fix-1')
  })
})
