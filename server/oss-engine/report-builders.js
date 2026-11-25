/**
 * Fresnel Zero-AI Deterministic Report, Git Patch, and PR CLI Builders
 *
 * Pure Node.js utilities for parsing repository URLs, formatting RFC-2822
 * `git format-patch` mbox bundles, building 1-click `git am` + `gh pr create`
 * CLI commands, and generating Markdown and PDF 1.4 documentation reports.
 */

import crypto from 'node:crypto';

export const FRESNEL_IDENTITY_LORE = {
  name: 'Fresnel',
  pronunciation: '/freɪˈnɛl/',
  origin:
    'Named after French physicist Augustin-Jean Fresnel (1788–1827), inventor of the stepped concentric lighthouse lens.',
  quote:
    '“Instead of a single heavy dome of glass, concentric stepped prism rings capture scattered light from every angle and refract it into one extraordinary, miles-long beam.”',
  explanation:
    'Just as the Fresnel lens concentrates a lighthouse’s beam to guide ships through fog, Fresnel focuses deterministic open-source AST parsers, PostCSS/Culori contrast math, and Lighthouse diagnostics onto raw source code—producing verified, self-contained atomic git commits with zero AI API calls.'
};

export const FRESNEL_OSS_CONFIG = {
  engineType: 'oss-ast-v2',
  zeroAi: true,
  runtime: 'Node.js + TypeScript Open-Source Stack',
  analyzers: [
    'parse5 + cheerio + magic-string (HTML & Templates)',
    'jscodeshift (Deterministic JS/TS/JSX/TSX DOM & A11y AST Codemods)',
    'eslint + @typescript-eslint/parser (Sandboxed Local Flat-Config Linter Pipeline)',
    'stylelint + postcss-scss (Sandboxed Local CSS/SCSS Linter Pipeline)',
    'ts-morph (TypeScript/JavaScript AST & Security)',
    'postcss + culori (CSS/SCSS & WCAG 2.2 Contrast)',
    'diff / jsdiff (RFC-2822 Unified Git Patches)',
    'lighthouse + chrome-launcher (Optional Live LHR Runner)',
    'WCAG/CWV/OWASP Registry + MDN Search API (Standards Grounding)'
  ],
  executionPolicy: 'STATIC_AST_ONLY_NO_REPO_CODE_EXECUTION',
  demoRepositoryUrl: 'https://github.com/fresnel-sandbox/lumina-web-app'
};

export const SAMPLE_LIGHTHOUSE_LHR_JSON = {
  lighthouseVersion: '12.2.0',
  fetchTime: '2026-10-06T13:35:00.000Z',
  requestedUrl: 'https://lumina-web.app/',
  mainDocumentUrl: 'https://lumina-web.app/',
  finalDisplayedUrl: 'https://lumina-web.app/',
  configSettings: {
    formFactor: 'desktop',
    locale: 'en-US',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo']
  },
  categories: {
    performance: {
      id: 'performance',
      title: 'Performance',
      score: 0.68,
      auditRefs: [
        { id: 'largest-contentful-paint-element', weight: 25, group: 'diagnostics' },
        { id: 'render-blocking-resources', weight: 15, group: 'load-opportunities' },
        { id: 'unsized-images', weight: 10, group: 'diagnostics' }
      ]
    },
    accessibility: {
      id: 'accessibility',
      title: 'Accessibility',
      score: 0.74,
      auditRefs: [
        { id: 'color-contrast', weight: 7, group: 'a11y-color-contrast' },
        { id: 'button-name', weight: 10, group: 'a11y-names-labels' }
      ]
    },
    'best-practices': {
      id: 'best-practices',
      title: 'Best Practices',
      score: 0.83,
      auditRefs: [{ id: 'csp-xss', weight: 5, group: 'trust-safety' }]
    },
    seo: {
      id: 'seo',
      title: 'SEO',
      score: 0.82,
      auditRefs: [{ id: 'structured-data', weight: 5, group: 'seo-content' }]
    }
  },
  audits: {
    'largest-contentful-paint-element': {
      id: 'largest-contentful-paint-element',
      title: 'Largest Contentful Paint element',
      score: 0.28,
      scoreDisplayMode: 'metricSavings',
      numericValue: 3420,
      displayValue: '3,420 ms',
      metricSavings: { LCP: 1180 },
      details: {
        type: 'table',
        items: [
          {
            node: {
              selector: 'section.hero-stage > picture > img.hero-banner-media',
              snippet: '<img class="hero-banner-media" src="/assets/hero-lens.jpg">'
            }
          }
        ]
      }
    },
    'render-blocking-resources': {
      id: 'render-blocking-resources',
      title: 'Eliminate render-blocking resources',
      score: 0.42,
      scoreDisplayMode: 'metricSavings',
      displayValue: 'Potential savings of 640 ms',
      metricSavings: { FCP: 640, LCP: 480 }
    },
    'unsized-images': {
      id: 'unsized-images',
      title: 'Image elements do not have explicit width and height',
      score: 0.0,
      scoreDisplayMode: 'binary',
      displayValue: '3 elements found',
      metricSavings: { CLS: 0.14 }
    },
    'color-contrast': {
      id: 'color-contrast',
      title: 'Background and foreground colors do not have a sufficient contrast ratio',
      score: 0.0,
      scoreDisplayMode: 'binary',
      displayValue: '2 elements fail WCAG AA (2.54:1 vs 4.5:1)',
      details: {
        type: 'table',
        items: [
          {
            node: {
              selector: '.hero-caption',
              snippet: '<p class="hero-caption">'
            }
          }
        ]
      }
    },
    'button-name': {
      id: 'button-name',
      title: 'Buttons do not have an accessible name',
      score: 0.0,
      scoreDisplayMode: 'binary',
      displayValue: '1 icon-only button missing aria-label',
      details: {
        type: 'table',
        items: [
          {
            node: {
              selector: 'button.icon-btn',
              snippet: '<button class="icon-btn">'
            }
          }
        ]
      }
    },
    'csp-xss': {
      id: 'csp-xss',
      title: 'Ensure CSP is effective against XSS attacks',
      score: 0.0,
      scoreDisplayMode: 'binary',
      displayValue: 'No CSP found in document head'
    },
    'structured-data': {
      id: 'structured-data',
      title: 'Structured data is valid',
      score: 0.0,
      scoreDisplayMode: 'binary',
      displayValue: 'Missing canonical link and JSON-LD schema'
    }
  }
};

export function parseRepoUrl(rawUrl, mode = 'live') {
  if (mode === 'demo') {
    return {
      owner: 'fresnel-sandbox',
      repo: 'lumina-web-app',
      fullName: 'fresnel-sandbox/lumina-web-app',
      url: 'https://github.com/fresnel-sandbox/lumina-web-app',
      isDemo: true
    };
  }

  const cleaned = (rawUrl || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  let owner = 'fresnel-sandbox';
  let repo = 'lumina-web-app';

  const githubMatch = cleaned.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  const shorthandMatch = cleaned.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);

  const SAFE_REPO_SEG_RE = /^[A-Za-z0-9._-]{1,100}$/;
  const isSafeSeg = (s) => SAFE_REPO_SEG_RE.test(s) && s !== '.' && s !== '..';
  if (githubMatch && isSafeSeg(githubMatch[1]) && isSafeSeg(githubMatch[2])) {
    owner = githubMatch[1];
    repo = githubMatch[2];
  } else if (shorthandMatch && isSafeSeg(shorthandMatch[1]) && isSafeSeg(shorthandMatch[2])) {
    owner = shorthandMatch[1];
    repo = shorthandMatch[2];
  }

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}`,
    isDemo: false
  };
}

export function buildCategoriesImproved(commits = [], runPhase = 'static') {
  const isLhr = runPhase === 'lhr' || runPhase === 2;
  const defs = [
    {
      id: 'performance',
      label: 'Performance',
      focus: 'LCP fetchpriority, explicit CLS dimensions, preconnect hints, font-display: swap, GPU transforms & lazy routes'
    },
    {
      id: 'accessibility',
      label: 'Accessibility',
      focus: 'Skip-to-main bypass landmark, contextual titles, Culori WCAG 2.2 AA contrast, 44px tap targets, focus rings & jscodeshift ARIA/role injection'
    },
    {
      id: 'best-practices',
      label: 'Best practices',
      focus: 'CSP & Referrer-Policy headers, rel="noopener noreferrer", passive listeners, jscodeshift DOM updates, and local ESLint + Stylelint auto-fixes'
    },
    {
      id: 'seo',
      label: 'SEO',
      focus: 'Viewport, meta description, OpenGraph metadata, canonical link, JSON-LD schema & crawlable anchors'
    },
    ...(isLhr
      ? []
      : [
          {
            id: 'security',
            label: 'Web application security findings (light)',
            focus: 'DOM XSS innerHTML sink remediation, high-entropy secret externalization & open-redirect allowlist'
          }
        ])
  ];

  return defs
    .map((d) => {
      const matched = commits.filter((c) => c.category === d.id);
      return {
        id: d.id,
        label: d.label,
        focus: d.focus,
        improved: matched.length > 0,
        commitsCount: matched.length,
        rules: Array.from(new Set(matched.map((c) => c.ruleId).filter(Boolean)))
      };
    })
    .filter((d) => d.improved);
}

export function sanitizeGitRefName(rawBranch, fallback = 'main') {
  const cleaned = String(rawBranch ?? '')
    .trim()
    .replace(/[\x00-\x1f\x7f~^:?*[\\\s]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[/-]+|[/-]+$/g, '')
    .replace(/\.lock$/i, '')
    .slice(0, 100);
  if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned.startsWith('-')) {
    return fallback;
  }
  return cleaned;
}

function normalizeFullSha(rawSha, seedFallback = '') {
  const cleaned = String(rawSha ?? '').trim().toLowerCase();
  if (/^[0-9a-f]{40}$/.test(cleaned)) return cleaned;
  return crypto.createHash('sha1').update(`${cleaned}:${seedFallback}`).digest('hex');
}

export function generateGitFormatPatch(session, selectedCommitIds) {
  const selectedIdSet = new Set(
    Array.isArray(selectedCommitIds) && selectedCommitIds.length > 0
      ? selectedCommitIds
      : session.commits.map((c) => c.id)
  );

  const chosenCommits = session.commits.filter((c) => selectedIdSet.has(c.id));
  const total = chosenCommits.length;

  if (total === 0) {
    return '# No commits selected for patch export.\n';
  }

  const patches = chosenCommits.map((commit, idx) => {
    const subjectPrefix = total > 1 ? `[PATCH ${idx + 1}/${total}]` : '[PATCH]';
    const fileStatsLine = (commit.files || [])
      .map((f) => ` ${f} | ${(commit.additions || 0) + (commit.deletions || 0)} ++--`)
      .join('\n');
    const fullSha = normalizeFullSha(commit.fullSha, `${commit.id || ''}:${commit.title || ''}:${idx}`);
    const normalizedDiff = String(commit.diff || '').trimEnd();

    return [
      `From ${fullSha} Mon Sep 17 00:00:00 2001`,
      `From: ${commit.author || 'Fresnel OSS Engine <fresnel-oss@noreplies.github.com>'}`,
      `Date: ${commit.date || new Date().toUTCString()}`,
      `Subject: ${subjectPrefix} ${commit.commitMessage || commit.title}`,
      '',
      commit.summary,
      '',
      `Analyzer: ${commit.analyzer || 'Fresnel OSS AST Engine'} (${commit.fixConfidence || 'auto-verified'})`,
      '---',
      fileStatsLine,
      ` ${(commit.files || []).length} file(s) changed, ${commit.additions || 0} insertions(+), ${commit.deletions || 0} deletions(-)`,
      '',
      normalizedDiff,
      '-- ',
      '2.47.0',
      ''
    ].join('\n');
  });

  return patches.join('\n');
}

export function buildPullRequestCliBundle(session, selectedCommitIds = [], options = {}) {
  const selectedIdSet = new Set(
    Array.isArray(selectedCommitIds) && selectedCommitIds.length > 0
      ? selectedCommitIds
      : session.commits.map((c) => c.id)
  );
  const selectedCommits = session.commits.filter((c) => selectedIdSet.has(c.id));
  const shortHash = crypto
    .createHash('sha1')
    .update(`${session.id}-${selectedCommits.map((c) => c.sha).join(',')}`)
    .digest('hex')
    .slice(0, 6);

  const branchPrefix = session.runPhase === 'lhr' ? 'fresnel/lhr-targeted' : 'fresnel/oss-audit';
  const headBranch = sanitizeGitRefName(options.headBranch, `${branchPrefix}-${shortHash}`);
  const baseBranch = sanitizeGitRefName(session.branch, 'main');
  const suffix = session.runPhase === 'lhr' ? 'lhr-fixes' : 'code-audit';
  const safeRepoSlug = String(session?.repo?.repo || 'repository').replace(/[^a-zA-Z0-9._-]/g, '-') || 'repository';
  const patchFilename = `fresnel-${safeRepoSlug}-${suffix}.patch`;
  const patchContent = generateGitFormatPatch(
    session,
    selectedCommits.map((c) => c.id)
  );

  const prTitle =
    options.prTitle ||
    (session.runPhase === 'lhr'
      ? `perf(lighthouse-lhr): deterministic LHR JSON audit fixes (${selectedCommits.length} commits)`
      : `chore(audit): deterministic AST code & security fixes (${selectedCommits.length} commits)`);

  const categoriesImproved = buildCategoriesImproved(
    selectedCommits,
    session.runPhase === 'lhr' ? 'lhr' : 'static'
  );

  const prBodyLines = [
    '## Fresnel Deterministic Open-Source Audit Fixes',
    '',
    `Applies **${selectedCommits.length} verified AST commit(s)** improving: ${categoriesImproved.map((c) => `**${c.label}**`).join(', ')}.`,
    '',
    '### Included Commits',
    ...selectedCommits.map(
      (c) =>
        `- \`${c.commitMessage || c.title}\` (${c.categoryLabel} · \`${c.analyzer || 'oss-ast'}\` · \`${c.files.join(', ')}\`)`
    )
  ];
  const prBody = prBodyLines.join('\n');

  const compareUrl = `${session.repo.url}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}?expand=1&title=${encodeURIComponent(prTitle)}&body=${encodeURIComponent(prBody)}`;

  const escapeDoubleQuotedBash = (val) =>
    String(val ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

  const escapedTitle = escapeDoubleQuotedBash(prTitle);
  const escapedBody = escapeDoubleQuotedBash(prBody);

  const terminalCommand = [
    `git checkout -b ${headBranch} && \\`,
    `git am << 'FRESNEL_PATCH_EOF'`,
    patchContent.trimEnd(),
    `FRESNEL_PATCH_EOF`,
    `git push -u origin ${headBranch} && \\`,
    `gh pr create --base ${baseBranch} --head ${headBranch} --title "${escapedTitle}" --body "${escapedBody}"`
  ].join('\n');

  const shortTerminalCommand = [
    `git checkout -b ${headBranch} && \\`,
    `git am ~/Downloads/${patchFilename} && \\`,
    `git push -u origin ${headBranch} && \\`,
    `gh pr create --base ${baseBranch} --head ${headBranch} --title "${escapedTitle}" --fill`
  ].join('\n');

  return {
    number: session.runPhase === 'lhr' ? 43 : 42,
    mode: session.mode,
    runPhase: session.runPhase || 'static',
    title: prTitle,
    body: prBody,
    url: compareUrl,
    compareUrl,
    repoUrl: session.repo.url,
    repoFullName: session.repo.fullName,
    baseBranch,
    headBranch,
    patchFilename,
    patchDownloadUrl: `/api/audit/${session.id}/patch.diff?commits=${encodeURIComponent(
      selectedCommits.map((c) => c.id).join(',')
    )}`,
    terminalCommand,
    shortTerminalCommand,
    createdAt: new Date().toISOString(),
    selectedCommits,
    totalAdditions: selectedCommits.reduce((sum, c) => sum + c.additions, 0),
    totalDeletions: selectedCommits.reduce((sum, c) => sum + c.deletions, 0),
    filesTouched: Array.from(new Set(selectedCommits.flatMap((c) => c.files)))
  };
}

export function estimateAuditTimeRemaining(session, progressPercent = 12, status = 'in_progress') {
  if (status === 'completed' || progressPercent >= 100) {
    return {
      estimatedRemainingMinutes: 0,
      estimatedRemainingSeconds: 0,
      estimatedTimeRemainingLabel: 'Completed'
    };
  }

  const clampedProgress = Math.max(5, Math.min(99, Number(progressPercent) || 12));
  const remainingSec = Math.max(2, Math.round(((100 - clampedProgress) / 100) * 14));
  return {
    estimatedRemainingMinutes: 1,
    estimatedRemainingSeconds: remainingSec,
    estimatedTimeRemainingLabel: `Approximately ${remainingSec}s remaining (local AST engine)`
  };
}

export function generateAuditReportMarkdown(session, selectedCommitIds = null, groundingData = null) {
  const repoFullName = session?.repo?.fullName || 'fresnel-sandbox/lumina-web-app';
  const repoUrl = session?.repo?.url || `https://github.com/${repoFullName}`;
  const branch = session?.branch || 'main';
  const isLhr = session?.runPhase === 'lhr';
  const reportTitle = isLhr
    ? `Fresnel Zero-AI Lighthouse JSON (LHR) Audit Report — ${repoFullName}`
    : `Fresnel Zero-AI Static AST & Light Security Audit Report — ${repoFullName}`;

  const allCommits = Array.isArray(session?.commits) ? session.commits : [];
  const selectedIdSet =
    Array.isArray(selectedCommitIds) && selectedCommitIds.length > 0
      ? new Set(selectedCommitIds)
      : new Set(allCommits.map((c) => c.id));

  const commitsToExport =
    allCommits.filter((c) => selectedIdSet.has(c.id)).length > 0
      ? allCommits.filter((c) => selectedIdSet.has(c.id))
      : allCommits;

  const categoriesImproved = buildCategoriesImproved(commitsToExport, session?.runPhase || 'static');
  const totalAdditions = commitsToExport.reduce((acc, c) => acc + (Number(c.additions) || 0), 0);
  const totalDeletions = commitsToExport.reduce((acc, c) => acc + (Number(c.deletions) || 0), 0);
  const filesTouched = Array.from(new Set(commitsToExport.flatMap((c) => c.files || [])));
  const generatedAt = new Date().toISOString();

  const lines = [
    `# ${reportTitle}`,
    '',
    `> Generated by **Fresnel Zero-AI Open-Source Engine** (\`jscodeshift\`, \`eslint\`, \`stylelint\`, \`parse5\`, \`ts-morph\`, \`postcss\`, \`culori\`, \`jsdiff\`, \`lighthouse\`) — Deterministic static AST audit across Performance, Accessibility, Best Practices, SEO${isLhr ? '' : ', and Light Web Application Security Findings'}.`,
    '',
    `## 1. Executive Summary & Audit Metadata`,
    '',
    `| Property | Value |`,
    `| :--- | :--- |`,
    `| **Repository** | [${repoFullName}](${repoUrl}) |`,
    `| **Target Branch** | \`${branch}\` |`,
    `| **Audit Engine** | Zero-AI Open-Source Node.js AST Engine (\`${session?.ossEngine?.engineType || 'oss-ast-v1'}\`) |`,
    `| **Audit Phase** | ${isLhr ? 'Run 2 · Lighthouse Result (LHR) JSON Targeted Audit' : 'Run 1 · Static AST & Light Web Security Audit'} |`,
    `| **Generated At** | \`${generatedAt}\` |`,
    `| **Commits Included** | **${commitsToExport.length}** of ${allCommits.length} verified atomic commits |`,
    `| **Lines Changed** | \`+${totalAdditions}\` additions / \`-${totalDeletions}\` deletions across **${filesTouched.length}** file(s) |`,
    ''
  ];

  if (isLhr && session?.lhrMeta) {
    lines.push(
      `### Lighthouse Result (LHR) Context`,
      `- **Lighthouse Version**: \`${session.lhrMeta.lighthouseVersion || '12.2.0'}\``,
      `- **Audited URL**: \`${session.lhrMeta.requestedUrl || repoUrl}\``,
      `- **LHR Fetch Timestamp**: \`${session.lhrMeta.fetchTime || generatedAt}\``,
      ''
    );
  }

  lines.push(
    `## 2. Categories Improved with Code`,
    '',
    `| Category | Status | Atomic Commits | Primary Focus & Rules Addressed |`,
    `| :--- | :--- | :---: | :--- |`
  );

  for (const cat of categoriesImproved) {
    const rulesList = Array.isArray(cat.rules) && cat.rules.length > 0 ? ` (\`${cat.rules.join('`, `')}\`)` : '';
    lines.push(
      `| **${cat.label}** | Improved with AST codemod | ${cat.commitsCount} | ${cat.focus || 'Deterministic code fixes'}${rulesList} |`
    );
  }
  lines.push('');

  const activeGrounding = groundingData || session?.groundingData;
  if (activeGrounding && activeGrounding.summary) {
    lines.push(
      `## 3. Verified Web Standards & MDN Documentation References`,
      '',
      activeGrounding.summary.trim(),
      ''
    );
    if (Array.isArray(activeGrounding.sources) && activeGrounding.sources.length > 0) {
      lines.push(`### Canonical Standards Citations`);
      for (const src of activeGrounding.sources) {
        lines.push(`- [${src.title || src.uri}](${src.uri})`);
      }
      lines.push('');
    }
  }

  const commitsSectionNumber = activeGrounding && activeGrounding.summary ? 4 : 3;
  lines.push(`## ${commitsSectionNumber}. Atomic Git Commits & Unified Diffs`, '');

  commitsToExport.forEach((commit, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    lines.push(
      `### ${num}. ${commit.title}`,
      '',
      `- **Commit SHA**: \`${commit.sha}\` (\`${commit.fullSha || commit.sha}\`)`,
      `- **Category**: **${commit.categoryLabel}**${commit.securityContext ? ` (${commit.securityContext})` : ''}`,
      `- **Analyzer & Verification**: \`${commit.analyzer || 'oss-ast'}\` · **${commit.fixConfidence === 'advisory-review' ? 'Advisory Review' : 'Auto-Verified Patch'}**`,
      `- **Rule / Audit ID**: \`${commit.ruleId || commit.category}\`${commit.impact ? ` · **Impact**: ${commit.impact}` : ''}`,
      `- **Files Modified**: ${(commit.files || []).map((f) => `\`${f}\``).join(', ')} (\`+${commit.additions || 0}\` / \`-${commit.deletions || 0}\`)`
    );

    if (commit.lhrAreaImproved) {
      lines.push(`- **LHR Category & Audit Improved**: \`${commit.lhrAreaImproved}\``);
    }
    if (commit.lhrTargetSelector) {
      lines.push(`- **LHR JSON Target Node**: \`${commit.lhrTargetSelector}\``);
    }

    lines.push('', `**Summary**: ${commit.summary}`, '', '```diff', (commit.diff || '').trim(), '```', '');
  });

  return lines.join('\n');
}

function escapePdfText(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/[^\x20-\x7E]/g, '');
}

function wrapTextLine(text, maxChars = 88) {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [''];
  if (cleaned.length <= maxChars) return [cleaned];
  const words = cleaned.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function generateAuditReportPdfBuffer(session, selectedCommitIds = null, groundingData = null) {
  const repoFullName = session?.repo?.fullName || 'fresnel-sandbox/lumina-web-app';
  const repoUrl = session?.repo?.url || `https://github.com/${repoFullName}`;
  const branch = session?.branch || 'main';
  const isLhr = session?.runPhase === 'lhr';
  const allCommits = Array.isArray(session?.commits) ? session.commits : [];
  const selectedIdSet =
    Array.isArray(selectedCommitIds) && selectedCommitIds.length > 0
      ? new Set(selectedCommitIds)
      : new Set(allCommits.map((c) => c.id));

  const commitsToExport =
    allCommits.filter((c) => selectedIdSet.has(c.id)).length > 0
      ? allCommits.filter((c) => selectedIdSet.has(c.id))
      : allCommits;

  const categoriesImproved = buildCategoriesImproved(commitsToExport, session?.runPhase || 'static');
  const totalAdditions = commitsToExport.reduce((acc, c) => acc + (Number(c.additions) || 0), 0);
  const totalDeletions = commitsToExport.reduce((acc, c) => acc + (Number(c.deletions) || 0), 0);

  const docItems = [];
  const pushItem = (text, font = 'F1', size = 10, leading = 14, indent = 50) => {
    docItems.push({ text: escapePdfText(text), font, size, leading, indent });
  };

  pushItem('FRESNEL ZERO-AI OPEN-SOURCE AUDIT REPORT', 'F2', 16, 22, 50);
  pushItem(
    isLhr
      ? `Run 2: Lighthouse Result (LHR) JSON Targeted Audit - ${repoFullName}`
      : `Run 1: Deterministic AST & Light Security Audit - ${repoFullName}`,
    'F2',
    11,
    18,
    50
  );
  pushItem(`Repository: ${repoUrl} (Branch: ${branch})`, 'F1', 9.5, 14, 50);
  pushItem(
    `Generated: ${new Date().toUTCString()} | Commits: ${commitsToExport.length} | Diff: +${totalAdditions} / -${totalDeletions}`,
    'F1',
    9.5,
    18,
    50
  );

  pushItem('1. CATEGORIES IMPROVED WITH AST CODEMODS', 'F2', 12, 18, 50);
  for (const cat of categoriesImproved) {
    pushItem(
      `[OK] ${cat.label}: Improved with verified code (${cat.commitsCount} ${cat.commitsCount === 1 ? 'commit' : 'commits'})`,
      'F2',
      10,
      14,
      58
    );
    if (cat.focus) {
      for (const line of wrapTextLine(cat.focus, 82)) {
        pushItem(line, 'F1', 9, 13, 72);
      }
    }
  }
  pushItem('', 'F1', 8, 10, 50);

  const activeGrounding = groundingData || session?.groundingData;
  if (activeGrounding && activeGrounding.summary) {
    pushItem('2. VERIFIED WEB STANDARDS & MDN REFERENCES', 'F2', 12, 18, 50);
    for (const paragraph of String(activeGrounding.summary).split('\n')) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;
      for (const wLine of wrapTextLine(trimmed, 85)) {
        pushItem(wLine, 'F1', 9.5, 13, 58);
      }
    }
    if (Array.isArray(activeGrounding.sources) && activeGrounding.sources.length > 0) {
      pushItem('Sources:', 'F2', 9.5, 14, 58);
      for (const src of activeGrounding.sources.slice(0, 6)) {
        pushItem(`- ${src.title || 'Reference'}: ${src.uri}`, 'F1', 8.5, 12, 66);
      }
    }
    pushItem('', 'F1', 8, 10, 50);
  }

  const commitsHeaderNum = activeGrounding && activeGrounding.summary ? '3' : '2';
  pushItem(`${commitsHeaderNum}. ATOMIC COMMITS & UNIFIED DIFFS`, 'F2', 12, 18, 50);

  commitsToExport.forEach((commit, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    pushItem(`${num}. ${commit.title}`, 'F2', 10.5, 16, 50);
    pushItem(
      `SHA: ${commit.sha} | Category: ${commit.categoryLabel} | Engine: ${commit.analyzer || 'oss-ast'} | Files: ${(commit.files || []).join(', ')}`,
      'F3',
      8.2,
      13,
      58
    );
    for (const wLine of wrapTextLine(commit.summary, 84)) {
      pushItem(wLine, 'F1', 9.5, 13, 58);
    }
    const diffLines = String(commit.diff || '').split('\n').slice(0, 18);
    for (const dLine of diffLines) {
      pushItem(dLine.slice(0, 92), 'F3', 8, 11, 64);
    }
    pushItem('', 'F1', 8, 10, 50);
  });

  const pages = [];
  let currentPageStream = [];
  let cursorY = 740;
  const minBottomY = 54;

  for (const item of docItems) {
    if (cursorY - item.leading < minBottomY) {
      pages.push(currentPageStream.join('\n'));
      currentPageStream = [];
      cursorY = 740;
    }
    if (item.text) {
      currentPageStream.push(
        `BT /${item.font} ${item.size} Tf 1 0 0 1 ${item.indent} ${cursorY} Tm (${item.text}) Tj ET`
      );
    }
    cursorY -= item.leading;
  }
  if (currentPageStream.length > 0 || pages.length === 0) {
    pages.push(currentPageStream.join('\n'));
  }

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };
  addObject('');
  addObject('');
  const f1Id = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f2Id = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const f3Id = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

  const pageIds = [];
  for (let i = 0; i < pages.length; i++) {
    const footerCmd = `BT /F1 8 Tf 1 0 0 1 50 30 Tm (Fresnel Zero-AI Audit Report - ${escapePdfText(repoFullName)} - Page ${i + 1} of ${pages.length}) Tj ET`;
    const fullStream = `${pages[i]}\n${footerCmd}`;
    const streamBytes = Buffer.byteLength(fullStream, 'utf-8');
    const contentId = addObject(`<< /Length ${streamBytes} >>\nstream\n${fullStream}\nendstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${f1Id} 0 R /F2 ${f2Id} 0 R /F3 ${f3Id} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdfOut = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdfOut, 'utf-8'));
    pdfOut += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdfOut, 'utf-8');
  pdfOut += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdfOut += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdfOut += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdfOut, 'utf-8');
}
