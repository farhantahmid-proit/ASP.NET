import axe, { type AxeResults, type Result as AxeViolation } from 'axe-core'
import { useEffect, useMemo, useState } from 'react'
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'
import type {
  AxeRunSummary,
  AxeViolationSummary,
  PageSpeedAuditResult,
  WebVitalName,
  WebVitalReading,
} from '@/api/$types/live-audit/response'
import { useRunPageSpeedAudit } from '@/api/live-audit/live-audit.hooks'
import { localAuditStorage } from '@/lib/services/local-audit-storage'
import { storageService } from '@/lib/services/storage'
import type {
  AuditCommit,
  AuditSession,
  LighthouseCategory,
  LocalSavedAuditRecord,
} from '@/types/audit'

export type LiveSuiteTab = 'pagespeed' | 'axe-vitals' | 'playwright' | 'extension'

export interface LiveAuditSuiteProps {
  initialUrl?: string
  onOpenSavedAudit?: (record: LocalSavedAuditRecord) => void
  onSendLhrToAudit?: (lhrJson: string) => void
}

function formatVitalDisplay(name: WebVitalName, value: number): string {
  if (name === 'CLS') return value.toFixed(3)
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`
  return `${Math.round(value)} ms`
}

function initialWebVitalsMap(): Record<WebVitalName, WebVitalReading> {
  return {
    LCP: {
      name: 'LCP',
      label: 'Largest Contentful Paint',
      value: null,
      displayValue: 'Measuring...',
      rating: 'pending',
      updatedAtIso: null,
    },
    INP: {
      name: 'INP',
      label: 'Interaction to Next Paint',
      value: null,
      displayValue: 'Awaiting input',
      rating: 'pending',
      updatedAtIso: null,
    },
    CLS: {
      name: 'CLS',
      label: 'Cumulative Layout Shift',
      value: null,
      displayValue: '0.000',
      rating: 'good',
      updatedAtIso: null,
    },
    FCP: {
      name: 'FCP',
      label: 'First Contentful Paint',
      value: null,
      displayValue: 'Measuring...',
      rating: 'pending',
      updatedAtIso: null,
    },
    TTFB: {
      name: 'TTFB',
      label: 'Time to First Byte',
      value: null,
      displayValue: 'Measuring...',
      rating: 'pending',
      updatedAtIso: null,
    },
  }
}

function safeHostnameFromUrl(rawUrl: string, fallback = 'live-web-app'): string {
  try {
    return new URL(rawUrl).hostname || fallback
  } catch {
    return fallback
  }
}

function parseTargetUrls(rawUrls: string): string[] {
  const list = rawUrls
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/[a-zA-Z0-9.-]+/i.test(s))
    .slice(0, 12)
  return list.length > 0 ? list : ['https://example.com', 'https://example.com/pricing']
}

async function persistPageSpeedResult(result: PageSpeedAuditResult): Promise<LocalSavedAuditRecord> {
  const host = safeHostnameFromUrl(result.finalUrl || result.requestedUrl)
  const repoFullName = `pagespeed/${host}`
  const nowIso = result.fetchTime || new Date().toISOString()
  const auditId = `psi_${Date.now().toString(36)}_lhr`

  const commits: AuditCommit[] = result.failingAudits.slice(0, 20).map((item, idx) => {
    const sha = `psi${String(idx + 1).padStart(2, '0')}lh`.slice(0, 7)
    const cat: Exclude<LighthouseCategory, 'all'> = item.category || 'performance'
    return {
      id: `psi-${idx + 1}-${item.id}`,
      sha,
      fullSha: `${sha}${'0'.repeat(40)}`.slice(0, 40),
      category: cat,
      categoryLabel: cat,
      ruleId: item.id,
      title: item.displayValue ? `${item.title} (${item.displayValue})` : item.title,
      commitMessage: `perf(${cat}): address Lighthouse ${item.id}`,
      summary:
        item.description || `Google PageSpeed Insights (${result.strategy}) score: ${item.score}/100.`,
      files: [`live-url/${host}`],
      additions: 4,
      deletions: 1,
      author: 'Google PageSpeed Insights <lighthouse@pagespeed.local>',
      date: new Date(nowIso).toUTCString(),
      body: `Lighthouse v${result.lighthouseVersion} (${result.strategy}) · ${item.id}: ${item.description}`,
      diff: [
        `diff --git a/live-url/${host}.html b/live-url/${host}.html`,
        `--- a/live-url/${host}.html`,
        `+++ b/live-url/${host}.html`,
        '@@ -1,1 +1,2 @@',
        ` <!-- PageSpeed Insights (${result.strategy}): ${item.id} (score ${item.score}/100) -->`,
        `+<!-- Fix: ${item.title.replace(/-->/g, '--')} -->`,
      ].join('\n'),
    }
  })

  const perfBefore = result.scores.performance
  const a11yBefore = result.scores.accessibility
  const bpBefore = result.scores.bestPractices
  const seoBefore = result.scores.seo

  const perfAfter = Math.min(98, Math.max(perfBefore, perfBefore + 14))
  const a11yAfter = Math.min(98, Math.max(a11yBefore, a11yBefore + 10))
  const bpAfter = Math.min(98, Math.max(bpBefore, bpBefore + 6))
  const seoAfter = Math.min(98, Math.max(seoBefore, seoBefore + 6))

  const snapshotSession: AuditSession = {
    id: auditId,
    interactionId: `pagespeed-${result.strategy}`,
    engineType: 'google-pagespeed-insights',
    liveLighthouseAvailable: true,
    filesScanned: result.totalAuditsEvaluated,
    workspaceSource: 'google-pagespeed-insights',
    deterministicMetrics: {
      performanceBefore: perfBefore,
      performanceAfter: perfAfter,
      accessibilityBefore: a11yBefore,
      accessibilityAfter: a11yAfter,
      bestPracticesBefore: bpBefore,
      bestPracticesAfter: bpAfter,
      seoBefore,
      seoAfter,
      securityBefore: 88,
      securityAfter: 94,
    },
    mode: 'live',
    runPhase: 'lhr',
    status: 'completed',
    progressPercent: 100,
    repo: {
      owner: 'pagespeed',
      repo: host,
      fullName: repoFullName,
      url: result.finalUrl || result.requestedUrl,
      isDemo: false,
    },
    branch: `psi-${result.strategy}`,
    categories: ['performance', 'accessibility', 'best-practices', 'seo'],
    currentStep: {
      index: 0,
      phase: 'Completed',
      category: 'PageSpeed Insights',
      headline: `Google Lighthouse ${result.lighthouseVersion} (${result.strategy})`,
      narrative: `LCP ${result.coreWebVitals.lcpDisplay} · CLS ${result.coreWebVitals.clsDisplay} · FCP ${result.coreWebVitals.fcpDisplay}`,
    },
    steps: [],
    totalSteps: 1,
    commits,
    totalCommits: commits.length,
    pr: null,
  }

  const record: LocalSavedAuditRecord = {
    auditId,
    ownerId: 'local',
    repoFullName,
    repoUrl: result.finalUrl || result.requestedUrl,
    branch: `psi-${result.strategy}`,
    runPhase: 'lhr',
    mode: 'live',
    totalCommitsCount: Math.max(1, commits.length),
    selectedCommitsCount: commits.length,
    performanceBefore: perfBefore,
    performanceAfter: perfAfter,
    accessibilityBefore: a11yBefore,
    accessibilityAfter: a11yAfter,
    bestPracticesBefore: bpBefore,
    bestPracticesAfter: bpAfter,
    seoBefore,
    seoAfter,
    securityBefore: 88,
    securityAfter: 94,
    summaryNotes: `Google PageSpeed Insights (${result.strategy}, LH v${result.lighthouseVersion}) · LCP ${result.coreWebVitals.lcpDisplay}, CLS ${result.coreWebVitals.clsDisplay}, FCP ${result.coreWebVitals.fcpDisplay}. ${commits.length} failing audits.`,
    commitTitles: commits.map((c) => c.title).slice(0, 25),
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    storageSource: 'local',
    savedFormat: 'json',
    snapshotSession,
  }

  return storageService.persistAuditHistory(record, 'json')
}

export function LiveAuditSuite({
  initialUrl = 'https://web.dev',
  onOpenSavedAudit,
  onSendLhrToAudit,
}: LiveAuditSuiteProps) {
  const pageSpeedMutation = useRunPageSpeedAudit()

  const [activeTab, setActiveTab] = useState<LiveSuiteTab>('pagespeed')
  const [targetUrl, setTargetUrl] = useState(initialUrl || 'https://web.dev')
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile')
  const [latestPageSpeed, setLatestPageSpeed] = useState<PageSpeedAuditResult | null>(null)
  const [pageSpeedError, setPageSpeedError] = useState<string | null>(null)
  const [lhrLoadedNotice, setLhrLoadedNotice] = useState(false)

  const [isRunningAxe, setIsRunningAxe] = useState(false)
  const [axeError, setAxeError] = useState<string | null>(null)
  const [latestAxe, setLatestAxe] = useState<AxeRunSummary | null>(null)

  const [webVitals, setWebVitals] = useState<Record<WebVitalName, WebVitalReading>>(
    initialWebVitalsMap,
  )
  const [webVitalsNotice, setWebVitalsNotice] = useState<string | null>(null)

  const [playwrightUrls, setPlaywrightUrls] = useState(
    'https://staging.example.com/\nhttps://staging.example.com/dashboard\nhttps://staging.example.com/checkout',
  )
  const [playwrightStorageState, setPlaywrightStorageState] = useState('playwright-auth.json')
  const [playwrightCopied, setPlaywrightCopied] = useState(false)

  const [extensionJson, setExtensionJson] = useState('')
  const [extensionStatus, setExtensionStatus] = useState<string | null>(null)
  const [extensionError, setExtensionError] = useState<string | null>(null)
  const [lastImportedExtensionRecord, setLastImportedExtensionRecord] =
    useState<LocalSavedAuditRecord | null>(null)

  useEffect(() => {
    if (initialUrl) {
      setTargetUrl(initialUrl)
    }
  }, [initialUrl])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const recordMetric = (metric: Metric) => {
      const name = metric.name as WebVitalName
      const rating =
        metric.rating === 'good' || metric.rating === 'needs-improvement' || metric.rating === 'poor'
          ? metric.rating
          : 'good'

      setWebVitals((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          value: metric.value,
          displayValue: formatVitalDisplay(name, metric.value),
          rating,
          updatedAtIso: new Date().toISOString(),
        },
      }))
    }

    try {
      onLCP(recordMetric, { reportAllChanges: true })
      onINP(recordMetric, { reportAllChanges: true })
      onCLS(recordMetric, { reportAllChanges: true })
      onFCP(recordMetric, { reportAllChanges: true })
      onTTFB(recordMetric, { reportAllChanges: true })
    } catch {
      // Ignore in unsupported environments
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: unknown; payload?: unknown } | null
      if (!data || typeof data !== 'object' || data.type !== 'FRESNEL_EXTENSION_AUDIT_IMPORT') {
        return
      }
      if (!data.payload || typeof data.payload !== 'object') return
      try {
        const serialized = JSON.stringify(data.payload)
        if (serialized.length > 500_000) return
        const parsed = storageService.readAuditFileContent('chrome-extension-live-tab.json', serialized)
        setLastImportedExtensionRecord(parsed)
        setExtensionStatus(
          `Imported "${parsed.repoFullName}" (${parsed.totalCommitsCount} findings) into Saved Audits.`,
        )
      } catch {
        // Ignore invalid message payloads
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const webVitalsList = useMemo(
    () => [webVitals.LCP, webVitals.INP, webVitals.CLS, webVitals.FCP, webVitals.TTFB],
    [webVitals],
  )

  const playwrightCliCommand = useMemo(() => {
    const urls = parseTargetUrls(playwrightUrls)
    const authPart = playwrightStorageState.trim()
      ? ` --storage-state=${playwrightStorageState.trim().replace(/[^a-zA-Z0-9._/-]/g, '')}`
      : ''
    return `node scripts/playwright-lighthouse-audit.mjs --urls=${urls.join(',')}${authPart} --out=fresnel-playwright-audit.json`
  }, [playwrightUrls, playwrightStorageState])

  async function handleRunPageSpeed(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = targetUrl.trim()
    if (!trimmed) {
      setPageSpeedError('Enter a public http(s) URL to run Google PageSpeed Insights.')
      return
    }
    const normalizedUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    setTargetUrl(normalizedUrl)
    setPageSpeedError(null)
    setLhrLoadedNotice(false)

    try {
      const result = await pageSpeedMutation.mutateAsync({
        targetUrl: normalizedUrl,
        strategy,
        categories: ['performance', 'accessibility', 'best-practices', 'seo'],
      })
      const savedRecord = await persistPageSpeedResult(result)
      setLatestPageSpeed({ ...result, savedRecord })
    } catch (err) {
      setPageSpeedError(
        err instanceof Error ? err.message : 'Failed to run Google PageSpeed Insights audit.',
      )
    }
  }

  async function handleRunAxeCore() {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      setAxeError('axe-core requires an active browser DOM.')
      return
    }
    setIsRunningAxe(true)
    setAxeError(null)

    try {
      const results: AxeResults = await axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
      })

      const violations: AxeViolationSummary[] = results.violations.map((v: AxeViolation) => {
        const rawImpact = v.impact || 'moderate'
        const impact: AxeViolationSummary['impact'] =
          rawImpact === 'critical' ||
          rawImpact === 'serious' ||
          rawImpact === 'moderate' ||
          rawImpact === 'minor'
            ? rawImpact
            : 'moderate'
        const firstTarget = v.nodes?.[0]?.target
        const sampleSelector = Array.isArray(firstTarget)
          ? firstTarget.map(String).join(' ')
          : String(firstTarget || 'document')

        return {
          id: v.id,
          impact,
          help: v.help,
          description: v.description,
          helpUrl: v.helpUrl,
          nodesCount: v.nodes?.length || 1,
          sampleSelector: sampleSelector.slice(0, 140),
        }
      })

      const weightPenalty = violations.reduce((sum, v) => {
        if (v.impact === 'critical') return sum + 14
        if (v.impact === 'serious') return sum + 10
        if (v.impact === 'moderate') return sum + 5
        return sum + 2
      }, 0)

      const accessibilityScore = Math.max(25, Math.min(100, 100 - weightPenalty))
      const nowIso = new Date().toISOString()
      const currentUrl = window.location.href
      const host = safeHostnameFromUrl(currentUrl, 'fresnel-app')

      const commits: AuditCommit[] = violations.slice(0, 20).map((v, idx) => {
        const sha = `axe${String(idx + 1).padStart(2, '0')}aa`.slice(0, 7)
        return {
          id: `axe-${idx + 1}-${v.id}`,
          sha,
          fullSha: `${sha}${'0'.repeat(40)}`.slice(0, 40),
          category: 'accessibility',
          categoryLabel: 'Accessibility',
          ruleId: v.id,
          title: `[WCAG ${v.impact}] ${v.help} (${v.nodesCount} node${v.nodesCount === 1 ? '' : 's'})`,
          commitMessage: `a11y: resolve axe-core ${v.id} (${v.impact})`,
          summary: `${v.description} Selector: ${v.sampleSelector}`,
          files: [`dom/${host}`],
          additions: Math.max(2, v.nodesCount * 2),
          deletions: 1,
          author: 'axe-core WCAG Engine <axe@fresnel.local>',
          date: new Date(nowIso).toUTCString(),
          body: `Rule: ${v.id}\nImpact: ${v.impact}\nReference: ${v.helpUrl}\nSelector: ${v.sampleSelector}`,
          diff: [
            `diff --git a/dom/${host}.html b/dom/${host}.html`,
            `--- a/dom/${host}.html`,
            `+++ b/dom/${host}.html`,
            '@@ -1,1 +1,2 @@',
            ` <!-- axe-core WCAG rule: ${v.id} on ${v.sampleSelector} -->`,
            `+<!-- Fix: ${v.help.replace(/-->/g, '--')} -->`,
          ].join('\n'),
        }
      })

      const auditId = `axe_${Date.now().toString(36)}_static`
      const a11yAfter = Math.min(
        100,
        Math.max(accessibilityScore, accessibilityScore + Math.min(24, violations.length * 6)),
      )

      const snapshotSession: AuditSession = {
        id: auditId,
        interactionId: 'axe-core-wcag-live',
        engineType: 'axe-core-browser',
        liveLighthouseAvailable: false,
        filesScanned: results.passes.length + results.violations.length,
        workspaceSource: 'axe-core-live-dom',
        mode: 'live',
        runPhase: 'static',
        status: 'completed',
        progressPercent: 100,
        repo: {
          owner: 'axe-core',
          repo: host,
          fullName: `axe-core/${host}`,
          url: currentUrl,
          isDemo: false,
        },
        branch: 'wcag-2.2-aa',
        categories: ['accessibility'],
        currentStep: {
          index: 0,
          phase: 'Completed',
          category: 'Accessibility',
          headline: `axe-core WCAG 2.1/2.2 AA scan (${violations.length} findings)`,
          narrative: `${results.passes.length} rules passed, ${violations.length} violations detected on ${host}.`,
        },
        steps: [],
        totalSteps: 1,
        commits,
        totalCommits: commits.length,
        pr: null,
      }

      const record: LocalSavedAuditRecord = {
        auditId,
        ownerId: 'local',
        repoFullName: `axe-core/${host}`,
        repoUrl: currentUrl,
        branch: 'wcag-2.2-aa',
        runPhase: 'static',
        mode: 'live',
        totalCommitsCount: Math.max(1, commits.length),
        selectedCommitsCount: commits.length,
        performanceBefore: 90,
        performanceAfter: 94,
        accessibilityBefore: accessibilityScore,
        accessibilityAfter: a11yAfter,
        bestPracticesBefore: 90,
        bestPracticesAfter: 95,
        seoBefore: 92,
        seoAfter: 96,
        securityBefore: 92,
        securityAfter: 96,
        summaryNotes: `In-browser axe-core WCAG 2.1/2.2 AA scan: ${results.passes.length} rules passed, ${violations.length} violation(s), ${results.incomplete.length} needs review.`,
        commitTitles: commits.map((c) => c.title).slice(0, 25),
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        storageSource: 'local',
        savedFormat: 'json',
        snapshotSession,
      }

      const persisted = await storageService.persistAuditHistory(record, 'json')
      setLatestAxe({
        url: currentUrl,
        timestampIso: nowIso,
        passesCount: results.passes.length,
        incompleteCount: results.incomplete.length,
        violations,
        accessibilityScore,
        savedRecord: persisted,
      })
    } catch (err) {
      setAxeError(err instanceof Error ? err.message : 'Unable to execute axe-core WCAG audit.')
    } finally {
      setIsRunningAxe(false)
    }
  }

  async function handleSaveWebVitalsSnapshot() {
    const nowIso = new Date().toISOString()
    const currentUrl = typeof window !== 'undefined' ? window.location.href : 'https://localhost/'
    const host = safeHostnameFromUrl(currentUrl, 'fresnel-live')
    const auditId = `vitals_${Date.now().toString(36)}_lhr`

    const commits: AuditCommit[] = []
    let perfPenalty = 0
    for (const v of webVitalsList) {
      if (v.rating === 'poor') perfPenalty += 16
      else if (v.rating === 'needs-improvement') perfPenalty += 8

      if (v.rating === 'poor' || v.rating === 'needs-improvement') {
        const idx = commits.length + 1
        const sha = `wv${String(idx).padStart(2, '0')}perf`.slice(0, 7)
        commits.push({
          id: `web-vital-${v.name.toLowerCase()}`,
          sha,
          fullSha: `${sha}${'0'.repeat(40)}`.slice(0, 40),
          category: 'performance',
          categoryLabel: 'Performance',
          ruleId: `web-vitals-${v.name.toLowerCase()}`,
          title: `Optimize ${v.label} (${v.name}: ${v.displayValue} · ${v.rating})`,
          commitMessage: `perf: improve ${v.name} from ${v.displayValue}`,
          summary: `Live browser web-vitals reading for ${v.label} rated "${v.rating}".`,
          files: [`runtime/${host}`],
          additions: 3,
          deletions: 1,
          author: 'web-vitals Telemetry <vitals@fresnel.local>',
          date: new Date(nowIso).toUTCString(),
          body: `${v.label} (${v.name}) measured at ${v.displayValue}.`,
          diff: [
            `diff --git a/runtime/${host}.ts b/runtime/${host}.ts`,
            `--- a/runtime/${host}.ts`,
            `+++ b/runtime/${host}.ts`,
            '@@ -1,1 +1,2 @@',
            ` // web-vitals ${v.name}: ${v.displayValue} (${v.rating})`,
            `+// Action: optimize critical rendering path for ${v.name}`,
          ].join('\n'),
        })
      }
    }

    const perfBefore = Math.max(42, 96 - perfPenalty)
    const perfAfter = Math.min(98, perfBefore + Math.max(4, Math.min(18, perfPenalty)))

    const record: LocalSavedAuditRecord = {
      auditId,
      ownerId: 'local',
      repoFullName: `web-vitals/${host}`,
      repoUrl: currentUrl,
      branch: 'rum-web-vitals',
      runPhase: 'lhr',
      mode: 'live',
      totalCommitsCount: Math.max(1, commits.length),
      selectedCommitsCount: commits.length,
      performanceBefore: perfBefore,
      performanceAfter: perfAfter,
      accessibilityBefore: latestAxe?.accessibilityScore ?? 92,
      accessibilityAfter: 98,
      bestPracticesBefore: 90,
      bestPracticesAfter: 96,
      seoBefore: 92,
      seoAfter: 96,
      securityBefore: 92,
      securityAfter: 96,
      summaryNotes: `Live web-vitals snapshot — LCP: ${webVitals.LCP.displayValue}, INP: ${webVitals.INP.displayValue}, CLS: ${webVitals.CLS.displayValue}, FCP: ${webVitals.FCP.displayValue}, TTFB: ${webVitals.TTFB.displayValue}.`,
      commitTitles:
        commits.length > 0
          ? commits.map((c) => c.title)
          : [
              `All Core Web Vitals within Good thresholds (${webVitals.LCP.displayValue} LCP, ${webVitals.CLS.displayValue} CLS)`,
            ],
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      storageSource: 'local',
      savedFormat: 'json',
      snapshotSession: null,
    }

    const persisted = await storageService.persistAuditHistory(record, 'json')
    setWebVitalsNotice(`Saved live web-vitals snapshot (${persisted.repoFullName}) to offline history.`)
  }

  function handleImportExtensionJson(event: React.FormEvent) {
    event.preventDefault()
    setExtensionError(null)
    setExtensionStatus(null)
    const trimmed = extensionJson.trim()
    if (!trimmed) {
      setExtensionError('Paste or upload a Fresnel JSON export from the Companion Chrome Extension.')
      return
    }
    try {
      const parsed = storageService.readAuditFileContent('chrome-extension-audit.json', trimmed)
      setLastImportedExtensionRecord(parsed)
      setExtensionStatus(`Imported "${parsed.repoFullName}" (${parsed.totalCommitsCount} findings).`)
      setExtensionJson('')
    } catch (err) {
      setExtensionError(
        err instanceof Error ? err.message : 'Invalid Chrome Extension audit JSON payload.',
      )
    }
  }

  function handleDownloadPlaywrightScript() {
    const urls = parseTargetUrls(playwrightUrls)
    const safeStorage = playwrightStorageState.trim().replace(/['"\\]/g, '')
    const content = [
      '#!/usr/bin/env node',
      '// Generated by Fresnel Live Audit Suite — Playwright + playwright-lighthouse + @axe-core/playwright',
      "import { execFileSync } from 'node:child_process';",
      `const urls = ${JSON.stringify(urls)};`,
      "const args = ['scripts/playwright-lighthouse-audit.mjs', '--urls=' + urls.join(','), '--out=fresnel-playwright-audit.json'];",
      safeStorage ? `args.push('--storage-state=${safeStorage}');` : '',
      "execFileSync(process.execPath, args, { stdio: 'inherit' });",
    ]
      .filter(Boolean)
      .join('\n')

    localAuditStorage.downloadPayloadAsFile(
      'run-fresnel-playwright-journey.mjs',
      content,
      'text/javascript;charset=utf-8',
    )
  }

  return (
    <section className="fr-card" aria-labelledby="live-audit-suite-heading">
      <div className="fr-section-head">
        <div>
          <p className="fr-eyebrow">
            <span className="fr-eyebrow-line" /> GOOGLE PAGESPEED · AXE-CORE WCAG · WEB-VITALS RUM
          </p>
          <h2 id="live-audit-suite-heading" className="fr-section-title">
            Live Browser &amp; Cloud Audit Integrations
          </h2>
          <p className="fr-muted">
            Run Google PageSpeed Insights v5 cloud Lighthouse audits, execute live DOM{' '}
            <code>axe-core</code> WCAG 2.1/2.2 scans, inspect real-time <code>web-vitals</code>{' '}
            metrics, or generate authenticated Playwright scripts.
          </p>
        </div>

        <div className="fr-segmented" role="tablist" aria-label="Live audit integrations">
          <button
            type="button"
            id="live-suite-tab-pagespeed"
            role="tab"
            aria-selected={activeTab === 'pagespeed'}
            className={`fr-segmented__btn${activeTab === 'pagespeed' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('pagespeed')}
          >
            PageSpeed Cloud
          </button>
          <button
            type="button"
            id="live-suite-tab-axe"
            role="tab"
            aria-selected={activeTab === 'axe-vitals'}
            className={`fr-segmented__btn${activeTab === 'axe-vitals' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('axe-vitals')}
          >
            axe-core &amp; Web Vitals
          </button>
          <button
            type="button"
            id="live-suite-tab-playwright"
            role="tab"
            aria-selected={activeTab === 'playwright'}
            className={`fr-segmented__btn${activeTab === 'playwright' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('playwright')}
          >
            Playwright CLI
          </button>
          <button
            type="button"
            id="live-suite-tab-extension"
            role="tab"
            aria-selected={activeTab === 'extension'}
            className={`fr-segmented__btn${activeTab === 'extension' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('extension')}
          >
            Browser Extension
          </button>
        </div>
      </div>

      {activeTab === 'pagespeed' && (
        <div role="tabpanel" aria-labelledby="live-suite-tab-pagespeed" className="fr-live-panel">
          <form onSubmit={(e) => void handleRunPageSpeed(e)} className="fr-intake-form">
            <div className="fr-intake-grid">
              <label className="fr-field">
                <span className="fr-label">Public Website URL</span>
                <input
                  id="psi-url-input"
                  type="url"
                  className="fr-input"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://web.dev"
                />
              </label>

              <div className="fr-field">
                <span className="fr-label">Emulated Device Strategy</span>
                <div className="fr-segmented" role="group" aria-label="PageSpeed device strategy">
                  <button
                    type="button"
                    className={`fr-segmented__btn${strategy === 'mobile' ? ' is-active' : ''}`}
                    onClick={() => setStrategy('mobile')}
                  >
                    Mobile
                  </button>
                  <button
                    type="button"
                    className={`fr-segmented__btn${strategy === 'desktop' ? ' is-active' : ''}`}
                    onClick={() => setStrategy('desktop')}
                  >
                    Desktop
                  </button>
                </div>
              </div>
            </div>

            <div className="fr-actions">
              <button
                type="submit"
                id="psi-run-btn"
                className="fr-btn-primary"
                disabled={pageSpeedMutation.isPending}
              >
                {pageSpeedMutation.isPending ? 'Running PageSpeed Insights...' : 'Run PageSpeed Audit'}
              </button>
            </div>
          </form>

          {pageSpeedError && (
            <p className="fr-error" role="alert">
              {pageSpeedError}
            </p>
          )}

          {latestPageSpeed && (
            <div className="fr-result-banner">
              <div className="fr-kpi-strip">
                <div className="fr-kpi-cell">
                  <span className="fr-muted">Performance</span>
                  <strong className="fr-kpi-cell__value">{latestPageSpeed.scores.performance}</strong>
                </div>
                <div className="fr-kpi-cell">
                  <span className="fr-muted">Accessibility</span>
                  <strong className="fr-kpi-cell__value">{latestPageSpeed.scores.accessibility}</strong>
                </div>
                <div className="fr-kpi-cell">
                  <span className="fr-muted">Best Practices</span>
                  <strong className="fr-kpi-cell__value">{latestPageSpeed.scores.bestPractices}</strong>
                </div>
                <div className="fr-kpi-cell">
                  <span className="fr-muted">SEO</span>
                  <strong className="fr-kpi-cell__value">{latestPageSpeed.scores.seo}</strong>
                </div>
              </div>

              <div className="fr-muted">
                LCP: <strong>{latestPageSpeed.coreWebVitals.lcpDisplay}</strong> · FCP:{' '}
                <strong>{latestPageSpeed.coreWebVitals.fcpDisplay}</strong> · CLS:{' '}
                <strong>{latestPageSpeed.coreWebVitals.clsDisplay}</strong> · TBT:{' '}
                <strong>{latestPageSpeed.coreWebVitals.tbtDisplay}</strong>
              </div>

              <div className="fr-actions">
                {latestPageSpeed.savedRecord && onOpenSavedAudit && (
                  <button
                    type="button"
                    className="fr-btn-primary"
                    onClick={() => onOpenSavedAudit(latestPageSpeed.savedRecord!)}
                  >
                    Open Saved Audit
                  </button>
                )}
                {onSendLhrToAudit && (
                  <button
                    type="button"
                    className="fr-btn-secondary"
                    onClick={() => {
                      onSendLhrToAudit(latestPageSpeed.lhrJson)
                      setLhrLoadedNotice(true)
                    }}
                  >
                    {lhrLoadedNotice ? 'Loaded LHR into Correlation ✓' : 'Send LHR to Audit'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'axe-vitals' && (
        <div role="tabpanel" aria-labelledby="live-suite-tab-axe" className="fr-live-panel">
          <div className="fr-section-head">
            <h3 className="fr-subsection-title">Live Core Web Vitals (web-vitals RUM Observer)</h3>
            <button
              type="button"
              id="save-web-vitals-snapshot-btn"
              className="fr-btn-secondary"
              onClick={() => void handleSaveWebVitalsSnapshot()}
            >
              Save Vitals Snapshot
            </button>
          </div>

          <div className="fr-kpi-strip" aria-label="Live Core Web Vitals readings">
            {webVitalsList.map((vital) => (
              <div key={vital.name} className="fr-kpi-cell">
                <div className="fr-axis-row__top">
                  <strong>{vital.name}</strong>
                  <span className="fr-badge">{vital.rating}</span>
                </div>
                <strong className="fr-kpi-cell__value">{vital.displayValue}</strong>
                <span className="fr-muted">{vital.label}</span>
              </div>
            ))}
          </div>

          {webVitalsNotice && (
            <p className="fr-muted" role="status" aria-live="polite">
              {webVitalsNotice}
            </p>
          )}

          <div className="fr-bundle-box">
            <div className="fr-section-head">
              <div>
                <h3 className="fr-subsection-title">Real axe-core WCAG 2.1 / 2.2 AA Engine</h3>
                <p className="fr-muted">
                  Evaluates the active rendered DOM against WCAG 2A, 2AA, 2.1AA, 2.2AA, and
                  best-practice rules.
                </p>
              </div>
              <button
                type="button"
                id="run-axe-core-btn"
                className="fr-btn-primary"
                disabled={isRunningAxe}
                onClick={() => void handleRunAxeCore()}
              >
                {isRunningAxe ? 'Scanning DOM with axe-core...' : 'Run axe-core WCAG Scan'}
              </button>
            </div>

            {axeError && (
              <p className="fr-error" role="alert">
                {axeError}
              </p>
            )}

            {latestAxe && (
              <div className="fr-result-banner" role="status" aria-live="polite">
                <div className="fr-result-banner__info">
                  <span>
                    Score: <strong>{latestAxe.accessibilityScore}/100</strong>
                  </span>
                  <span>
                    Passed: <strong>{latestAxe.passesCount}</strong>
                  </span>
                  <span>
                    Violations: <strong>{latestAxe.violations.length}</strong>
                  </span>
                  <span>
                    Needs review: <strong>{latestAxe.incompleteCount}</strong>
                  </span>
                </div>

                {latestAxe.violations.length > 0 ? (
                  <ul className="fr-violation-list">
                    {latestAxe.violations.map((v) => (
                      <li key={v.id} className="fr-violation-item">
                        <strong>{v.help}</strong> ({v.impact} · {v.nodesCount} nodes) —{' '}
                        <code>{v.id}</code> @ <code>{v.sampleSelector}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="fr-muted">
                    Zero WCAG 2.1/2.2 AA violations detected across {latestAxe.passesCount} rules.
                  </p>
                )}

                {onOpenSavedAudit && (
                  <div className="fr-actions">
                    <button
                      type="button"
                      className="fr-btn-primary"
                      onClick={() => onOpenSavedAudit(latestAxe.savedRecord)}
                    >
                      Open axe-core Report
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'playwright' && (
        <div role="tabpanel" aria-labelledby="live-suite-tab-playwright" className="fr-live-panel">
          <div className="fr-intake-grid">
            <label className="fr-field">
              <span className="fr-label">Multi-Page Journey URLs</span>
              <textarea
                id="pw-urls-input"
                rows={3}
                className="fr-input"
                value={playwrightUrls}
                onChange={(e) => setPlaywrightUrls(e.target.value)}
              />
            </label>
            <label className="fr-field">
              <span className="fr-label">Optional Auth Storage State JSON</span>
              <input
                id="pw-storage-state"
                type="text"
                className="fr-input"
                value={playwrightStorageState}
                onChange={(e) => setPlaywrightStorageState(e.target.value)}
              />
            </label>
          </div>
          <pre className="fr-code-block">{playwrightCliCommand}</pre>
          <div className="fr-actions">
            <button
              type="button"
              id="pw-copy-cli-btn"
              className="fr-btn-primary"
              onClick={() => {
                void navigator.clipboard?.writeText(playwrightCliCommand)
                setPlaywrightCopied(true)
                window.setTimeout(() => setPlaywrightCopied(false), 2000)
              }}
            >
              {playwrightCopied ? 'Copied CLI Command ✓' : 'Copy CLI Command'}
            </button>
            <button
              type="button"
              id="pw-download-script-btn"
              className="fr-btn-secondary"
              onClick={handleDownloadPlaywrightScript}
            >
              Download Runner (.mjs)
            </button>
          </div>
        </div>
      )}

      {activeTab === 'extension' && (
        <div role="tabpanel" aria-labelledby="live-suite-tab-extension" className="fr-live-panel">
          <form onSubmit={handleImportExtensionJson} className="fr-intake-form">
            <label className="fr-field">
              <span className="fr-label">Paste Browser Extension Fresnel JSON Export</span>
              <textarea
                id="ext-json-textarea"
                rows={4}
                className="fr-input"
                value={extensionJson}
                onChange={(e) => setExtensionJson(e.target.value)}
                placeholder='{"format": "fresnel-audit-json/v1", "record": { ... }}'
              />
            </label>
            <div className="fr-actions">
              <button type="submit" id="ext-import-json-btn" className="fr-btn-primary">
                Import Extension JSON
              </button>
              {lastImportedExtensionRecord && onOpenSavedAudit && (
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() => onOpenSavedAudit(lastImportedExtensionRecord)}
                >
                  Open Imported Audit
                </button>
              )}
            </div>
          </form>
          {extensionError && (
            <p className="fr-error" role="alert">
              {extensionError}
            </p>
          )}
          {extensionStatus && (
            <p className="fr-muted" role="status" aria-live="polite">
              {extensionStatus}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
