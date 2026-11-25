import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  GitPushFailureModalComponent,
  SshReadinessDiagnostic
} from './git-push-failure-modal.component';

const MOCK_SSH_STATUS: SshReadinessDiagnostic = {
  hasSshDirectory: true,
  hasKeysInSshDir: false,
  publicKeysFound: [],
  hasConfigFile: false,
  hasGithubConfigEntry: false,
  hasSshCommand: true,
  hasSshKeygenCommand: true,
  agentIdentitiesCount: 0,
  probeAuthenticated: false,
  probeMessage: 'Permission denied (publickey) from git@github.com',
  githubAccountKeysCount: 0,
  diagnosticRecommendation: 'Generate an Ed25519 key and add to GitHub settings.'
};

describe('GitPushFailureModalComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GitPushFailureModalComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('probes ssh-status automatically and displays terminal instructions when opened', async () => {
    const fixture = TestBed.createComponent(GitPushFailureModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput(
      'pushError',
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'
    );
    fixture.componentRef.setInput('repoFullName', 'acme/storefront');
    fixture.componentRef.setInput('repoUrl', 'https://github.com/acme/storefront');
    fixture.componentRef.setInput('headBranch', 'feat/perf-remediation');
    fixture.componentRef.setInput('defaultEmail', 'dev@example.com');
    fixture.detectChanges();

    const req = httpMock.expectOne('/api/git/ssh-status?probe=1');
    expect(req.request.method).toBe('GET');
    req.flush(MOCK_SSH_STATUS);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('GitHub Repository Push Failed');
    expect(el.textContent).toContain('Permission denied (publickey)');
    expect(el.textContent).toContain('Missing GitHub SSH Key in ~/.ssh');

    const steps = fixture.componentInstance.stepsList();
    expect(steps.length).toBe(5);
    expect(steps[1].command).toContain('ssh-keygen -t ed25519 -C "dev@example.com"');
    expect(steps[4].command).toContain('git push -u origin feat/perf-remediation');
  });

  it('emits closeModal and retryPush events on button clicks', () => {
    const fixture = TestBed.createComponent(GitPushFailureModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const req = httpMock.expectOne('/api/git/ssh-status?probe=1');
    req.flush(MOCK_SSH_STATUS);
    fixture.detectChanges();

    const closeSpy = jasmine.createSpy('closeModal');
    const retrySpy = jasmine.createSpy('retryPush');
    fixture.componentInstance.closeModal.subscribe(closeSpy);
    fixture.componentInstance.retryPush.subscribe(retrySpy);

    const closeBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '#close-push-failure-modal-btn'
    );
    closeBtn?.click();
    expect(closeSpy).toHaveBeenCalledTimes(1);

    const retryBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '#retry-push-btn'
    );
    retryBtn?.click();
    expect(retrySpy).toHaveBeenCalledTimes(1);

    fixture.componentInstance.toggleStepCompleted('step-1-ls');
    expect(fixture.componentInstance.completedSteps().has('step-1-ls')).toBeTrue();
  });
});
