import { useMemo, useState } from 'react'
import type { SiteCrawlResult } from '@/api/$types/site-audit/response'
import { fetchSiteCrawlCsv } from '@/api/site-audit/site-audit'

export interface SiteCrawlPanelProps {
  sessionId: string | null
  siteCrawl: SiteCrawlResult | null
  status: string
}

export function SiteCrawlPanel({ sessionId, siteCrawl, status }: SiteCrawlPanelProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | '2xx' | '3xx' | '4xx-5xx'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const filteredPages = useMemo(() => {
    if (!siteCrawl) return []
    const q = searchQuery.trim().toLowerCase()
    return siteCrawl.pages.filter((page) => {
      if (statusFilter === '2xx' && (page.status < 200 || page.status >= 300)) return false
      if (statusFilter === '3xx' && (page.status < 300 || page.status >= 400)) return false
      if (statusFilter === '4xx-5xx' && page.status < 400 && page.status !== 0) return false
      if (onlyIssues && page.issues.length === 0) return false
      if (q && !page.url.toLowerCase().includes(q) && !page.title.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [siteCrawl, statusFilter, searchQuery, onlyIssues])

  async function handleExportCsv() {
    if (!sessionId) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const csvText = await fetchSiteCrawlCsv(sessionId)
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fresnel-site-crawl-${sessionId.slice(0, 12)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Unable to export crawl CSV.')
    } finally {
      setDownloading(false)
    }
  }

  if (!siteCrawl) {
    return (
      <div className="fr-card">
        <p className="fr-muted">
          {status === 'running'
            ? 'Crawling same-origin URLs and evaluating per-page SEO rules...'
            : status === 'skipped'
              ? 'Site crawl was skipped for this quick scan.'
              : 'Launch a site audit to crawl internal pages, check broken links, and export CSV.'}
        </p>
      </div>
    )
  }

  return (
    <div className="fr-site-stack">
      <section className="fr-card">
        <div className="fr-card-head">
          <div>
            <h3>Site Crawl Explorer</h3>
            <p className="fr-muted">
              Engine:{' '}
              <code>
                {siteCrawl.engine === 'siteone-rust'
                  ? 'SiteOne Rust Crawler'
                  : 'Fresnel Cheerio BFS'}
              </code>{' '}
              · Crawled {siteCrawl.crawledCount} URL(s) · Avg TTFB {siteCrawl.avgTtfbMs} ms ·{' '}
              {siteCrawl.brokenCount} error URL(s)
            </p>
          </div>
          <button
            type="button"
            className="fr-btn fr-btn--secondary"
            disabled={!sessionId || downloading}
            onClick={() => void handleExportCsv()}
          >
            {downloading ? 'Exporting CSV…' : 'Export Crawl CSV'}
          </button>
        </div>

        {downloadError && (
          <p className="fr-error" role="alert">
            {downloadError}
          </p>
        )}

        <div className="fr-filter-bar">
          <input
            type="search"
            className="fr-input"
            aria-label="Filter crawled URLs or titles"
            placeholder="Filter URL path or page title…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select
            className="fr-input fr-select-compact"
            aria-label="Filter by HTTP status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All Statuses ({siteCrawl.pages.length})</option>
            <option value="2xx">2xx OK</option>
            <option value="3xx">3xx Redirect</option>
            <option value="4xx-5xx">4xx / 5xx Errors</option>
          </select>
          <label className="fr-check-inline">
            <input
              type="checkbox"
              checked={onlyIssues}
              onChange={(e) => setOnlyIssues(e.target.checked)}
            />
            <span>Issues only</span>
          </label>
        </div>

        <div className="fr-table-wrap">
          <table className="fr-table">
            <thead>
              <tr>
                <th>URL</th>
                <th>Status</th>
                <th>TTFB</th>
                <th>Title / H1</th>
                <th>Images Missing Alt</th>
                <th>SEO Issues</th>
              </tr>
            </thead>
            <tbody>
              {filteredPages.map((page) => (
                <tr key={page.url}>
                  <td className="fr-mono fr-cell-wrap">{page.url}</td>
                  <td>
                    <span
                      className={
                        page.status >= 200 && page.status < 300
                          ? 'fr-pill-ok'
                          : page.status >= 300 && page.status < 400
                            ? 'fr-pill-warn'
                            : 'fr-pill-bad'
                      }
                    >
                      {page.status || 'ERR'}
                    </span>
                  </td>
                  <td>{page.ttfbMs} ms</td>
                  <td className="fr-cell-wrap">
                    <div>{page.title || '— Missing title —'}</div>
                    <div className="fr-muted" style={{ fontSize: 12 }}>
                      H1 count: {page.h1Count} · {page.canonical ? 'Canonical set' : 'No canonical'}
                    </div>
                  </td>
                  <td>{page.imagesMissingAlt}</td>
                  <td>
                    {page.issues.length === 0 ? (
                      <span className="fr-pill-ok">Clean</span>
                    ) : (
                      <ul className="fr-mini-list">
                        {page.issues.map((issue) => (
                          <li key={`${page.url}-${issue.ruleId}`}>
                            <strong>{issue.ruleId}</strong>: {issue.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
              {filteredPages.length === 0 && (
                <tr>
                  <td colSpan={6} className="fr-muted">
                    No crawled URLs matched the current filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
