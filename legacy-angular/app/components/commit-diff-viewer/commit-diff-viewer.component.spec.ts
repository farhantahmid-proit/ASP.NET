import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommitDiffViewerComponent } from './commit-diff-viewer.component';

describe('CommitDiffViewerComponent', () => {
  let fixture: ComponentFixture<CommitDiffViewerComponent>;
  let component: CommitDiffViewerComponent;

  const sampleDiff = [
    'diff --git a/src/app/widget.tsx b/src/app/widget.tsx',
    'index 1111111..2222222 100644',
    '--- a/src/app/widget.tsx',
    '+++ b/src/app/widget.tsx',
    '@@ -4,3 +4,4 @@',
    ' export function Widget() {',
    '-  var count = 1;',
    '+  const count = 1;',
    '+  return <button type="button" aria-label="Dismiss" />;',
    ' }'
  ].join('\n');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommitDiffViewerComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(CommitDiffViewerComponent);
    component = fixture.componentInstance;
  });

  it('renders a side-by-side table with file header, Original/Updated columns, and add/del highlights', () => {
    fixture.componentRef.setInput('diff', sampleDiff);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.sbs-file-path')?.textContent?.trim()).toBe('src/app/widget.tsx');
    expect(el.querySelector('.sbs-stat--add')?.textContent?.trim()).toBe('+2');
    expect(el.querySelector('.sbs-stat--del')?.textContent?.trim()).toBe('-1');

    const colLabels = Array.from(el.querySelectorAll('.sbs-column-label')).map((n) =>
      n.textContent?.trim()
    );
    expect(colLabels).toEqual(['Original', 'Updated']);

    // Verify deletion and addition cells + intra-line marks render cleanly
    expect(el.querySelectorAll('.sbs-code.sbs-cell--del').length).toBe(1);
    expect(el.querySelectorAll('.sbs-code.sbs-cell--add').length).toBe(2);
    expect(el.querySelectorAll('.sbs-code.sbs-cell--empty').length).toBe(1);
    expect(el.querySelector('.sbs-mark--del')?.textContent).toBe('var');
    expect(el.querySelector('.sbs-mark--add')?.textContent).toBe('const');
  });

  it('renders an accessible empty state when diff string is empty', () => {
    fixture.componentRef.setInput('diff', '');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(component.parsedFiles().length).toBe(0);
    expect(el.querySelector('.sbs-empty-state')?.textContent).toContain('No code diff lines');
  });
});
