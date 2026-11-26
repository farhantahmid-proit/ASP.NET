import { parse as acornParse, type Node as AcornNode } from 'acorn';
import {
  type AstAuditExecutionSummary,
  type AstWorkerProgressPayload,
  type ImportedSourceFile,
  analyzeSourceFilesWithAcorn
} from './ast-analyzer.engine';
import type { AuditCommit, AuditImpactMetrics, AuditSession } from '@/types/audit';

export interface CodeAnalysisAnalyzeMessage {
  type: 'analyze';
  requestId: string;
  repoName: string;
  files: ImportedSourceFile[];
}

export interface CodeAnalysisParseSnippetMessage {
  type: 'parse-snippet';
  requestId: string;
  filePath: string;
  content: string;
}

export interface CodeAnalysisCancelMessage {
  type: 'cancel';
  requestId: string;
}

export type CodeAnalysisWorkerIncomingMessage =
  | CodeAnalysisAnalyzeMessage
  | CodeAnalysisParseSnippetMessage
  | CodeAnalysisCancelMessage;

export interface CodeAnalysisSnippetParsedMessage {
  type: 'snippet-parsed';
  requestId: string;
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

export interface CodeAnalysisCompleteMessage {
  type: 'complete';
  requestId: string;
  session: AuditSession;
  impact: AuditImpactMetrics;
  commits: AuditCommit[];
  summary: AstAuditExecutionSummary;
}

export interface CodeAnalysisErrorMessage {
  type: 'error';
  requestId: string;
  message: string;
}

export type CodeAnalysisWorkerOutgoingMessage =
  | AstWorkerProgressPayload
  | CodeAnalysisCompleteMessage
  | CodeAnalysisSnippetParsedMessage
  | CodeAnalysisErrorMessage;

interface GenericNode extends AcornNode {
  [key: string]: unknown;
}

const cancelledRequests = new Set<string>();

function inspectAcornProgram(ast: GenericNode): {
  astNodeCount: number;
  imports: string[];
  exports: string[];
  functionsCount: number;
} {
  let astNodeCount = 0;
  let functionsCount = 0;
  const imports: string[] = [];
  const exports: string[] = [];

  const visit = (node: GenericNode | null | undefined): void => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    astNodeCount += 1;

    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      functionsCount += 1;
    } else if (node.type === 'ImportDeclaration') {
      const source = node['source'] as GenericNode | undefined;
      if (source && typeof source['value'] === 'string') {
        imports.push(source['value']);
      }
    } else if (node.type === 'ExportNamedDeclaration') {
      const decl = node['declaration'] as GenericNode | undefined;
      const id = decl?.['id'] as GenericNode | undefined;
      if (id && typeof id['name'] === 'string') {
        exports.push(id['name']);
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      exports.push('default');
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'type') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && typeof (item as GenericNode).type === 'string') {
            visit(item as GenericNode);
          }
        }
      } else if (child && typeof child === 'object' && typeof (child as GenericNode).type === 'string') {
        visit(child as GenericNode);
      }
    }
  };

  visit(ast);
  return { astNodeCount, imports, exports, functionsCount };
}

function handleParseSnippet(msg: CodeAnalysisParseSnippetMessage): void {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let parsedAst: AcornNode | null = null;
  let sourceType: 'module' | 'script' | null = null;
  let parseError: string | null = null;

  for (const mode of ['module', 'script'] as const) {
    try {
      parsedAst = acornParse(msg.content || '', {
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

  if (!parsedAst) {
    const response: CodeAnalysisSnippetParsedMessage = {
      type: 'snippet-parsed',
      requestId: msg.requestId,
      filePath: msg.filePath,
      parsedSuccessfully: false,
      sourceType: null,
      astNodeCount: 0,
      imports: [],
      exports: [],
      functionsCount: 0,
      parseError,
      durationMs
    };
    workerScope.postMessage(response);
    return;
  }

  const stats = inspectAcornProgram(parsedAst as GenericNode);
  const response: CodeAnalysisSnippetParsedMessage = {
    type: 'snippet-parsed',
    requestId: msg.requestId,
    filePath: msg.filePath,
    parsedSuccessfully: true,
    sourceType,
    astNodeCount: stats.astNodeCount,
    imports: stats.imports,
    exports: stats.exports,
    functionsCount: stats.functionsCount,
    parseError: null,
    durationMs
  };
  workerScope.postMessage(response);
}

interface CodeAnalysisWorkerScopeLike {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<CodeAnalysisWorkerIncomingMessage>) => void,
  ) => void;
  postMessage: (message: CodeAnalysisWorkerOutgoingMessage) => void;
}

const workerScope = globalThis as unknown as CodeAnalysisWorkerScopeLike;

workerScope.addEventListener('message', ({ data }: MessageEvent<CodeAnalysisWorkerIncomingMessage>) => {
  if (!data || !data.requestId) {
    return;
  }

  if (data.type === 'cancel') {
    cancelledRequests.add(data.requestId);
    return;
  }

  if (data.type === 'parse-snippet') {
    handleParseSnippet(data);
    return;
  }

  if (data.type === 'analyze') {
    try {
      const result = analyzeSourceFilesWithAcorn(
        {
          requestId: data.requestId,
          repoName: data.repoName,
          files: data.files
        },
        (progress) => {
          if (cancelledRequests.has(data.requestId)) {
            return;
          }
          workerScope.postMessage(progress satisfies CodeAnalysisWorkerOutgoingMessage);
        },
        true
      );

      if (cancelledRequests.has(data.requestId)) {
        cancelledRequests.delete(data.requestId);
        return;
      }

      const completePayload: CodeAnalysisCompleteMessage = {
        type: 'complete',
        requestId: data.requestId,
        session: result.session,
        impact: result.impact,
        commits: result.commits,
        summary: result.summary
      };
      workerScope.postMessage(completePayload);
    } catch (err) {
      const errorPayload: CodeAnalysisErrorMessage = {
        type: 'error',
        requestId: data.requestId,
        message:
          err instanceof Error
            ? err.message
            : 'Unexpected Acorn CodeAnalysisWorker failure.'
      };
      workerScope.postMessage(errorPayload);
    }
  }
});
