import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { ExecutiveSummaryResult } from '../../models/audit.model';

@Component({
  selector: 'app-executive-summary-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="ai-executive-summary-section"
      class="ai-exec-summary-card"
      aria-labelledby="ai-exec-summary-title"
    >
      <div class="ai-exec-summary-card__head">
        <div class="ai-exec-summary-card__heading-group">
          <span class="ai-exec-summary-card__badge">
            <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
              <path d="M9 2.2l1.6 4.2 4.2 1.6-4.2 1.6L9 13.8l-1.6-4.2L3.2 8l4.2-1.6L9 2.2z" stroke-linejoin="round" />
            </svg>
            <span>AI Executive Summary</span>
          </span>
          @if (summary()?.model) {
            <span class="ai-exec-summary-card__model">{{ summary()!.model }}</span>
          }
        </div>

        <button
          type="button"
          id="ai-exec-summary-regenerate-btn"
          class="dashboard-inline-btn"
          [disabled]="isLoading()"
          (click)="regenerate.emit()"
          title="Regenerate AI Executive Summary from current selected audit improvements"
        >
          {{ isLoading() ? 'Synthesizing...' : 'Regenerate' }}
        </button>
      </div>

      @if (isLoading() && !summary()) {
        <div class="ai-exec-summary-card__loading" role="status" aria-live="polite">
          <span class="sr-only">Generating AI Executive Summary for this audit report...</span>
          <div class="ai-exec-summary-skeleton ai-exec-summary-skeleton--title"></div>
          <div class="ai-exec-summary-skeleton ai-exec-summary-skeleton--line"></div>
          <div class="ai-exec-summary-skeleton ai-exec-summary-skeleton--line-short"></div>
        </div>
      } @else if (errorMessage()) {
        <div class="ai-exec-summary-card__error" role="alert">
          <div class="ai-exec-summary-card__error-copy">
            <strong>Executive Summary unavailable</strong>
            <p>{{ errorMessage() }}</p>
          </div>
          <button
            type="button"
            id="ai-exec-summary-retry-btn"
            class="dashboard-inline-btn dashboard-inline-btn--primary"
            (click)="regenerate.emit()"
          >
            Retry
          </button>
        </div>
      } @else {
        @if (summary(); as exec) {
          <h2 id="ai-exec-summary-title" class="ai-exec-summary-card__headline">
            {{ exec.headline }}
          </h2>
          <p class="ai-exec-summary-card__body">{{ exec.summary }}</p>

          @if (exec.topImprovements.length > 0) {
            <div class="ai-exec-summary-card__highlights" aria-label="Most impactful audit improvements">
              @for (item of exec.topImprovements; track item.title) {
                <article class="ai-exec-improvement-pill">
                  <span class="ai-exec-improvement-pill__cat">{{ item.category }}</span>
                  <h3 class="ai-exec-improvement-pill__title">{{ item.title }}</h3>
                  <p class="ai-exec-improvement-pill__impact">{{ item.impact }}</p>
                </article>
              }
            </div>
          }

          @if (exec.recommendedNextStep) {
            <div class="ai-exec-summary-card__next">
              <span class="ai-exec-summary-card__next-label">Next step</span>
              <span>{{ exec.recommendedNextStep }}</span>
            </div>
          }
        }
      }
    </section>
  `
})
export class ExecutiveSummaryCardComponent {
  readonly summary = input<ExecutiveSummaryResult | null>(null);
  readonly isLoading = input<boolean>(false);
  readonly errorMessage = input<string | null>(null);

  readonly regenerate = output<void>();
}
