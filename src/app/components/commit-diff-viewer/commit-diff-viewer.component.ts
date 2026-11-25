import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  SideBySideFileDiff,
  parseUnifiedDiffToSideBySide
} from '../../utils/side-by-side-diff.util';

@Component({
  selector: 'app-commit-diff-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sbs-diff-viewer" role="region" aria-label="Side-by-side visual code diff">
      @for (file of parsedFiles(); track file.id) {
        <section class="sbs-file-block" [attr.aria-label]="'Changes in ' + file.filePath">
          <header class="sbs-file-header">
            <div class="sbs-file-header__left">
              <span class="sbs-file-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M4 2.2h5.2L12.8 5.8v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1z" stroke-linejoin="round" />
                  <path d="M9 2.3v3.6h3.6" stroke-linejoin="round" />
                </svg>
              </span>
              <code class="sbs-file-path">{{ file.filePath }}</code>
            </div>
            <div class="sbs-file-stats" aria-label="File diff line statistics">
              <span class="sbs-stat sbs-stat--add">+{{ file.additions }}</span>
              <span class="sbs-stat sbs-stat--del">-{{ file.deletions }}</span>
            </div>
          </header>

          <div class="sbs-column-labels" aria-hidden="true">
            <div class="sbs-column-label sbs-column-label--before">Original</div>
            <div class="sbs-column-label sbs-column-label--after">Updated</div>
          </div>

          <div class="sbs-grid-scroll">
            <table class="sbs-table">
              <colgroup>
                <col class="sbs-col-ln" />
                <col class="sbs-col-sign" />
                <col class="sbs-col-code" />
                <col class="sbs-col-ln" />
                <col class="sbs-col-sign" />
                <col class="sbs-col-code" />
              </colgroup>
              <tbody>
                @for (row of file.rows; track $index) {
                  @if (row.kind === 'hunk') {
                    <tr class="sbs-row sbs-row--hunk">
                      <td class="sbs-hunk-cell" colspan="6">
                        <code>{{ row.hunkHeader }}</code>
                      </td>
                    </tr>
                  } @else if (row.left && row.right) {
                    <tr class="sbs-row">
                      <!-- Left / Original Pane -->
                      <td
                        class="sbs-ln sbs-ln--left"
                        [class.sbs-cell--del]="row.left.type === 'del'"
                        [class.sbs-cell--empty]="row.left.type === 'empty'"
                      >
                        {{ row.left.lineNumber ?? '' }}
                      </td>
                      <td
                        class="sbs-sign sbs-sign--left"
                        [class.sbs-cell--del]="row.left.type === 'del'"
                        [class.sbs-cell--empty]="row.left.type === 'empty'"
                        aria-hidden="true"
                      >
                        {{ row.left.type === 'del' ? '-' : '' }}
                      </td>
                      <td
                        class="sbs-code sbs-code--left"
                        [class.sbs-cell--del]="row.left.type === 'del'"
                        [class.sbs-cell--empty]="row.left.type === 'empty'"
                      >
                        @if (row.left.type !== 'empty') {
                          <span class="sbs-code-text">
                            @for (seg of row.left.segments; track $index) {
                              @if (seg.changed) {
                                <mark class="sbs-mark sbs-mark--del">{{ seg.text }}</mark>
                              } @else {
                                <span>{{ seg.text }}</span>
                              }
                            }
                          </span>
                        }
                      </td>

                      <!-- Right / Updated Pane -->
                      <td
                        class="sbs-ln sbs-ln--right"
                        [class.sbs-cell--add]="row.right.type === 'add'"
                        [class.sbs-cell--empty]="row.right.type === 'empty'"
                      >
                        {{ row.right.lineNumber ?? '' }}
                      </td>
                      <td
                        class="sbs-sign sbs-sign--right"
                        [class.sbs-cell--add]="row.right.type === 'add'"
                        [class.sbs-cell--empty]="row.right.type === 'empty'"
                        aria-hidden="true"
                      >
                        {{ row.right.type === 'add' ? '+' : '' }}
                      </td>
                      <td
                        class="sbs-code sbs-code--right"
                        [class.sbs-cell--add]="row.right.type === 'add'"
                        [class.sbs-cell--empty]="row.right.type === 'empty'"
                      >
                        @if (row.right.type !== 'empty') {
                          <span class="sbs-code-text">
                            @for (seg of row.right.segments; track $index) {
                              @if (seg.changed) {
                                <mark class="sbs-mark sbs-mark--add">{{ seg.text }}</mark>
                              } @else {
                                <span>{{ seg.text }}</span>
                              }
                            }
                          </span>
                        }
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </section>
      } @empty {
        <div class="sbs-empty-state">No code diff lines available for this commit.</div>
      }
    </div>
  `
})
export class CommitDiffViewerComponent {
  readonly diff = input.required<string>();
  readonly additions = input<number>(0);
  readonly deletions = input<number>(0);

  readonly parsedFiles = computed<SideBySideFileDiff[]>(() =>
    parseUnifiedDiffToSideBySide(this.diff())
  );
}
