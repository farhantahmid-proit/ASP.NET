import { parse as acornParse, type Node as AcornNode } from 'acorn';
import {
  AstAuditExecutionSummary,
  AstWorkerProgressPayload,
  ImportedSourceFile,
  analyzeSourceFilesWithAcorn
} from './ast-analyzer.engine';
import { AuditCommit, AuditImpactMetrics, AuditSession } from '../models/audit.model';
import type {
  CodeAnalysisAnalyzeMessage,
  CodeAnalysisCancelMessage,
  CodeAnalysisParseSnippetMessage,
  CodeAnalysisSnippetParsedMessage,
  CodeAnalysisWorkerOutgoingMessage
} from './code-analysis.worker';

export interface CodeAnalysisBatchResult {
  session: AuditSession;
  impact: AuditImpactMetrics;
  commits: AuditCommit[];
  summary: AstAuditExecutionSummary;
}

export interface AstSnippetParseResult {
  filePath: string;
  parsedSuccessfully: boolean;
  sourceType: 'module' | 'script' | null;
  astNodeCount: number;
  imports: string[];
  exports: string[];
  functionsCount: number;
  parseError: string | null;
  durationMs: number;
}

export type CodeAnalysisProgressCallback = (progress: AstWorkerProgressPayload) => void;

interface PendingAnalyzeRequest {
  kind: 'analyze';
  resolve: (result: CodeAnalysisBatchResult) => void;
  reject: (err: Error) => void;
  onProgress?: CodeAnalysisProgressCallback;
}

interface PendingSnippetRequest {
  kind: 'snippet';
  resolve: (result: AstSnippetParseResult) => void;
  reject: (err: Error) => void;
}

type PendingWorkerRequest = PendingAnalyzeRequest | PendingSnippetRequest;

/**
 * CodeAnalysisWorker manages an off-main-thread Web Worker running the Acorn
 * ESTree JavaScript/TypeScript AST parser so repository audits and code scans
 * never freeze UI rendering, scroll, or chart animations.
 *
 * Automatically falls back to async microtask/macrotask chunked execution when
 * Web Workers are unavailable (e.g., SSR or headless test environments).
 */
export class CodeAnalysisWorker {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingWorkerRequest>();
  private requestCounter = 0;

  get isWorkerSupported(): boolean {
    return typeof Worker !== 'undefined';
  }

  get hasActiveWorker(): boolean {
    return this.worker !== null;
  }

  private nextRequestId(prefix: string): string {
    this.requestCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.requestCounter}`;
  }

  private ensureWorker(): Worker | null {
    if (!this.isWorkerSupported) {
      return null;
    }

    if (!this.worker) {
      try {
        const instance = new Worker(
          new URL('./code-analysis.worker', import.meta.url),
          { type: 'module' }
        );
        instance.onmessage = ({ data }: MessageEvent<CodeAnalysisWorkerOutgoingMessage>) => {
          this.handleMessage(data);
        };
        instance.onerror = (event: ErrorEvent) => {
          const err = new Error(
            event.message || 'CodeAnalysisWorker encountered an unexpected AST parser error.'
          );
          for (const [, entry] of this.pending) {
            entry.reject(err);
          }
          this.pending.clear();
        };
        this.worker = instance;
      } catch {
        this.worker = null;
      }
    }

    return this.worker;
  }

  private handleMessage(msg: CodeAnalysisWorkerOutgoingMessage): void {
    if (!msg || !msg.requestId) return;
    const entry = this.pending.get(msg.requestId);
    if (!entry) return;

    if (msg.type === 'progress') {
      if (entry.kind === 'analyze' && entry.onProgress) {
        entry.onProgress(msg);
      }
      return;
    }

    this.pending.delete(msg.requestId);

    if (msg.type === 'error') {
      entry.reject(new Error(msg.message));
      return;
    }

    if (msg.type === 'complete' && entry.kind === 'analyze') {
      entry.resolve({
        session: msg.session,
        impact: msg.impact,
        commits: msg.commits,
        summary: msg.summary
      });
      return;
    }

    if (msg.type === 'snippet-parsed' && entry.kind === 'snippet') {
      const parsed: CodeAnalysisSnippetParsedMessage = msg;
      entry.resolve({
        filePath: parsed.filePath,
        parsedSuccessfully: parsed.parsedSuccessfully,
        sourceType: parsed.sourceType,
        astNodeCount: parsed.astNodeCount,
        imports: parsed.imports,
        exports: parsed.exports,
        functionsCount: parsed.functionsCount,
        parseError: parsed.parseError,
        durationMs: parsed.durationMs
      });
    }
  }

  /**
   * Asynchronously analyzes a repository's JavaScript, TypeScript, and HTML source
   * files with Acorn inside a dedicated Web Worker thread.
   */
  analyzeRepository(
    repoName: string,
    files: ImportedSourceFile[],
    onProgress?: CodeAnalysisProgressCallback
  ): Promise<CodeAnalysisBatchResult> {
    const requestId = this.nextRequestId('ast_repo');
    const worker = this.ensureWorker();

    if (worker) {
      return new Promise<CodeAnalysisBatchResult>((resolve, reject) => {
        this.pending.set(requestId, {
          kind: 'analyze',
          resolve,
          reject,
          onProgress
        });

        const message: CodeAnalysisAnalyzeMessage = {
          type: 'analyze',
          requestId,
          repoName,
          files
        };
        worker.postMessage(message);
      });
    }

    // Async non-blocking fallback when Web Workers are unavailable
    return new Promise<CodeAnalysisBatchResult>((resolve, reject) => {
      setTimeout(() => {
        try {
          const result = analyzeSourceFilesWithAcorn(
            { requestId, repoName, files },
            onProgress,
            false
          );
          resolve(result);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Acorn AST fallback analysis failed.'));
        }
      }, 0);
    });
  }

  /**
   * Asynchronously parses a single JavaScript source snippet with Acorn off the
   * main thread and returns AST node metrics, imports, exports, and syntax status.
   */
  parseSourceSnippet(filePath: string, content: string): Promise<AstSnippetParseResult> {
    const requestId = this.nextRequestId('ast_snip');
    const worker = this.ensureWorker();

    if (worker) {
      return new Promise<AstSnippetParseResult>((resolve, reject) => {
        this.pending.set(requestId, {
          kind: 'snippet',
          resolve,
          reject
        });

        const message: CodeAnalysisParseSnippetMessage = {
          type: 'parse-snippet',
          requestId,
          filePath,
          content
        };
        worker.postMessage(message);
      });
    }

    return new Promise<AstSnippetParseResult>((resolve) => {
      setTimeout(() => {
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let parsed: AcornNode | null = null;
        let sourceType: 'module' | 'script' | null = null;
        let parseError: string | null = null;

        for (const mode of ['module', 'script'] as const) {
          try {
            parsed = acornParse(content || '', {
              ecmaVersion: 'latest',
              sourceType: mode,
              locations: true,
              allowHashBang: true,
              allowReturnOutsideFunction: true,
              allowImportExportEverywhere: true
            });
            sourceType = mode;
            parseError = null;
            break;
          } catch (err) {
            parseError = err instanceof Error ? err.message : 'Acorn parse error';
          }
        }

        const durationMs = Math.max(
          1,
          Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)
        );
        resolve({
          filePath,
          parsedSuccessfully: parsed !== null,
          sourceType,
          astNodeCount: parsed ? 1 : 0,
          imports: [],
          exports: [],
          functionsCount: 0,
          parseError,
          durationMs
        });
      }, 0);
    });
  }

  /**
   * Cancels pending requests or a specific request ID.
   */
  cancel(requestId?: string): void {
    if (requestId) {
      const pending = this.pending.get(requestId);
      if (pending) {
        this.pending.delete(requestId);
        pending.reject(new Error('CodeAnalysisWorker request was cancelled.'));
      }
      if (this.worker) {
        const msg: CodeAnalysisCancelMessage = { type: 'cancel', requestId };
        this.worker.postMessage(msg);
      }
      return;
    }

    for (const [id, entry] of this.pending) {
      entry.reject(new Error('CodeAnalysisWorker request was cancelled.'));
      if (this.worker) {
        const msg: CodeAnalysisCancelMessage = { type: 'cancel', requestId: id };
        this.worker.postMessage(msg);
      }
    }
    this.pending.clear();
  }

  /**
   * Terminates the underlying Web Worker thread and cleans up all pending promises.
   */
  terminate(): void {
    this.cancel();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
