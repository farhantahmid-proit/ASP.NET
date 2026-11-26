import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal
} from '@angular/core';
import {
  LocalAuditFormat,
  LocalSavedAuditRecord
} from '../../models/audit.model';
import { AstWorkerAuditService } from '../../services/ast-worker-audit.service';
import { FileSystemAuditDataService } from '../../services/file-system-audit-data.service';

@Component({
  selector: 'app-ast-worker-scanner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ast-worker-panel" aria-labelledby="ast-worker-heading">
      <div class="ast-worker-panel__head">
        <div>
          <p class="biz-audit-kicker">
            <span>Web Worker · Acorn ESTree AST Parser</span>
            <span aria-hidden="true">·</span>
            <span>Zero Main-Thread Blocking</span>
          </p>
          <h2 id="ast-worker-heading" class="biz-audit-title">
            In-Browser Static AST Source Scanner
          </h2>
          <p class="biz-audit-subtitle">
            Import a local repository folder or source files (<code>.js</code>, <code>.ts</code>, <code>.jsx</code>, <code>.tsx</code>, <code>.html</code>) to run Acorn JavaScript AST analysis inside a dedicated Web Worker. Completed audits save locally via the File System Access API and immediately update the Dashboard D3.js donut chart.
          </p>
        </div>

        <div class="biz-audit-format-wrap">
          <span class="biz-audit-format-label">Output format</span>
          <div class="dashboard-segmented" role="group" aria-label="AST worker output file format">
            <button
              type="button"
              class="dashboard-segmented__btn"
              [class.is-active]="saveFormat() === 'json'"
              (click)="saveFormat.set('json')"
            >
              .JSON
            </button>
            <button
              type="button"
              class="dashboard-segmented__btn"
              [class.is-active]="saveFormat() === 'toon'"
              (click)="saveFormat.set('toon')"
            >
              .TOON
            </button>
            <button
              type="button"
              class="dashboard-segmented__btn"
              [class.is-active]="saveFormat() === 'markdown'"
              (click)="saveFormat.set('markdown')"
            >
              .MD
            </button>
          </div>
        </div>
      </div>

      <!-- Action Strip -->
      <div class="ast-worker-actions">
        <button
          type="button"
          id="ast-worker-import-folder-btn"
          class="primary-flow-btn ast-worker-btn"
          [disabled]="workerAudit.isAnalyzing()"
          (click)="onImportFolder()"
        >
          <span>Import Repository Folder</span>
        </button>

        <button
          type="button"
          id="ast-worker-import-files-btn"
          class="secondary-flow-btn ast-worker-btn"
          [disabled]="workerAudit.isAnalyzing()"
          (click)="onImportSourceFiles()"
        >
          <span>Import Source Files (.js / .ts / .html)</span>
        </button>

        <button
          type="button"
          id="ast-worker-sample-benchmark-btn"
          class="secondary-flow-btn ast-worker-btn"
          [disabled]="workerAudit.isAnalyzing()"
          (click)="onRunSampleBenchmark()"
        >
          <span>Run Sample Repo AST Scan</span>
        </button>

        <label class="biz-audit-device-toggle">
          <input
            type="checkbox"
            [checked]="autoSaveToDisk()"
            (change)="onToggleAutoSave($event)"
          />
          <span>
            {{
              fsData.hasConnectedDirectory()
                ? 'Auto-save to connected folder "' + fsData.connectedDirectoryName() + '"'
                : 'Prompt File System save on finish'
            }}
          </span>
        </label>
      </div>

      @if (workerAudit.errorMessage(); as err) {
        <p class="biz-audit-error" role="alert">{{ err }}</p>
      }

      <!-- Live Web Worker Progress Bar -->
      @if (workerAudit.isAnalyzing()) {
        <div class="biz-audit-progress" role="status" aria-live="polite">
          <div class="biz-audit-progress__top">
            <span class="biz-audit-progress__label">
              Parsing <code>{{ workerAudit.currentFile() }}</code> ({{ workerAudit.processedFiles() }}/{{ workerAudit.totalFiles() }} files)
            </span>
            <span class="biz-audit-progress__pct">
              {{ workerAudit.progressPercent() }}% · {{ workerAudit.astNodesSoFar().toLocaleString() }} AST nodes
            </span>
          </div>
          <div class="biz-audit-progress__track">
            <div class="biz-audit-progress__fill" [style.width.%]="workerAudit.progressPercent()"></div>
          </div>
        </div>
      }

      <!-- Completed AST Telemetry & Actions -->
      @if (workerAudit.lastSummary(); as summary) {
        @if (workerAudit.lastCompletedRecord(); as record) {
          <div class="biz-audit-result-bar" role="status" aria-live="polite">
            <div class="biz-audit-result-bar__info">
              <strong>{{ summary.repoFullName }}</strong>
              <span aria-hidden="true">·</span>
              <span>{{ summary.filesAnalyzed }} files ({{ summary.filesParsedWithAcorn }} Acorn AST)</span>
              <span aria-hidden="true">·</span>
              <span class="biz-audit-result-bar__scores">
                {{ summary.astNodesVisited.toLocaleString() }} nodes · {{ summary.findingsCount }} findings · {{ summary.durationMs }} ms {{ summary.executedInWorker ? 'in Web Worker' : 'local' }}
              </span>
            </div>
            <div class="biz-audit-result-bar__actions">
              <button
                type="button"
                id="ast-worker-open-report-btn"
                class="dashboard-inline-btn dashboard-inline-btn--primary"
                (click)="openSavedAudit.emit(record)"
              >
                Open Full Report
              </button>
              <button
                type="button"
                id="ast-worker-save-disk-btn"
                class="dashboard-inline-btn"
                (click)="onSaveLatestToDisk(record)"
              >
                Save .{{ saveFormat() === 'markdown' ? 'md' : saveFormat() }} to Disk
              </button>
            </div>
          </div>
        }
      }
    </section>
  `
})
export class AstWorkerScannerComponent {
  readonly workerAudit = inject(AstWorkerAuditService);
  readonly fsData = inject(FileSystemAuditDataService);

  readonly openSavedAudit = output<LocalSavedAuditRecord>();
  readonly auditCompleted = output<LocalSavedAuditRecord>();

  readonly saveFormat = signal<LocalAuditFormat>('json');
  readonly autoSaveToDisk = signal<boolean>(false);

  onToggleAutoSave(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    this.autoSaveToDisk.set(Boolean(el?.checked));
  }

  async onImportFolder(): Promise<void> {
    const rec = await this.workerAudit.pickRepositoryDirectoryAndAnalyze(
      this.saveFormat(),
      this.autoSaveToDisk()
    );
    if (rec) {
      this.auditCompleted.emit(rec);
    }
  }

  async onImportSourceFiles(): Promise<void> {
    const rec = await this.workerAudit.pickSourceFilesAndAnalyze(
      this.saveFormat(),
      this.autoSaveToDisk()
    );
    if (rec) {
      this.auditCompleted.emit(rec);
    }
  }

  async onRunSampleBenchmark(): Promise<void> {
    const rec = await this.workerAudit.runSampleRepositoryAstBenchmark(
      this.saveFormat(),
      this.autoSaveToDisk()
    );
    this.auditCompleted.emit(rec);
  }

  onSaveLatestToDisk(record: LocalSavedAuditRecord): void {
    void this.fsData.saveAuditResultToDisk(record, this.saveFormat());
  }
}
