import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Screen-reader-only accessible tooltip component (`role="tooltip"`) bound to an
 * interactive trigger via `aria-describedby`. Provides expanded context for
 * assistive technologies without adding visual clutter.
 */
@Component({
  selector: 'app-sr-tooltip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [id]="tooltipId()" role="tooltip" class="sr-only">
      {{ text() }}
    </span>
  `
})
export class SrTooltipComponent {
  readonly tooltipId = input.required<string>();
  readonly text = input.required<string>();
}
