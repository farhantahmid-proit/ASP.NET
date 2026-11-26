import { useState } from 'react'
import type { ThreatIntelResult } from '@/api/$types/site-audit/response'

const WP_CHECKLIST_STORAGE_KEY = 'fresnel-wp-audit-checklist-v1'

function loadCheckedIds(domain: string): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(`${WP_CHECKLIST_STORAGE_KEY}:${domain}`)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

export interface ThreatAndCmsPanelProps {
  threatIntel: ThreatIntelResult | null
  status: string
}

export function ThreatAndCmsPanel({ threatIntel, status }: ThreatAndCmsPanelProps) {
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>(() =>
    loadCheckedIds(threatIntel?.domain || 'default'),
  )

  function toggleChecklistItem(itemId: string) {
    if (!threatIntel) return
    setCheckedMap((prev) => {
      const next = { ...prev, [itemId]: !prev[itemId] }
      try {
        window.localStorage.setItem(
          `${WP_CHECKLIST_STORAGE_KEY}:${threatIntel.domain}`,
          JSON.stringify(next),
        )
      } catch {
        // Ignore storage quota issues
      }
      return next
    })
  }

  if (!threatIntel) {
    return (
      <div className="fr-card">
        <p className="fr-muted">
          {status === 'running'
            ? 'Inspecting passive CT subdomains, email spoofing records, third-party SRI supply-chain scripts, and CMS hygiene...'
            : 'Run a site audit to view passive ASM subdomains, SPF/DMARC, third-party scripts, and CMS checks.'}
        </p>
      </div>
    )
  }

  return (
    <div className="fr-site-stack">
      <div className="fr-site-grid">
        <section className="fr-card">
          <div className="fr-card-head">
            <h3>Passive ASM &amp; Certificate Transparency</h3>
            <span className="fr-badge">{threatIntel.subdomains.length} subdomain(s)</span>
          </div>
          <p className="fr-muted" style={{ marginBottom: 10 }}>
            Domain: <code>{threatIntel.domain}</code> · Threat Hygiene Score:{' '}
            <strong>{threatIntel.threatScore} / 100</strong>
          </p>
          {threatIntel.subdomains.length > 0 ? (
            <div className="fr-chip-row">
              {threatIntel.subdomains.slice(0, 24).map((sub) => (
                <span key={sub} className="fr-chip fr-mono">
                  {sub}
                </span>
              ))}
            </div>
          ) : (
            <p className="fr-muted">
              No additional passive CT log subdomains returned for {threatIntel.domain} within timeout.
            </p>
          )}
        </section>

        <section className="fr-card">
          <div className="fr-card-head">
            <h3>Email Authentication &amp; Spoofing Risk</h3>
            <span className="fr-badge">SPF + DMARC</span>
          </div>
          <dl className="fr-kv-list">
            <div>
              <dt>SPF Record</dt>
              <dd>
                <span className={threatIntel.emailAuth.spfPresent ? 'fr-pill-ok' : 'fr-pill-warn'}>
                  {threatIntel.emailAuth.spfPresent
                    ? threatIntel.emailAuth.spfStrict
                      ? 'Strict (-all)'
                      : 'Present (~all / neutral)'
                    : 'Missing'}
                </span>
              </dd>
            </div>
            <div>
              <dt>DMARC Policy</dt>
              <dd>
                <span
                  className={
                    threatIntel.emailAuth.dmarcPresent && threatIntel.emailAuth.dmarcPolicy !== 'none'
                      ? 'fr-pill-ok'
                      : 'fr-pill-warn'
                  }
                >
                  {threatIntel.emailAuth.dmarcPresent
                    ? `p=${threatIntel.emailAuth.dmarcPolicy ?? 'configured'}`
                    : 'Missing (_dmarc)'}
                </span>
              </dd>
            </div>
            <div>
              <dt>Detected CMS</dt>
              <dd>
                <span className="fr-badge">{threatIntel.cmsAudit.detectedCms}</span> (CMS Score:{' '}
                {threatIntel.cmsScore}/100)
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="fr-card">
        <div className="fr-card-head">
          <h3>Third-Party Supply-Chain Script Inventory</h3>
          <span className="fr-badge">
            {threatIntel.supplyChainScripts.length} script(s) · {threatIntel.missingSriCount} missing
            SRI
          </span>
        </div>
        {threatIntel.supplyChainScripts.length === 0 ? (
          <p className="fr-muted">No external &lt;script src&gt; tags observed on the landing page.</p>
        ) : (
          <div className="fr-table-wrap">
            <table className="fr-table">
              <thead>
                <tr>
                  <th>Script Source</th>
                  <th>Origin</th>
                  <th>SRI Integrity</th>
                  <th>Transport</th>
                </tr>
              </thead>
              <tbody>
                {threatIntel.supplyChainScripts.map((script) => (
                  <tr key={script.src}>
                    <td className="fr-mono fr-cell-wrap">{script.src}</td>
                    <td>{script.thirdParty ? 'Third-Party CDN' : 'Same-Origin'}</td>
                    <td>
                      <span
                        className={
                          !script.thirdParty || script.hasSri ? 'fr-pill-ok' : 'fr-pill-warn'
                        }
                      >
                        {script.hasSri ? 'Verified SRI' : script.thirdParty ? 'Missing SRI' : 'N/A'}
                      </span>
                    </td>
                    <td>
                      <span className={script.mixedContent ? 'fr-pill-bad' : 'fr-pill-ok'}>
                        {script.mixedContent ? 'Mixed HTTP!' : 'HTTPS / Safe'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {threatIntel.cmsAudit.detectedCms === 'wordpress' && (
        <section className="fr-card">
          <div className="fr-card-head">
            <h3>WordPress Security Probes &amp; Audit Checklist</h3>
            <span className="fr-badge">wpaudit.site Pack</span>
          </div>
          <ul className="fr-violation-list" style={{ marginBottom: 14 }}>
            {threatIntel.cmsAudit.probes.map((probe) => (
              <li key={probe.id} className="fr-violation-item">
                <strong>{probe.title}</strong> · HTTP {probe.status || 'unreachable'} ·{' '}
                <span className={probe.exposed ? 'fr-pill-warn' : 'fr-pill-ok'}>
                  {probe.exposed ? 'Exposed' : 'Restricted'}
                </span>
              </li>
            ))}
          </ul>

          <div className="fr-wp-checklist">
            {threatIntel.cmsAudit.checklist.map((item) => (
              <label key={item.id} className="fr-wp-item">
                <input
                  type="checkbox"
                  checked={Boolean(checkedMap[item.id])}
                  onChange={() => toggleChecklistItem(item.id)}
                />
                <div>
                  <div className="fr-wp-item__head">
                    <strong>{item.title}</strong>
                    <span className="fr-badge">{item.category}</span>
                    <span className="fr-chip">{item.checkType}</span>
                  </div>
                  <p className="fr-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                    {item.guidance}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
