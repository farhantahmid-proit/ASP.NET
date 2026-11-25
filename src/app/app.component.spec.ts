import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AppComponent } from './app.component';
import { AuditService } from './services/audit.service';

describe('AppComponent Keyboard Shortcuts & Summary Modal', () => {
  let httpMock: HttpTestingController;
  let auditService: AuditService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    auditService = TestBed.inject(AuditService);
  });

  afterEach(() => {
    auditService.stopPolling();
    const pendingConfig = httpMock.match('/api/config');
    for (const req of pendingConfig) {
      req.flush({ liveLighthouseAvailable: false });
    }
    httpMock.verify();
  });

  it('triggers S, C, M, P keyboard shortcuts in the audit report view (Step 3)', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    auditService.step.set(3);
    const selectSpy = spyOn(auditService, 'selectAllCommits').and.stub();
    const clearSpy = spyOn(auditService, 'clearAllCommits').and.stub();
    const mdSpy = spyOn(auditService, 'exportReportAsMarkdown').and.resolveTo();
    const pdfSpy = spyOn(auditService, 'exportReportAsPdf').and.resolveTo();

    component.onGlobalKeyDown(new KeyboardEvent('keydown', { key: 's' }));
    expect(selectSpy).toHaveBeenCalledTimes(1);

    component.onGlobalKeyDown(new KeyboardEvent('keydown', { key: 'c' }));
    expect(clearSpy).toHaveBeenCalledTimes(1);

    component.onGlobalKeyDown(new KeyboardEvent('keydown', { key: 'm' }));
    expect(mdSpy).toHaveBeenCalledTimes(1);

    component.onGlobalKeyDown(new KeyboardEvent('keydown', { key: 'p' }));
    expect(pdfSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores shortcuts outside Step 3/7 or when modifier keys / inputs are active', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    const selectSpy = spyOn(auditService, 'selectAllCommits').and.stub();

    // Step 1: should ignore
    auditService.step.set(1);
    component.onGlobalKeyDown(new KeyboardEvent('keydown', { key: 's' }));
    expect(selectSpy).not.toHaveBeenCalled();

    // Step 3 with Ctrl modifier: should ignore
    auditService.step.set(3);
    component.onGlobalKeyDown(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    expect(selectSpy).not.toHaveBeenCalled();

    // Step 3 when typing inside an <input>: should ignore
    const input = document.createElement('input');
    const inputEvt = new KeyboardEvent('keydown', { key: 's' });
    Object.defineProperty(inputEvt, 'target', { value: input });
    component.onGlobalKeyDown(inputEvt);
    expect(selectSpy).not.toHaveBeenCalled();
  });
});
