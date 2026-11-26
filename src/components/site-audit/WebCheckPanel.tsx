import type { WebCheckResult } from '@/api/$types/site-audit/response'

export interface WebCheckPanelProps {
  webCheck: WebCheckResult | null
  status: string
}

export function WebCheckPanel({ webCheck, status }: WebCheckPanelProps) {
  if (!webCheck) {
    return (
      <div className="fr-card">
        <p className="fr-muted">
          {status === 'running'
            ? 'Running native DNS, TLS certificate, Security Headers, and GEO discovery checks...'
            : 'Run a site audit above to inspect DNS records, TLS validity, HTTP headers, cookies, and /llms.txt GEO readiness.'}
        </p>
      </div>
    )
  }

  return (
    <div className="fr-site-grid">
      <section className="fr-card">
        <div className="fr-card-head">
          <h3>Infrastructure, Redirects &amp; TLS</h3>
          <span className="fr-badge">
            HTTP {webCheck.status} · {webCheck.elapsedMs} ms
          </span>
        </div>
        <dl className="fr-kv-list">
          <div>
            <dt>Final URL</dt>
            <dd className="fr-mono">{webCheck.finalUrl}</dd>
          </div>
          <div>
            <dt>Redirect Hops</dt>
            <dd>
              {webCheck.redirectChain.length === 0
                ? 'Direct (0 hops)'
                : `${webCheck.redirectChain.length} hop(s)`}
            </dd>
          </div>
          <div>
            <dt>TLS Protocol / Issuer</dt>
            <dd>
              {webCheck.tls.enabled
                ? `${webCheck.tls.protocol ?? 'TLS'} · ${webCheck.tls.issuer ?? 'Unknown CA'}`
                : 'Plain HTTP (No TLS)'}
            </dd>
          </div>
          <div>
            <dt>Certificate Validity</dt>
            <dd>
              {webCheck.tls.enabled ? (
                <span className={webCheck.tls.authorized ? 'fr-pill-ok' : 'fr-pill-warn'}>
                  {webCheck.tls.authorized ? 'Trusted' : 'Warning'}
                  {typeof webCheck.tls.daysRemaining === 'number'
                    ? ` · ${webCheck.tls.daysRemaining}d remaining`
                    : ''}
                </span>
              ) : (
                <span className="fr-pill-bad">Unencrypted</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Detected Stack / CMS</dt>
            <dd className="fr-chip-row">
              <span className="fr-badge">{webCheck.detectedCms}</span>
              {webCheck.techStack.map((tech) => (
                <span key={tech} className="fr-chip">
                  {tech}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </section>

      <section className="fr-card">
        <div className="fr-card-head">
          <h3>DNS &amp; Mail Authentication</h3>
          <span className="fr-badge">SPF / DMARC / NS / MX</span>
        </div>
        <dl className="fr-kv-list">
          <div>
            <dt>IPv4 (A)</dt>
            <dd className="fr-mono">{webCheck.dns.a.slice(0, 4).join(', ') || 'None'}</dd>
          </div>
          <div>
            <dt>IPv6 (AAAA)</dt>
            <dd className="fr-mono">{webCheck.dns.aaaa.slice(0, 2).join(', ') || 'None'}</dd>
          </div>
          <div>
            <dt>Nameservers (NS)</dt>
            <dd className="fr-mono">{webCheck.dns.ns.slice(0, 4).join(', ') || 'None'}</dd>
          </div>
          <div>
            <dt>MX Relays</dt>
            <dd className="fr-mono">
              {webCheck.dns.mx.map((m) => m.exchange).slice(0, 3).join(', ') || 'None'}
            </dd>
          </div>
          <div>
            <dt>Email Spoofing Protection</dt>
            <dd className="fr-chip-row">
              <span className={webCheck.dns.spfPresent ? 'fr-pill-ok' : 'fr-pill-warn'}>
                SPF: {webCheck.dns.spfPresent ? 'Present' : 'Missing'}
              </span>
              <span
                className={
                  webCheck.dns.dmarcPresent && webCheck.dns.dmarcPolicy !== 'none'
                    ? 'fr-pill-ok'
                    : 'fr-pill-warn'
                }
              >
                DMARC:{' '}
                {webCheck.dns.dmarcPresent
                  ? `p=${webCheck.dns.dmarcPolicy ?? 'configured'}`
                  : 'Missing'}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="fr-card fr-site-span-2">
        <div className="fr-card-head">
          <h3>Security Headers &amp; Cookie Hygiene</h3>
          <span className="fr-badge">Score: {webCheck.securityHeaders.score} / 100</span>
        </div>
        <div className="fr-table-wrap">
          <table className="fr-table">
            <thead>
              <tr>
                <th>Header</th>
                <th>Status</th>
                <th>Observed Value / Guidance</th>
              </tr>
            </thead>
            <tbody>
              {webCheck.securityHeaders.matrix.map((row) => (
                <tr key={row.header}>
                  <td className="fr-mono">{row.label}</td>
                  <td>
                    <span className={row.present ? 'fr-pill-ok' : 'fr-pill-warn'}>
                      {row.present ? 'Present' : 'Missing'}
                    </span>
                  </td>
                  <td className="fr-mono fr-cell-wrap">
                    {row.value ? row.value.slice(0, 140) : `Recommended: ${row.recommended}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {webCheck.cookies.length > 0 && (
          <div className="fr-subblock">
            <h4>Set-Cookie Flags ({webCheck.cookies.length})</h4>
            <ul className="fr-violation-list">
              {webCheck.cookies.map((cookie) => (
                <li key={cookie.name} className="fr-violation-item">
                  <strong className="fr-mono">{cookie.name}</strong> ·{' '}
                  {cookie.hasSecure ? 'Secure' : 'No Secure'} ·{' '}
                  {cookie.hasHttpOnly ? 'HttpOnly' : 'No HttpOnly'} ·{' '}
                  {cookie.sameSite ? `SameSite=${cookie.sameSite}` : 'No SameSite'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="fr-card fr-site-span-2">
        <div className="fr-card-head">
          <h3>GEO &amp; AI Crawler Readiness</h3>
          <span className="fr-badge">GEO Score: {webCheck.geo.geoReadinessScore} / 100</span>
        </div>
        <div className="fr-chip-row">
          <span className={webCheck.geo.robotsTxtPresent ? 'fr-pill-ok' : 'fr-pill-warn'}>
            /robots.txt: {webCheck.geo.robotsTxtPresent ? 'Present' : 'Missing'}
          </span>
          <span className={webCheck.geo.sitemapXmlPresent ? 'fr-pill-ok' : 'fr-pill-warn'}>
            /sitemap.xml: {webCheck.geo.sitemapXmlPresent ? 'Present' : 'Missing'}
          </span>
          <span className={webCheck.geo.llmsTxtPresent ? 'fr-pill-ok' : 'fr-pill-warn'}>
            /llms.txt: {webCheck.geo.llmsTxtPresent ? 'Present' : 'Missing'}
          </span>
        </div>
        <div className="fr-chip-row" style={{ marginTop: 10 }}>
          {webCheck.geo.aiBots.map((bot) => (
            <span
              key={bot.bot}
              className={bot.status.startsWith('blocked') ? 'fr-pill-warn' : 'fr-pill-ok'}
            >
              {bot.bot}: {bot.status.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}
