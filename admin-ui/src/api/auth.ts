import { apiRequest, authRequest } from './client'
import type { AuthUser } from './types'

export interface LoginResult {
  accessToken: string
  user: AuthUser
}

/** credentials: 'include' so the server's Set-Cookie (the HttpOnly
 * refresh token) is actually stored by the browser - see
 * docs/DECISIONS.md for why this cookie is scoped to /api/auth and
 * SameSite=None;Secure in production. */
export function login(email: string, password: string): Promise<LoginResult> {
  return authRequest<LoginResult>('/api/auth/login', { method: 'POST', body: { email, password } })
}

/** Reads the refresh cookie the browser already holds - no body, no
 * explicit token ever touches JS here. */
export function refresh(): Promise<LoginResult> {
  return authRequest<LoginResult>('/api/auth/refresh', { method: 'POST' })
}

export function logout(): Promise<void> {
  return authRequest<void>('/api/auth/logout', { method: 'POST' })
}

export function me(): Promise<AuthUser> {
  return apiRequest<AuthUser>('/api/auth/me')
}
