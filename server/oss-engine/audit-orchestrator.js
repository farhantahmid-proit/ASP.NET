/**
 * Fresnel Zero-AI Audit Session Orchestrator & SSE Telemetry Emitter
 *
 * Replaces Gemini Managed Agent polling (`startCloudManagedAgentAudit`) with real,
 * deterministic execution of the open-source Node.js/TypeScript AST engine,
 * streaming live per-stage telemetry over Server-Sent Events (SSE) and status polling.
 */

import { ingestRepositoryFiles } from './repo-ingestion.js';
import { applyCommitChangesToFiles, runAllStaticAstRules, computeDeterministicScores } from './ast-rules.js';
import { runJscodeshiftCodemods } from './jscodeshift-codemods.js';
import { runLocalLinterPipeline } from './linter-pipeline.js';
import { correlateLhrWithWorkspace, detectChromiumAvailability } from './lighthouse-runner.js';

function emitSseEvent(session, eventName, payload) {
  if (!session.sseListeners || session.sseListeners.size === 0) return;
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of session.sseListeners) {
    try {
      res.write(data);
    } catch {
      session.sseListeners.delete(res);
    }
  }
}

function pushStep(session, step) {
  const nextStep = {
    index: session.steps.length,
    phase: step.phase || 'Static AST Engine',
    category: step.category || 'Engine',
    headline: step.headline,
    narrative: step.narrative,
    commitId: step.commitId || null,
    sha: step.sha || undefined,
    ruleId: step.ruleId || undefined
  };
  session.steps.push(nextStep);
  emitSseEvent(session, 'progress', {
    status: session.ossEngine?.completed ? 'completed' : 'in_progress',
    progressPercent: session.ossEngine?.progressPercent || 15,
    currentStep: nextStep,
    totalSteps: session.steps.length,
    commitsCount: session.commits.length
  });
}

/**
 * Executes Run 1: Zero-AI Deterministic Static AST Audit + jscodeshift Codemods + Local ESLint/Stylelint Pipeline
 */
export async function executeOssStaticAudit(session) {
  const startTime = Date.now();
  session.ossEngine = {
    engineType: 'oss-ast-v2',
    active: true,
    completed: false,
    progressPercent: 8,
    source: 'initializing',
    filesScanned: 0,
    liveLighthouseAvailable: detectChromiumAvailability().available,
    scanDurationMs: 0,
    jscodeshiftSummary: null,
    linterSummary: null
  };

  session.steps = [];
  session.commits = [];

  try {
    pushStep(session, {
      phase: 'Ingestion · Zero-AI OSS Engine',
      category: 'Ingestion',
      headline: `Clone ${session.repo.fullName} safely`,
      narrative: `Preparing sandboxed read-only workspace for ${session.repo.fullName} with git hooks disabled and zero code execution.`
    });

    const ingested = await ingestRepositoryFiles(session.repo, session.branch, (stageMsg) => {
      session.ossEngine.progressPercent = 18;
      pushStep(session, {
        phase: 'Indexing · fast-glob',
        category: 'Indexing',
        headline: 'Index HTML, TypeScript, JSX, and CSS/SCSS source files',
        narrative: stageMsg
      });
    });

    session.workspaceFiles = ingested.files;
    session.ossEngine.source = ingested.source;
    session.ossEngine.filesScanned = ingested.files.length;
    session.ossEngine.fallbackReason = ingested.fallbackReason || null;
    session.ossEngine.progressPercent = 28;

    pushStep(session, {
      phase: 'AST Parsing · parse5 · ts-morph · PostCSS · jscodeshift',
      category: 'AST Analysis',
      headline: `Parse ${ingested.files.length} source files into syntax trees`,
      narrative: `Indexed ${ingested.files.length} source file(s) from ${ingested.source === 'git-clone-live' ? 'shallow git clone' : 'isolated reference workspace'} and initialized HTML, TypeScript, PostCSS, jscodeshift, ESLint, and Stylelint pipelines.`
    });

    const workingFiles = ingested.files.map((f) => ({ ...f }));

    // Stage 1: Core Multi-Parser AST Rules (parse5, cheerio, ts-morph, PostCSS, Culori)
    const astCommits = runAllStaticAstRules(
      workingFiles,
      session.repo,
      session.categories,
      ({ index, total, category, label }) => {
        const pct = 30 + Math.round((index / Math.max(1, total)) * 32);
        session.ossEngine.progressPercent = Math.min(62, pct);
        if (index === 1 || index === Math.ceil(total / 2) || index === total) {
          pushStep(session, {
            phase: `Rule Evaluation (${index}/${total})`,
            category,
            headline: label,
            narrative: `Evaluating deterministic ${category} rules and synthesizing verified AST codemods.`
          });
        }
      }
    );
    for (const c of astCommits) {
      applyCommitChangesToFiles(workingFiles, c);
    }

    // Stage 2: jscodeshift Deterministic AST Codemods (DOM updates & a11y property injection)
    session.ossEngine.progressPercent = 68;
    const jscodeshiftResult = runJscodeshiftCodemods(
      workingFiles,
      session.repo,
      session.categories,
      ({ phase, category, headline }) => {
        pushStep(session, {
          phase,
          category,
          headline,
          narrative: 'Running format-preserving jscodeshift Recast AST transformations for automated DOM updates and accessibility property injection.'
        });
      }
    );
    session.ossEngine.jscodeshiftSummary = jscodeshiftResult.summary;
    for (const c of jscodeshiftResult.commits) {
      applyCommitChangesToFiles(workingFiles, c);
    }

    // Stage 3: Local Sandboxed ESLint & Stylelint Execution Pipeline
    session.ossEngine.progressPercent = 80;
    const linterResult = await runLocalLinterPipeline(
      workingFiles,
      session.repo,
      session.categories,
      ({ phase, category, headline }) => {
        pushStep(session, {
          phase,
          category,
          headline,
          narrative: 'Executing sandboxed local linter pipeline in-memory (repo config execution disabled) to auto-fix best-practice violations.'
        });
      }
    );
    session.ossEngine.linterSummary = linterResult.summary;

    const commits = [
      ...astCommits,
      ...jscodeshiftResult.commits,
      ...linterResult.commits
    ];

    session.commits = commits;
    session.deterministicMetrics = computeDeterministicScores(commits, null);
    session.ossEngine.progressPercent = 94;

    for (const c of commits.slice(0, 8)) {
      pushStep(session, {
        phase: `Patch Synthesized · ${c.analyzer}`,
        category: c.categoryLabel,
        headline: c.title,
        narrative: c.summary,
        commitId: c.id,
        sha: c.sha,
        ruleId: c.ruleId
      });
    }

    session.ossEngine.scanDurationMs = Date.now() - startTime;
    session.ossEngine.progressPercent = 100;
    session.ossEngine.active = false;
    session.ossEngine.completed = true;

    const eslintFixed = linterResult.summary?.eslint?.autoFixedCount || 0;
    const stylelintFixed = linterResult.summary?.stylelint?.autoFixedCount || 0;
    pushStep(session, {
      phase: 'Completed · Zero-AI Verified',
      category: 'Complete',
      headline: `Generate ${commits.length} verified atomic git patches`,
      narrative: `Completed deterministic AST, jscodeshift, ESLint (${eslintFixed} auto-fixed), and Stylelint (${stylelintFixed} auto-fixed) scans across ${ingested.files.length} file(s) in ${session.ossEngine.scanDurationMs}ms with zero AI calls.`
    });

    emitSseEvent(session, 'completed', {
      sessionId: session.id,
      totalCommits: commits.length,
      scanDurationMs: session.ossEngine.scanDurationMs
    });
  } catch (err) {
    session.ossEngine.active = false;
    session.ossEngine.completed = true;
    session.ossEngine.progressPercent = 100;
    session.ossEngine.error = err?.message || 'Static AST scan encountered an error.';
    pushStep(session, {
      phase: 'Completed with Notice',
      category: 'Engine',
      headline: 'Finalize deterministic code audit',
      narrative: `Finished static analysis with notice: ${session.ossEngine.error}`
    });
    emitSseEvent(session, 'completed', { sessionId: session.id, error: session.ossEngine.error });
  }
}

/**
 * Executes Run 2: Deterministic Lighthouse LHR JSON Correlation against Repository AST
 */
export async function executeOssLhrAudit(session, rawLhrInput, baseWorkspaceFiles = null) {
  const startTime = Date.now();
  session.ossEngine = {
    engineType: 'oss-lhr-correlator-v1',
    active: true,
    completed: false,
    progressPercent: 14,
    source: baseWorkspaceFiles ? 'cached-workspace' : 'initializing',
    filesScanned: baseWorkspaceFiles ? baseWorkspaceFiles.length : 0,
    liveLighthouseAvailable: detectChromiumAvailability().available,
    scanDurationMs: 0
  };

  session.steps = [];
  session.commits = [];

  try {
    pushStep(session, {
      phase: 'LHR Parsing · Run 2',
      category: 'Lighthouse LHR',
      headline: 'Parse Lighthouse Result JSON audits and DOM selectors',
      narrative: `Extracting failing audits, metricSavings, and node selectors from Lighthouse report for ${session.repo.fullName}.`
    });

    let workspaceFiles = baseWorkspaceFiles;
    if (!workspaceFiles || workspaceFiles.length === 0) {
      const ingested = await ingestRepositoryFiles(session.repo, session.branch);
      workspaceFiles = ingested.files;
      session.ossEngine.source = ingested.source;
      session.ossEngine.filesScanned = workspaceFiles.length;
    }
    session.workspaceFiles = workspaceFiles;
    session.ossEngine.progressPercent = 48;

    pushStep(session, {
      phase: 'Selector Correlation · cheerio + AST',
      category: 'Correlation',
      headline: `Match LHR selectors across ${workspaceFiles.length} repository files`,
      narrative: `Correlating Lighthouse failing audit targets against HTML templates, TypeScript routes, and PostCSS stylesheets.`
    });

    const result = correlateLhrWithWorkspace(session.repo, rawLhrInput, workspaceFiles);
    session.lhrMeta = {
      lighthouseVersion: result.lhrVersion,
      requestedUrl: result.requestedUrl,
      fetchTime: result.fetchTime
    };
    session.commits = result.commits;
    session.deterministicMetrics = result.deterministicMetrics;
    session.ossEngine.progressPercent = 92;

    for (const c of result.commits.slice(0, 5)) {
      pushStep(session, {
        phase: `LHR Targeted Patch · ${c.analyzer}`,
        category: c.categoryLabel,
        headline: c.title,
        narrative: c.summary,
        commitId: c.id,
        sha: c.sha,
        ruleId: c.ruleId
      });
    }

    session.ossEngine.scanDurationMs = Date.now() - startTime;
    session.ossEngine.progressPercent = 100;
    session.ossEngine.active = false;
    session.ossEngine.completed = true;

    pushStep(session, {
      phase: 'Completed · LHR Verified',
      category: 'Complete',
      headline: `Correlate ${result.commits.length} LHR-targeted code fixes`,
      narrative: `Mapped ${result.failingAuditsCount} failing Lighthouse audit(s) and synthesized ${result.commits.length} verified unified git patch(es) in ${session.ossEngine.scanDurationMs}ms.`
    });

    emitSseEvent(session, 'completed', {
      sessionId: session.id,
      totalCommits: result.commits.length,
      scanDurationMs: session.ossEngine.scanDurationMs
    });
  } catch (err) {
    session.ossEngine.active = false;
    session.ossEngine.completed = true;
    session.ossEngine.progressPercent = 100;
    session.ossEngine.error = err?.message || 'LHR correlation encountered an error.';
    pushStep(session, {
      phase: 'Completed with Notice',
      category: 'Lighthouse LHR',
      headline: 'Finalize Lighthouse LHR correlation',
      narrative: `Completed LHR processing with notice: ${session.ossEngine.error}`
    });
    emitSseEvent(session, 'completed', { sessionId: session.id, error: session.ossEngine.error });
  }
}
