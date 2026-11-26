import {
  AstWorkerRequestPayload,
  AstWorkerResponsePayload,
  analyzeSourceFilesWithAcorn
} from './ast-analyzer.engine';

interface AstWorkerScopeLike {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<AstWorkerRequestPayload>) => void,
  ) => void;
  postMessage: (message: AstWorkerResponsePayload) => void;
}

const workerScope = globalThis as unknown as AstWorkerScopeLike;

workerScope.addEventListener('message', ({ data }: MessageEvent<AstWorkerRequestPayload>) => {
  if (!data || !data.requestId) {
    return;
  }

  try {
    const result = analyzeSourceFilesWithAcorn(
      data,
      (progress) => {
        workerScope.postMessage(progress satisfies AstWorkerResponsePayload);
      },
      true
    );

    const completePayload: AstWorkerResponsePayload = {
      type: 'complete',
      requestId: data.requestId,
      session: result.session,
      impact: result.impact,
      commits: result.commits,
      summary: result.summary
    };

    workerScope.postMessage(completePayload);
  } catch (err) {
    const errorPayload: AstWorkerResponsePayload = {
      type: 'error',
      requestId: data.requestId,
      message:
        err instanceof Error
          ? err.message
          : 'Unexpected Web Worker AST analysis failure.'
    };
    workerScope.postMessage(errorPayload);
  }
});
