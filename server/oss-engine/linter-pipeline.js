/**
 * Fresnel Local ESLint & Stylelint Execution Pipeline (Zero-AI)
 *
 * Programmatically executes ESLint (Flat Config + @typescript-eslint/parser) and
 * Stylelint (with postcss-scss) strictly in-memory using curated inline configs
 * so untrusted repository config files (.eslintrc.js / stylelint.config.js) are
 * NEVER loaded or executed. Generates real, verified atomic git patches for
 * auto-fixable best-practice violations.
 */

import { ESLint } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import stylelint from 'stylelint';
import postcssScss from 'postcss-scss';
import { applyCommitChangesToFiles, buildCommitRecord } from './ast-rules.js';

const MAX_ESLINT_FILES = 40;
const MAX_STYLELINT_FILES = 30;

const SHARED_ESLINT_BEST_PRACTICE_RULES = {
  // Auto-fixable modern JS/TS best practices
  'no-var': 'error',
  'prefer-const': 'error',
  'object-shorthand': ['error', 'always'],
  'prefer-template': 'error',
  curly: ['error', 'all'],
  'no-extra-boolean-cast': 'error',
  'no-unneeded-ternary': 'error',
  'no-useless-return': 'error',
  yoda: ['error', 'never'],
  'no-useless-computed-key': 'error',
  // High-signal diagnostic best practices (reported in audit telemetry)
  eqeqeq: ['warn', 'smart'],
  'no-debugger': 'warn',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-script-url': 'error'
};

function createSandboxedEslint(fix = false) {
  return new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true, // CRITICAL: never read untrusted repo eslint configs
    fix,
    overrideConfig: [
      {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'],
        languageOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          parserOptions: {
            ecmaFeatures: { jsx: true }
          }
        },
        rules: SHARED_ESLINT_BEST_PRACTICE_RULES
      },
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
          parser: tsParser,
          ecmaVersion: 'latest',
          sourceType: 'module',
          parserOptions: {
            ecmaFeatures: { jsx: true }
          }
        },
        rules: SHARED_ESLINT_BEST_PRACTICE_RULES
      }
    ]
  });
}

const SANDBOXED_STYLELINT_CONFIG = {
  rules: {
    // Auto-fixable CSS/SCSS best practices (Stylelint core rules, zero external plugins)
    'color-hex-length': 'short',
    'length-zero-no-unit': true,
    'shorthand-property-no-redundant-values': true,
    'color-function-notation': 'modern',
    'alpha-value-notation': 'percentage',
    'selector-pseudo-element-colon-notation': 'double',
    'font-weight-notation': 'numeric',
    // Semantic CSS quality diagnostics
    'declaration-block-no-duplicate-properties': true,
    'block-no-empty': true,
    'no-duplicate-selectors': true
  }
};

/**
 * Runs ESLint locally in-memory over JS/JSX/TS/TSX files and synthesizes an atomic git patch.
 */
export async function runLocalEslintPipeline(files, repoMeta) {
  const targetFiles = files
    .filter((f) => /\.(js|jsx|mjs|cjs|ts|tsx)$/i.test(f.relPath))
    .slice(0, MAX_ESLINT_FILES);

  const diagnostics = {
    filesScanned: 0,
    filesModified: 0,
    violationsFound: 0,
    autoFixedCount: 0,
    remainingWarnings: 0,
    rulesTriggered: []
  };

  if (targetFiles.length === 0) {
    return { commit: null, diagnostics };
  }

  const scanEngine = createSandboxedEslint(false);
  const fixEngine = createSandboxedEslint(true);
  const ruleCounts = new Map();
  const changes = [];

  for (const file of targetFiles) {
    diagnostics.filesScanned++;
    const virtualPath = file.relPath.replace(/^\/+/, '');
    try {
      const scanResults = await scanEngine.lintText(file.content, { filePath: virtualPath });
      const scanResult = scanResults?.[0];
      if (!scanResult) continue;

      const preMessages = (scanResult.messages || []).filter((m) => m.ruleId);
      if (preMessages.length === 0) continue;

      diagnostics.violationsFound += preMessages.length;
      for (const msg of preMessages) {
        ruleCounts.set(msg.ruleId, (ruleCounts.get(msg.ruleId) || 0) + 1);
      }

      const fixResults = await fixEngine.lintText(file.content, { filePath: virtualPath });
      const fixResult = fixResults?.[0];
      if (!fixResult) continue;

      const postMessages = (fixResult.messages || []).filter((m) => m.ruleId);
      const fixedInFile = Math.max(0, preMessages.length - postMessages.length);
      diagnostics.autoFixedCount += fixedInFile;
      diagnostics.remainingWarnings += postMessages.length;

      if (typeof fixResult.output === 'string' && fixResult.output !== file.content) {
        changes.push({
          relPath: file.relPath,
          before: file.content,
          after: fixResult.output
        });
      }
    } catch {
      // Never abort audit if a single file uses unsupported experimental syntax
    }
  }

  diagnostics.filesModified = changes.length;
  diagnostics.rulesTriggered = Array.from(ruleCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([ruleId, count]) => ({ ruleId, count }));

  if (changes.length === 0) {
    return { commit: null, diagnostics };
  }

  const topRulesSummary = diagnostics.rulesTriggered
    .slice(0, 6)
    .map((r) => `${r.ruleId} (${r.count})`)
    .join(', ');

  const commit = buildCommitRecord({
    repoMeta,
    category: 'best-practices',
    ruleId: 'eslint-best-practices',
    ruleTitle: 'Auto-fix JavaScript & TypeScript best-practice violations via local ESLint pipeline',
    impact: 'Medium · Code Maintainability & Safety',
    analyzer: 'eslint + @typescript-eslint/parser',
    fixConfidence: 'auto-verified',
    title: 'Auto-fix ESLint best-practice violations across JS/TS source files',
    commitMessage: 'refactor(eslint): auto-fix local ESLint best-practice violations across repository',
    summary: `Scanned ${diagnostics.filesScanned} JS/TS file(s) with sandboxed ESLint flat-config pipeline: detected ${diagnostics.violationsFound} violation(s), auto-fixed ${diagnostics.autoFixedCount} issue(s) across ${changes.length} file(s) (${topRulesSummary}).`,
    fileChanges: changes.slice(0, 6)
  });

  return { commit, diagnostics };
}

/**
 * Runs Stylelint locally in-memory over CSS/SCSS files and synthesizes an atomic git patch.
 */
export async function runLocalStylelintPipeline(files, repoMeta) {
  const targetFiles = files
    .filter((f) => /\.(css|scss)$/i.test(f.relPath))
    .slice(0, MAX_STYLELINT_FILES);

  const diagnostics = {
    filesScanned: 0,
    filesModified: 0,
    violationsFound: 0,
    autoFixedCount: 0,
    remainingWarnings: 0,
    rulesTriggered: []
  };

  if (targetFiles.length === 0) {
    return { commit: null, diagnostics };
  }

  const ruleCounts = new Map();
  const changes = [];

  for (const file of targetFiles) {
    diagnostics.filesScanned++;
    const isScss = /\.scss$/i.test(file.relPath);
    const baseOpts = {
      code: file.content,
      codeFilename: file.relPath,
      config: SANDBOXED_STYLELINT_CONFIG,
      ...(isScss ? { customSyntax: postcssScss } : {})
    };

    try {
      const scanRes = await stylelint.lint({ ...baseOpts, fix: false });
      const scanWarnings = scanRes?.results?.[0]?.warnings || [];
      if (scanWarnings.length === 0) continue;

      diagnostics.violationsFound += scanWarnings.length;
      for (const w of scanWarnings) {
        if (w.rule) {
          ruleCounts.set(w.rule, (ruleCounts.get(w.rule) || 0) + 1);
        }
      }

      const fixRes = await stylelint.lint({ ...baseOpts, fix: true });
      const fixedCode = typeof fixRes?.code === 'string' ? fixRes.code : file.content;
      const postWarnings = fixRes?.results?.[0]?.warnings || [];
      const fixedInFile = Math.max(0, scanWarnings.length - postWarnings.length);

      diagnostics.autoFixedCount += fixedInFile;
      diagnostics.remainingWarnings += postWarnings.length;

      if (fixedCode && fixedCode !== file.content) {
        changes.push({
          relPath: file.relPath,
          before: file.content,
          after: fixedCode
        });
      }
    } catch {
      // Skip malformed/unsupported stylesheet syntax gracefully
    }
  }

  diagnostics.filesModified = changes.length;
  diagnostics.rulesTriggered = Array.from(ruleCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([ruleId, count]) => ({ ruleId, count }));

  if (changes.length === 0) {
    return { commit: null, diagnostics };
  }

  const topRulesSummary = diagnostics.rulesTriggered
    .slice(0, 6)
    .map((r) => `${r.ruleId} (${r.count})`)
    .join(', ');

  const commit = buildCommitRecord({
    repoMeta,
    category: 'best-practices',
    ruleId: 'stylelint-best-practices',
    ruleTitle: 'Auto-fix CSS & SCSS stylesheet best-practice violations via local Stylelint pipeline',
    impact: 'Medium · CSS Consistency & Modern Syntax',
    analyzer: 'stylelint + postcss-scss',
    fixConfidence: 'auto-verified',
    title: 'Auto-fix Stylelint CSS/SCSS best-practice violations across stylesheets',
    commitMessage: 'style(stylelint): auto-fix local Stylelint best-practice violations in stylesheets',
    summary: `Scanned ${diagnostics.filesScanned} CSS/SCSS stylesheet(s) with sandboxed Stylelint pipeline: detected ${diagnostics.violationsFound} violation(s), auto-fixed ${diagnostics.autoFixedCount} issue(s) across ${changes.length} file(s) (${topRulesSummary}).`,
    fileChanges: changes.slice(0, 6)
  });

  return { commit, diagnostics };
}

/**
 * Executes both local ESLint and Stylelint pipelines and returns `{ commits, summary }`.
 */
export async function runLocalLinterPipeline(
  files,
  repoMeta,
  selectedCategories = ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
  onProgress = () => {}
) {
  const enabled = new Set(selectedCategories);
  const workingFiles = files.map((f) => ({ ...f }));
  const commits = [];
  const summary = {
    eslint: {
      filesScanned: 0,
      filesModified: 0,
      violationsFound: 0,
      autoFixedCount: 0,
      remainingWarnings: 0,
      rulesTriggered: []
    },
    stylelint: {
      filesScanned: 0,
      filesModified: 0,
      violationsFound: 0,
      autoFixedCount: 0,
      remainingWarnings: 0,
      rulesTriggered: []
    }
  };

  if (!enabled.has('best-practices')) {
    return { commits, summary };
  }

  onProgress({
    phase: 'Local Linter Pipeline · ESLint',
    category: 'Best practices',
    headline: 'Scan JS/TS repositories with sandboxed ESLint flat-config pipeline'
  });
  const eslintRes = await runLocalEslintPipeline(workingFiles, repoMeta);
  summary.eslint = eslintRes.diagnostics;
  if (eslintRes.commit) {
    commits.push(eslintRes.commit);
    applyCommitChangesToFiles(workingFiles, eslintRes.commit);
  }

  onProgress({
    phase: 'Local Linter Pipeline · Stylelint',
    category: 'Best practices',
    headline: 'Scan CSS/SCSS stylesheets with sandboxed Stylelint pipeline'
  });
  const stylelintRes = await runLocalStylelintPipeline(workingFiles, repoMeta);
  summary.stylelint = stylelintRes.diagnostics;
  if (stylelintRes.commit) {
    commits.push(stylelintRes.commit);
    applyCommitChangesToFiles(workingFiles, stylelintRes.commit);
  }

  return { commits, summary };
}
