import { ReactiveStore } from './reactive-state';
import {
  LocalAuditFormat,
  LocalSavedAuditRecord
} from '@/types/audit';
import {
  AstAuditExecutionSummary,
  ImportedSourceFile
} from '@/lib/workers/ast-analyzer.engine';
import { CodeAnalysisWorker } from '@/lib/workers/code-analysis-worker';
import { buildLocalSavedAuditRecord } from './local-audit-storage';
import { StorageService, storageService } from './storage';

const ANALYZABLE_SOURCE_EXT_RE = /\.(m?js|cjs|jsx|ts|tsx|html?|htm)$/i;
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.angular',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.cache'
]);
const MAX_IMPORTED_FILES = 150;
const MAX_SINGLE_FILE_BYTES = 512 * 1024;

interface FsaReadableFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

interface FsaReadableDirHandle {
  readonly kind: 'directory';
  readonly name: string;
  entries(): AsyncIterableIterator<[string, FsaReadableFileHandle | FsaReadableDirHandle]>;
}

interface FsaPickerWindow {
  showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FsaReadableDirHandle>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FsaReadableFileHandle[]>;
}

export function buildSampleRepositorySourceFiles(): ImportedSourceFile[] {
  return [
    {
      path: 'src/app/checkout.js',
      content: `
import * as lodashUtils from 'lodash';

export function computeCartSummary(items, config) {
  var total = 0;
  for (let i = 0; i < items.length; i++) {
    const rowEl = document.querySelector('.cart-row-' + i);
    if (items[i].qty == 0) continue;
    total += items[i].price * items[i].qty;
    if (rowEl) {
      rowEl.innerHTML = '<span>' + items[i].label + '</span>';
    }
  }
  const cloned = JSON.parse(JSON.stringify(items));
  console.log('Checkout total computed', total, cloned.length);
  return { total, count: lodashUtils.size(cloned) };
}
`
    },
    {
      path: 'src/app/auth-client.js',
      content: `
const STRIPE_API_KEY = '${['sk', 'live', 'example_hardcoded_key_9876543210'].join('_')}';

export function bootstrapAuth(rawFormula) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/session', false);
  try {
    xhr.send();
  } catch (err) {}
  return eval('(' + rawFormula + ')');
}

export function openBillingPortal(url) {
  window.open(url, '_blank');
}
`
    },
    {
      path: 'src/app/navigation.js',
      content: `
export function wireNavigation(cardEl, targetPath) {
  cardEl.tabIndex = 5;
  cardEl.addEventListener('click', () => {
    window.location.href = targetPath;
  });
}
`
    },
    {
      path: 'src/app/analytics-loader.ts',
      content: `
export interface TelemetryEvent {
  name: string;
  ts: number;
}

export function trackMetric(event: TelemetryEvent): void {
  if (event.ts != 0) {
    debugger;
    document.write('<script src="https://tracker.example/v1.js"><\\/script>');
  }
}
`
    },
    {
      path: 'src/index.html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Storefront App</title>
    <script src="/assets/legacy-vendor.js"></script>
  </head>
  <body>
    <header>
      <button><svg viewBox="0 0 24 24"></svg></button>
    </header>
    <main>
      <img src="/assets/hero-banner.webp">
    </main>
  </body>
</html>
`
    }
  ];
}

export interface AstWorkerAuditSnapshot {
  isAnalyzing: boolean;
  progressPercent: number;
  processedFiles: number;
  totalFiles: number;
  currentFile: string;
  findingsSoFar: number;
  astNodesSoFar: number;
  lastSummary: AstAuditExecutionSummary | null;
  lastCompletedRecord: LocalSavedAuditRecord | null;
  errorMessage: string | null;
}

export class AstWorkerAuditService extends ReactiveStore<AstWorkerAuditSnapshot> {
  private readonly storage: StorageService = storageService;
  private readonly codeAnalysisWorker = new CodeAnalysisWorker();

  readonly isAnalyzing = this.signal<boolean>(false);
  readonly progressPercent = this.signal<number>(0);
  readonly processedFiles = this.signal<number>(0);
  readonly totalFiles = this.signal<number>(0);
  readonly currentFile = this.signal<string>('');
  readonly findingsSoFar = this.signal<number>(0);
  readonly astNodesSoFar = this.signal<number>(0);
  readonly lastSummary = this.signal<AstAuditExecutionSummary | null>(null);
  readonly lastCompletedRecord = this.signal<LocalSavedAuditRecord | null>(null);
  readonly errorMessage = this.signal<string | null>(null);

  constructor() {
    super();
  }

  terminate(): void {
    this.codeAnalysisWorker.terminate();
  }

  protected override buildSnapshot(): AstWorkerAuditSnapshot {
    return {
      isAnalyzing: this.isAnalyzing(),
      progressPercent: this.progressPercent(),
      processedFiles: this.processedFiles(),
      totalFiles: this.totalFiles(),
      currentFile: this.currentFile(),
      findingsSoFar: this.findingsSoFar(),
      astNodesSoFar: this.astNodesSoFar(),
      lastSummary: this.lastSummary(),
      lastCompletedRecord: this.lastCompletedRecord(),
      errorMessage: this.errorMessage(),
    };
  }

  async analyzeImportedFiles(
    files: ImportedSourceFile[],
    repoName: string,
    saveFormat: LocalAuditFormat = 'json',
    promptDeviceSave = false
  ): Promise<LocalSavedAuditRecord> {
    if (files.length === 0) {
      throw new Error('No analyzable JavaScript, TypeScript, or HTML source files were found.');
    }

    this.errorMessage.set(null);
    this.isAnalyzing.set(true);
    this.progressPercent.set(2);
    this.processedFiles.set(0);
    this.totalFiles.set(files.length);
    this.currentFile.set(files[0].path);
    this.findingsSoFar.set(0);
    this.astNodesSoFar.set(0);

    try {
      const result = await this.codeAnalysisWorker.analyzeRepository(
        repoName,
        files,
        (progress) => {
          this.processedFiles.set(progress.processedFiles);
          this.totalFiles.set(progress.totalFiles);
          this.currentFile.set(progress.currentFile);
          this.progressPercent.set(progress.percent);
          this.findingsSoFar.set(progress.findingsSoFar);
          this.astNodesSoFar.set(progress.astNodesVisited);
        }
      );

      const scanTimestamp = Date.now().toString(36);
      const record = buildLocalSavedAuditRecord(
        result.session,
        result.impact,
        result.commits,
        saveFormat,
        `astw_${scanTimestamp}`
      );
      record.summaryNotes = `CodeAnalysisWorker (Acorn AST) analyzed ${result.summary.filesAnalyzed} source files (${result.summary.astNodesVisited.toLocaleString()} AST nodes walked in ${result.summary.durationMs} ms off the main thread) and generated ${result.summary.findingsCount} findings.`;

      const saved = await this.storage.persistAuditHistory(record, saveFormat, {
        promptDeviceSave
      });

      await this.storage.saveOfflineScanResult({
        scanId: `scan_${scanTimestamp}`,
        auditId: saved.auditId,
        repoFullName: result.summary.repoFullName,
        scannedAtIso: saved.updatedAtIso,
        filesAnalyzed: result.summary.filesAnalyzed,
        filesParsedWithAcorn: result.summary.filesParsedWithAcorn,
        astNodesVisited: result.summary.astNodesVisited,
        findingsCount: result.summary.findingsCount,
        durationMs: result.summary.durationMs,
        executedInWorker: result.summary.executedInWorker,
        categoryCounts: result.summary.categoryCounts,
        record: saved
      });

      this.progressPercent.set(100);
      this.findingsSoFar.set(result.summary.findingsCount);
      this.astNodesSoFar.set(result.summary.astNodesVisited);
      this.lastSummary.set(result.summary);
      this.lastCompletedRecord.set(saved);
      return saved;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'CodeAnalysisWorker encountered an unexpected AST parser error.';
      this.errorMessage.set(msg);
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      this.isAnalyzing.set(false);
    }
  }

  async runSampleRepositoryAstBenchmark(
    saveFormat: LocalAuditFormat = 'json',
    promptDeviceSave = false
  ): Promise<LocalSavedAuditRecord> {
    const sampleFiles = buildSampleRepositorySourceFiles();
    return this.analyzeImportedFiles(
      sampleFiles,
      'local/sample-storefront-repo',
      saveFormat,
      promptDeviceSave
    );
  }

  async pickSourceFilesAndAnalyze(
    saveFormat: LocalAuditFormat = 'json',
    promptDeviceSave = false
  ): Promise<LocalSavedAuditRecord | null> {
    this.errorMessage.set(null);
    if (typeof window === 'undefined') return null;

    const win = window as unknown as FsaPickerWindow;
    if (typeof win.showOpenFilePicker === 'function') {
      try {
        const handles = await win.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: 'Source Files (.js, .ts, .jsx, .tsx, .html)',
              accept: {
                'text/javascript': ['.js', '.mjs', '.cjs', '.jsx'],
                'text/typescript': ['.ts', '.tsx'],
                'text/html': ['.html', '.htm']
              }
            }
          ]
        });

        const collected: ImportedSourceFile[] = [];
        for (const handle of handles.slice(0, MAX_IMPORTED_FILES)) {
          const file = await handle.getFile();
          if (file.size > MAX_SINGLE_FILE_BYTES) continue;
          collected.push({
            path: file.name,
            content: await file.text(),
            sizeBytes: file.size
          });
        }

        if (collected.length === 0) {
          this.errorMessage.set('No supported JavaScript, TypeScript, or HTML files selected.');
          return null;
        }
        return this.analyzeImportedFiles(
          collected,
          `local/${collected[0].path.replace(/\.[^.]+$/, '')}-files`,
          saveFormat,
          promptDeviceSave
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return null;
        }
        // Fall through to standard file input if iframe restricts FSA picker
      }
    }

    const fallbackFiles = await this.pickViaHtmlInput(false);
    if (fallbackFiles.files.length === 0) return null;
    return this.analyzeImportedFiles(
      fallbackFiles.files,
      fallbackFiles.repoName,
      saveFormat,
      promptDeviceSave
    );
  }

  async pickRepositoryDirectoryAndAnalyze(
    saveFormat: LocalAuditFormat = 'json',
    promptDeviceSave = false
  ): Promise<LocalSavedAuditRecord | null> {
    this.errorMessage.set(null);
    if (typeof window === 'undefined') return null;

    const win = window as unknown as FsaPickerWindow;
    if (typeof win.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await win.showDirectoryPicker({ mode: 'read' });
        const collected: ImportedSourceFile[] = [];
        await this.collectDirectorySources(dirHandle, '', collected);

        if (collected.length === 0) {
          this.errorMessage.set(
            `No .js, .ts, .jsx, .tsx, or .html files found inside "${dirHandle.name}".`
          );
          return null;
        }

        return this.analyzeImportedFiles(
          collected,
          `local/${dirHandle.name}`,
          saveFormat,
          promptDeviceSave
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return null;
        }
        // Fall through to webkitdirectory input if iframe restricts showDirectoryPicker
      }
    }

    const fallbackFiles = await this.pickViaHtmlInput(true);
    if (fallbackFiles.files.length === 0) return null;
    return this.analyzeImportedFiles(
      fallbackFiles.files,
      fallbackFiles.repoName,
      saveFormat,
      promptDeviceSave
    );
  }

  private async collectDirectorySources(
    dirHandle: FsaReadableDirHandle,
    prefix: string,
    out: ImportedSourceFile[]
  ): Promise<void> {
    if (out.length >= MAX_IMPORTED_FILES) return;

    for await (const [name, entry] of dirHandle.entries()) {
      if (out.length >= MAX_IMPORTED_FILES) break;
      if (entry.kind === 'directory') {
        if (IGNORED_DIR_NAMES.has(name) || name.startsWith('.')) {
          continue;
        }
        const nextPrefix = prefix ? `${prefix}/${name}` : name;
        await this.collectDirectorySources(entry, nextPrefix, out);
      } else if (entry.kind === 'file' && ANALYZABLE_SOURCE_EXT_RE.test(name)) {
        try {
          const file = await entry.getFile();
          if (file.size > MAX_SINGLE_FILE_BYTES) continue;
          out.push({
            path: prefix ? `${prefix}/${name}` : name,
            content: await file.text(),
            sizeBytes: file.size
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  private pickViaHtmlInput(
    directoryMode: boolean
  ): Promise<{ repoName: string; files: ImportedSourceFile[] }> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      if (directoryMode) {
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
      } else {
        input.accept = '.js,.mjs,.cjs,.jsx,.ts,.tsx,.html,.htm';
      }
      input.style.display = 'none';
      document.body.appendChild(input);

      input.onchange = async () => {
        const selected = Array.from(input.files ?? []);
        document.body.removeChild(input);

        const files: ImportedSourceFile[] = [];
        let rootFolderName = 'imported-repository';

        for (const file of selected) {
          if (files.length >= MAX_IMPORTED_FILES) break;
          const relPath =
            (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
          const segments = relPath.split('/');
          if (segments.length > 1 && segments[0]) {
            rootFolderName = segments[0];
          }
          if (segments.some((seg) => IGNORED_DIR_NAMES.has(seg))) {
            continue;
          }
          if (!ANALYZABLE_SOURCE_EXT_RE.test(relPath) || file.size > MAX_SINGLE_FILE_BYTES) {
            continue;
          }
          try {
            files.push({
              path: relPath,
              content: await file.text(),
              sizeBytes: file.size
            });
          } catch {
            // Skip unreadable file
          }
        }

        resolve({ repoName: `local/${rootFolderName}`, files });
      };

      input.oncancel = () => {
        document.body.removeChild(input);
        resolve({ repoName: 'local/imported-repository', files: [] });
      };

      input.click();
    });
  }
}

export const astWorkerAuditService = new AstWorkerAuditService();
