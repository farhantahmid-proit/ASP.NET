import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CommitDiffViewer } from './CommitDiffViewer'

describe('components/audit/CommitDiffViewer', () => {
  it('renders side-by-side table rows with additions and deletions highlighted', () => {
    const sampleDiff = [
      'diff --git a/src/index.html b/src/index.html',
      '--- a/src/index.html',
      '+++ b/src/index.html',
      '@@ -1,2 +1,2 @@',
      '-<img src="/hero.jpg">',
      '+<img src="/hero.jpg" fetchpriority="high">',
      ' </head>',
    ].join('\n')

    const html = renderToStaticMarkup(<CommitDiffViewer diff={sampleDiff} />)
    expect(html).toContain('src/index.html')
    expect(html).toContain('+1')
    expect(html).toContain('-1')
    expect(html).toContain('sbs-line--del')
    expect(html).toContain('sbs-line--add')
    expect(html).toContain('fetchpriority=&quot;high&quot;')
  })

  it('renders empty state when diff string is blank', () => {
    const html = renderToStaticMarkup(<CommitDiffViewer diff="" />)
    expect(html).toContain('No code diff lines available for this commit.')
  })
})
