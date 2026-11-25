/// <reference lib="webworker" />

import {
  AstWorkerRequestPayload,
  AstWorkerResponsePayload,
  analyzeSourceFilesWithAcorn
} from './ast-analyzer.engine';

addEventListener('message', ({ data }: MessageEvent<AstWorkerRequestPayload>) => {
  if (!data || !data.requestId) {
    return;
  }

  try {
    const result = analyzeSourceFilesWithAcorn(
      data,
      (progress) => {
        postMessage(progress satisfies AstWorkerResponsePayload);
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

    postMessage(completePayload);
  } catch (err) {
    const errorPayload: AstWorkerResponsePayload = {
      type: 'error',
      requestId: data.requestId,
      message:
        err instanceof Error
          ? err.message
          : 'Unexpected Web Worker AST analysis failure.'
    };
    postMessage(errorPayload);
  }
});
