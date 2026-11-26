import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { useLoginWorkspace } from '@/api/auth/auth.hooks'
import { useAuth } from '@/providers/auth-provider'

export const Route = createFileRoute('/sign-in')({ component: SignInPage })

function SignInPage() {
  const login = useLoginWorkspace()
  const { setSession } = useAuth()
  const navigate = useNavigate()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    login.mutate(
      {
        email: String(form.get('email')).trim(),
        password: String(form.get('password')),
      },
      {
        onSuccess: (response) => {
          setSession(response)
          void navigate({ to: '/dashboard' })
        },
      },
    )
  }

  return (
    <section className="fr-auth-layout">
      <form className="fr-card" onSubmit={handleSubmit}>
        <h2>Sign in to Fresnel</h2>
        <p className="fr-muted">Use your workspace administrator credentials.</p>

        <label className="fr-label" htmlFor="email">Work email</label>
        <input className="fr-input" id="email" name="email" type="email" autoComplete="email" required />

        <label className="fr-label" htmlFor="password">Password</label>
        <input className="fr-input" id="password" name="password" type="password" autoComplete="current-password" minLength={8} required />

        {login.isError && <p className="fr-error" role="alert">{login.error.message}</p>}

        <button className="fr-btn-primary" type="submit" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in →'}
        </button>
        <p className="fr-muted">
          New to Fresnel? <Link to="/register">Create a workspace</Link>
        </p>
      </form>
    </section>
  )
}
