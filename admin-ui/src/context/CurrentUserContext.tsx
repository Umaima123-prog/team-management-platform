import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { listUsers } from '../api/endpoints'
import { ApiError } from '../api/client'
import type { User } from '../api/types'

const STORAGE_KEY = 'admin-ui.currentUserId'

export type AuthStatus = 'checking' | 'signed-out' | 'signed-in'

/**
 * Stands in for real authentication (there is none - see
 * docs/ARCHITECTURE.md "Request context / trust model"): the UI lets
 * the operator sign in as any user id they already know (e.g. from
 * `npm run seed`'s output), then switch between every user in that
 * same workspace once signed in. This is NOT a login system and must
 * never be presented as one - it is explicitly a dev tool affordance.
 *
 * There is no anonymous way to list users (the API has none - every
 * route but the health checks requires a valid X-Dev-User-Id, and
 * this UI must never weaken that by adding one) - so the very first
 * sign-in genuinely requires knowing one real user id already. This
 * is a deliberate, honest limitation, not a bug - see SignInGate.
 *
 * `status` is deliberately a three-state machine, not a boolean: a
 * stored id from a previous visit is only a *candidate* until
 * `GET /api/users` actually confirms it (`checking`) - SignInGate
 * must never render protected content just because *some* id is
 * sitting in localStorage, only once it's verified (`signed-in`).
 */
interface CurrentUserContextValue {
  users: User[]
  currentUser: User | null
  currentUserId: string | null
  status: AuthStatus
  signIn: (userId: string) => Promise<void>
  signInError: string | null
  signingIn: boolean
  setCurrentUserId: (userId: string) => void
  signOut: () => void
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null)

export function CurrentUserProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [users, setUsers] = useState<User[]>([])
  const [currentUserId, setCurrentUserIdState] = useState<string | null>(null)
  const [status, setStatus] = useState<AuthStatus>(() =>
    window.localStorage.getItem(STORAGE_KEY) ? 'checking' : 'signed-out',
  )
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)

  const signIn = useCallback(async (userId: string) => {
    const trimmed = userId.trim()
    if (!trimmed) {
      setSignInError('Enter a user id.')
      return
    }
    setSigningIn(true)
    setSignInError(null)
    try {
      const page = await listUsers({ userId: trimmed })
      setUsers(page.items)
      setCurrentUserIdState(trimmed)
      window.localStorage.setItem(STORAGE_KEY, trimmed)
      setStatus('signed-in')
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 400)) {
        setSignInError('That user id was not recognized. Check it and try again.')
      } else if (err instanceof ApiError) {
        setSignInError(err.message)
      } else {
        setSignInError('Could not reach the server.')
      }
      window.localStorage.removeItem(STORAGE_KEY)
      setCurrentUserIdState(null)
      setStatus('signed-out')
    } finally {
      setSigningIn(false)
    }
  }, [])

  const setCurrentUserId = useCallback((userId: string) => {
    setCurrentUserIdState(userId)
    window.localStorage.setItem(STORAGE_KEY, userId)
  }, [])

  const signOut = useCallback(() => {
    setCurrentUserIdState(null)
    setUsers([])
    setStatus('signed-out')
    window.localStorage.removeItem(STORAGE_KEY)
  }, [])

  // On first load, a previously-stored user id is only a candidate -
  // `status` stays "checking" (SignInGate shows a spinner, never
  // protected content) until this actually confirms it.
  const rehydrated = useRef(false)
  useEffect(() => {
    if (rehydrated.current) return
    rehydrated.current = true
    const storedId = window.localStorage.getItem(STORAGE_KEY)
    if (storedId) void signIn(storedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  }, [])

  const currentUser = useMemo(
    () => users.find((u) => u.id === currentUserId) ?? null,
    [users, currentUserId],
  )

  const value = useMemo(
    () => ({
      users,
      currentUser,
      currentUserId,
      status,
      signIn,
      signInError,
      signingIn,
      setCurrentUserId,
      signOut,
    }),
    [users, currentUser, currentUserId, status, signIn, signInError, signingIn, setCurrentUserId, signOut],
  )

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser(): CurrentUserContextValue {
  const ctx = useContext(CurrentUserContext)
  if (!ctx) throw new Error('useCurrentUser must be used within CurrentUserProvider')
  return ctx
}
