import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { fetchWorkspaceMe, refreshWorkspaceSession } from '@/api/auth/auth'
import type { WorkspaceAuthResponse } from '@/api/$types/auth/response'

export const AUTH_SESSION_KEY = 'fresnel.auth-session'

interface AuthContextValue {
  session: WorkspaceAuthResponse | null
  accessToken: string
  isVerifying: boolean
  setSession: (next: WorkspaceAuthResponse) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredSession(): WorkspaceAuthResponse | null {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return null
  }
  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY)
    return raw ? (JSON.parse(raw) as WorkspaceAuthResponse) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<WorkspaceAuthResponse | null>(readStoredSession)
  const [isVerifying, setIsVerifying] = useState<boolean>(() => Boolean(readStoredSession()?.access_token))

  const setSession = useCallback((next: WorkspaceAuthResponse) => {
    if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
      window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(next))
    }
    setSessionState(next)
  }, [])

  const signOut = useCallback(() => {
    if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
      window.sessionStorage.removeItem(AUTH_SESSION_KEY)
    }
    setSessionState(null)
  }, [])

  useEffect(() => {
    const stored = readStoredSession()
    if (!stored?.access_token) {
      setIsVerifying(false)
      return
    }

    let cancelled = false
    setIsVerifying(true)

    void (async () => {
      try {
        const me = await fetchWorkspaceMe(stored.access_token)
        if (cancelled) return
        const verified: WorkspaceAuthResponse = {
          ...stored,
          workspace: me.workspace,
          administrator: me.administrator,
          widget: me.widget,
        }
        setSession(verified)
      } catch {
        if (cancelled) return
        if (!stored.refresh_token) {
          signOut()
          return
        }
        try {
          const refreshed = await refreshWorkspaceSession(stored.refresh_token)
          if (!cancelled) {
            setSession(refreshed)
          }
        } catch {
          if (!cancelled) {
            signOut()
          }
        }
      } finally {
        if (!cancelled) {
          setIsVerifying(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [setSession, signOut])

  return (
    <AuthContext.Provider
      value={{
        session,
        accessToken: session?.access_token ?? '',
        isVerifying,
        setSession,
        signOut,
      }}
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
