import { useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../context/AuthContext'
import { LoadingSpinner } from './LoadingSpinner'

/**
 * Blocks the rest of the app until a real session exists - a
 * candidate session restored from the refresh cookie (`status ===
 * 'checking'`) must never flash protected content before the silent
 * refresh actually confirms it (see AuthContext). Below, a plain
 * email/password form; the backend is the only thing that ever
 * verifies a password - this component just collects it.
 */
export function SignInGate({ children }: { children: ReactNode }): ReactNode {
  const { status, login, loginError, loggingIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (status === 'checking') {
    return (
      <div className="d-flex align-items-center justify-content-center vh-100">
        <LoadingSpinner label="Signing in…" />
      </div>
    )
  }

  if (status === 'signed-in') return children

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    void login(email, password)
  }

  return (
    <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
      <div className="card shadow-sm" style={{ width: '24rem' }}>
        <div className="card-body">
          <h1 className="h4 mb-3">Team Management Platform</h1>
          <p className="text-muted small">Sign in with your email and password to continue.</p>
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label htmlFor="login-email" className="form-label">
                Email
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                className="form-control"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                autoComplete="username"
                required
                aria-describedby={loginError ? 'sign-in-error' : undefined}
              />
            </div>
            <div className="mb-3">
              <label htmlFor="login-password" className="form-label">
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                aria-describedby={loginError ? 'sign-in-error' : undefined}
              />
            </div>
            {loginError && (
              <div id="sign-in-error" className="text-danger small mb-2" role="alert">
                {loginError}
              </div>
            )}
            <button type="submit" className="btn btn-primary w-100" disabled={loggingIn}>
              {loggingIn ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
