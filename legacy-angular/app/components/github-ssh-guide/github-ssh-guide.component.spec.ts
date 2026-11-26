import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  GithubSshGuideComponent,
  buildSshCliSteps,
  classifyPushErrorText,
  sanitizeSshEmail
} from './github-ssh-guide.component';

describe('GithubSshGuideComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GithubSshGuideComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('sanitizes SSH key comment emails and rejects shell metacharacters', () => {
    expect(sanitizeSshEmail('dev@acme.io')).toBe('dev@acme.io');
    expect(sanitizeSshEmail('bad"; rm -rf /;@acme.io')).toBe('bad rm -rf /@acme.io');
    expect(sanitizeSshEmail('not-an-email')).toBe('you@example.com');
  });

  it('classifies Permission denied (publickey) push errors accurately', () => {
    const matched = classifyPushErrorText('git@github.com: Permission denied (publickey).');
    expect(matched.isMissingSshKey).toBeTrue();

    const unmatched = classifyPushErrorText('everything up-to-date');
    expect(unmatched.isMissingSshKey).toBeFalse();
  });

  it('builds 5 deterministic CLI setup steps with sanitized repo and branch arguments', () => {
    const steps = buildSshCliSteps({
      email: 'sabit@oitsdhaka.com',
      algorithm: 'ed25519',
      os: 'mac',
      repoFullName: 'FarhanSabit/ftsmm-ftseo-aisec-auditool',
      headBranch: 'feat/zero-ai-oss-audit-engine'
    });

    expect(steps.length).toBe(5);
    expect(steps[1].command).toBe('ssh-keygen -t ed25519 -C "sabit@oitsdhaka.com"');
    expect(steps[2].command).toContain('ssh-add --apple-use-keychain ~/.ssh/id_ed25519');
    expect(steps[3].command).toBe('pbcopy < ~/.ssh/id_ed25519.pub');
    expect(steps[4].command).toContain(
      'git remote set-url origin git@github.com:FarhanSabit/ftsmm-ftseo-aisec-auditool.git'
    );
    expect(steps[4].command).toContain('git push -u origin feat/zero-ai-oss-audit-engine');
  });

  it('auto-expands the CLI guide when /api/git/ssh-status reports a missing SSH key', () => {
    const fixture = TestBed.createComponent(GithubSshGuideComponent);
    fixture.componentRef.setInput('repoFullName', 'FarhanSabit/ftsmm-ftseo-aisec-auditool');
    fixture.componentRef.setInput('headBranch', 'feat/zero-ai-oss-audit-engine');
    fixture.detectChanges();

    const req = httpMock.expectOne('/api/git/ssh-status');
    expect(req.request.method).toBe('GET');
    req.flush({
      status: 'missing_key',
      missingSshKey: true,
      sshDirExists: false,
      detectedPublicKeys: [],
      hasMatchingPrivateKey: false,
      agentLoadedCount: null,
      hasConfigFile: false,
      hasGithubConfigEntry: false,
      sshKeygenAvailable: true,
      gitAvailable: true,
      probeAttempted: false,
      probeAuthenticated: null,
      probeMessage: null,
      githubAccountKeysCount: null,
      checkedAtIso: '2026-11-24T20:00:00.000Z',
      recommendations: ['Generate an Ed25519 key with ssh-keygen.']
    });

    fixture.detectChanges();

    expect(fixture.componentInstance.isMissingKeyFlagged()).toBeTrue();
    expect(fixture.componentInstance.isExpanded()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('GitHub SSH Key Missing');
    expect(fixture.nativeElement.textContent).toContain('ssh-keygen -t ed25519');
  });
});
