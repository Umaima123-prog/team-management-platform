import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { login as loginRequest, logout as logoutRequest, refresh as refreshRequest } from '../api/auth'
import { setAccessToken, setUnauthorizedHandler, ApiError } from '../api/client'
import type { AuthUser } from '../api/types'

export type AuthStatus = 'checking' | 'signed-out' | 'signed-in'

/**
 * Real authenticated session state - replaces the old dev-only
 * "enter any known user id" affordance (see docs/ARCHITECTURE.md
 * "Request context / trust model"). The access token itself never
 * lives here - it's held in-memory by api/client.ts; this context
 * only tracks the signed-in user's public profile and drives the
 * login/logout/silent-refresh lifecycle.
 *
 * `status` is a three-state machine, not a boolean: on first mount
 * there may be a valid HttpOnly refresh cookie from a previous visit,
 * but it is only a *candidate* session (`checking`) until the silent
 * `/api/auth/refresh` call actually confirms it - SignInGate must
 * never render protected content before that resolves.
 */
interface AuthContextValue {
  user: AuthUser | null
  status: AuthStatus
  login: (email: string, password: string) => Promise<void>
  loginError: string | null
  loggingIn: boolean
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  const login = useCallback(async (email: string, password: string) => {
    setLoggingIn(true)
    setLoginError(null)
    try {
      const result = await loginRequest(email, password)
      setAccessToken(result.accessToken)
      setUser(result.user)
      setStatus('signed-in')
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        setLoginError('Invalid email or password.')
      } else if (err instanceof ApiError) {
        setLoginError(err.message)
      } else {
        setLoginError('Could not reach the server.')
      }
      setAccessToken(null)
      setUser(null)
      setStatus('signed-out')
    } finally {
      setLoggingIn(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } catch {
      // Logout always succeeds from the UI's point of view - the
      // server clears/invalidates the session best-effort even if
      // this call fails (e.g. already-expired token).
    }
    setAccessToken(null)
    setUser(null)
    setStatus('signed-out')
  }, [])

  // Attempts one silent refresh using the HttpOnly cookie - called
  // both on startup (to restore a session across a reload) and by
  // client.ts whenever an API call comes back 401.
  const silentRefresh = useCallback(async (): Promise<string | null> => {
    try {
      const result = await refreshRequest()
      setAccessToken(result.accessToken)
      setUser(result.user)
      setStatus('signed-in')
      return result.accessToken
    } catch {
      setAccessToken(null)
      setUser(null)
      setStatus('signed-out')
      return null
    }
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(silentRefresh)
    return () => setUnauthorizedHandler(null)
  }, [silentRefresh])

  const attempted = useRef(false)
  useEffect(() => {
    if (attempted.current) return
    attempted.current = true
    void silentRefresh()
  }, [silentRefresh])

  const value = useMemo(
    () => ({ user, status, login, loginError, loggingIn, logout }),
    [user, status, login, loginError, loggingIn, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
