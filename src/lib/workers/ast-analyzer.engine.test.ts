import { describe, expect, it } from 'vitest'
import { buildSampleRepositorySourceFiles } from '@/lib/services/ast-worker-audit'
import { analyzeSourceFilesWithAcorn } from './ast-analyzer.engine'

describe('ast-analyzer.engine', () => {
  it('analyzes the sample repository off-thread payload cleanly with Acorn AST', () => {
    const files = buildSampleRepositorySourceFiles()
    const progressEvents: number[] = []

    const result = analyzeSourceFilesWithAcorn(
      {
        requestId: 'req-sample-1',
        repoName: 'local/sample-storefront-repo',
        files,
      },
      (progress) => {
        progressEvents.push(progress.percent)
      },
      true,
    )

    expect(result.session.status).toBe('completed')
    expect(result.summary.repoFullName).toBe('local/sample-storefront-repo')
    expect(result.summary.filesAnalyzed).toBe(files.length)
    expect(result.summary.astNodesVisited).toBeGreaterThan(20)
    expect(result.commits.length).toBeGreaterThan(0)
    expect(progressEvents.length).toBe(files.length)
  })

  it('detects namespace imports, unsafe innerHTML sinks, and missing img alt attributes', () => {
    const result = analyzeSourceFilesWithAcorn(
      {
        requestId: 'req-custom-2',
        repoName: 'org/custom-repo',
        files: [
          {
            path: 'src/app.ts',
            content: [
              "import * as lodashUtils from 'lodash';",
              'export function render(el: HTMLElement, html: string) {',
              '  el.innerHTML = html;',
              '  window.addEventListener("scroll", () => lodashUtils.noop());',
              '}',
            ].join('\n'),
          },
          {
            path: 'index.html',
            content: '<html><body><img src="/hero.jpg"></body></html>',
          },
        ],
      },
      undefined,
      false,
    )

    expect(result.summary.findingsCount).toBeGreaterThanOrEqual(2)
    expect(result.commits.some((c) => c.category === 'security')).toBe(true)
  })
})
