import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useFresnelConfig, useStartAudit } from '@/api/audit/audit.hooks'
import { FresnelLogo } from '@/components/ui/FresnelLogo'
import { SrTooltip } from '@/components/ui/SrTooltip'
import { useAuth } from '@/providers/auth-provider'
import type { LighthouseCategory } from '@/types/audit'

export const Route = createFileRoute('/')({ component: HomePage })

const AUDIT_CATEGORIES: Array<{
  id: Exclude<LighthouseCategory, 'all'>
  label: string
}> = [
  { id: 'performance', label: 'Performance' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'best-practices', label: 'Best Practices' },
  { id: 'seo', label: 'SEO' },
  { id: 'security', label: 'Web Security' },
]

function HomePage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { data: config } = useFresnelConfig()
  const startAuditMutation = useStartAudit()

  const [repoUrl, setRepoUrl] = useState('https://github.com/fresnel-sandbox/lumina-web-app')
  const [branch, setBranch] = useState('main')
  const [selectedCategories, setSelectedCategories] = useState<
    Array<Exclude<LighthouseCategory, 'all'>>
  >(['performance', 'accessibility', 'best-practices', 'seo', 'security'])
  const [formError, setFormError] = useState<string | null>(null)

  function toggleCategory(cat: Exclude<LighthouseCategory, 'all'>) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((item) => item !== cat) : [...prev, cat],
    )
  }

  async function launchAudit(mode: 'live' | 'demo') {
    setFormError(null)
    if (selectedCategories.length === 0) {
      setFormError('Select at least one Lighthouse or security audit category.')
      return
    }
    const targetUrl = repoUrl.trim()
    if (mode === 'live' && !targetUrl) {
      setFormError('Enter a GitHub repository URL or launch Sandbox Demo Mode.')
      return
    }

    try {
      const started = await startAuditMutation.mutateAsync({
        repoUrl:
          mode === 'demo'
            ? 'https://github.com/fresnel-sandbox/lumina-web-app'
            : targetUrl,
        mode,
        branch: branch.trim() || 'main',
        categories: selectedCategories,
      })
      void navigate({
        to: '/audit/$auditId',
        params: { auditId: started.id },
      })
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unable to start repository audit.',
      )
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void launchAudit('live')
  }

  return (
    <div className="fr-workbench-home">
      <section className="fr-hero">
        <div className="fr-eyebrow">
          <span className="fr-eyebrow-line" /> ZERO-AI ALL-IN-ONE SITE &amp; CODE AUDITOR
        </div>

        <FresnelLogo layout="horizontal" lore={config?.lore ?? null} showLoreTrigger />

        <h1 className="fr-title">
          Focus scattered web defects into <span>atomic fixes.</span>
        </h1>
        <p className="fr-intro">
          Fresnel runs deterministic AST transforms, Core Web Vitals checks, accessibility
          remediation, and git patch generation — without requiring external AI keys.
        </p>

        <div className="fr-actions">
          <button
            type="button"
            id="fresnel-demo-mode-btn"
            className="fr-btn-primary"
            disabled={startAuditMutation.isPending}
            aria-describedby="demo-mode-tip"
            onClick={() => void launchAudit('demo')}
          >
            {startAuditMutation.isPending ? 'Launching Audit...' : 'Try Demo Mode →'}
          </button>
          <SrTooltip
            tooltipId="demo-mode-tip"
            text="Runs an instant deterministic static code and Lighthouse impact audit on the Fresnel sandbox web app repository."
          />

          <Link to="/dashboard" className="fr-btn-secondary">
            {session
              ? `${session.workspace.name} Workspace & AST Scanner`
              : 'Workspace & AST Scanner'}
          </Link>

          {!session && (
            <Link to="/register" className="fr-btn-secondary">
              Create Workspace
            </Link>
          )}
        </div>
      </section>

      <section className="fr-card fr-intake-card" aria-labelledby="fr-intake-heading">
        <div>
          <h2 id="fr-intake-heading" className="fr-section-title">
            Start a Repository Code &amp; Quality Audit
          </h2>
          <p className="fr-muted">
            Provide a public GitHub repository URL and branch to inspect HTML, CSS, JavaScript, and
            TypeScript AST candidates.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="fr-intake-form">
          <div className="fr-intake-grid">
            <label className="fr-field">
              <span className="fr-label">GitHub Repository URL</span>
              <input
                type="url"
                className="fr-input"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                required
              />
            </label>

            <label className="fr-field">
              <span className="fr-label">Target Branch</span>
              <input
                type="text"
                className="fr-input"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
              />
            </label>
          </div>

          <div className="fr-field">
            <span className="fr-label">Audit Categories</span>
            <div className="fr-category-pills" role="group" aria-label="Audit categories">
              {AUDIT_CATEGORIES.map((cat) => {
                const active = selectedCategories.includes(cat.id)
                return (
                  <label
                    key={cat.id}
                    className={`fr-category-pill${active ? ' is-selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleCategory(cat.id)}
                    />
                    <span>{cat.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {formError && (
            <p className="fr-error" role="alert">
              {formError}
            </p>
          )}

          <div className="fr-actions">
            <button
              type="submit"
              id="fresnel-start-audit-btn"
              className="fr-btn-primary"
              disabled={startAuditMutation.isPending}
            >
              {startAuditMutation.isPending ? 'Starting Audit...' : 'Run Static Repository Audit'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
