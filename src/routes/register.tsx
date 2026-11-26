import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useRegisterWorkspace } from '@/api/auth/auth.hooks'
import type { WorkspaceRegistrationResponse } from '@/api/$types/auth/response'

export const Route = createFileRoute('/register')({ component: RegisterPage })

function RegisterPage() {
  const [result, setResult] = useState<WorkspaceRegistrationResponse | null>(null)
  const registration = useRegisterWorkspace()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    registration.mutate(
      {
        workspace: {
          name: String(form.get('workspaceName')).trim(),
          email: String(form.get('email')).trim(),
        },
        administrator: {
          name: String(form.get('administratorName')).trim(),
          password: String(form.get('password')),
        },
      },
      { onSuccess: setResult },
    )
  }

  if (result) {
    return (
      <section className="fr-auth-layout" aria-live="polite">
        <div className="fr-card">
          <h2>Workspace ready: {result.workspace.name}</h2>
          <p className="fr-muted">Administrator: {result.administrator.email}</p>
          <p className="fr-muted">Widget key: <code>{result.widget.public_key}</code></p>
          <Link to="/sign-in" className="fr-btn-primary">Continue to sign in →</Link>
        </div>
      </section>
    )
  }

  return (
    <section className="fr-auth-layout">
      <form className="fr-card" onSubmit={handleSubmit}>
        <h2>Create your Fresnel workspace</h2>
        <p className="fr-muted">Provision an admin account and an embeddable site-audit widget key.</p>

        <label className="fr-label" htmlFor="workspaceName">Workspace name</label>
        <input className="fr-input" id="workspaceName" name="workspaceName" required minLength={2} maxLength={120} />

        <label className="fr-label" htmlFor="administratorName">Administrator name</label>
        <input className="fr-input" id="administratorName" name="administratorName" required minLength={2} maxLength={120} />

        <label className="fr-label" htmlFor="email">Work email</label>
        <input className="fr-input" id="email" name="email" type="email" autoComplete="email" required />

        <label className="fr-label" htmlFor="password">Password</label>
        <input className="fr-input" id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />

        {registration.isError && <p className="fr-error" role="alert">{registration.error.message}</p>}

        <button className="fr-btn-primary" type="submit" disabled={registration.isPending}>
          {registration.isPending ? 'Creating workspace…' : 'Create workspace →'}
        </button>
        <p className="fr-muted">
          Already registered? <Link to="/sign-in">Sign in</Link>
        </p>
      </form>
    </section>
  )
}
