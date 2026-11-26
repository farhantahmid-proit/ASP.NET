import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { WorkspaceAuthResponse } from '@/api/$types/auth/response'

const AUTH_SESSION_KEY = 'fresnel.auth-session'

interface AuthContextValue {
  session: WorkspaceAuthResponse | null
  accessToken: string
  setSession: (next: WorkspaceAuthResponse) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredSession(): WorkspaceAuthResponse | null {
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY)
    return raw ? (JSON.parse(raw) as WorkspaceAuthResponse) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<WorkspaceAuthResponse | null>(readStoredSession)

  const setSession = useCallback((next: WorkspaceAuthResponse) => {
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(next))
    setSessionState(next)
  }, [])

  const signOut = useCallback(() => {
    sessionStorage.removeItem(AUTH_SESSION_KEY)
    setSessionState(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ session, accessToken: session?.access_token ?? '', setSession, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
