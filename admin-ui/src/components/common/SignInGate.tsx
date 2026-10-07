import { useState, type FormEvent, type ReactNode } from 'react'
import { useCurrentUser } from '../../context/CurrentUserContext'
import { LoadingSpinner } from './LoadingSpinner'

/**
 * Blocks the rest of the app until a known user id is entered AND
 * confirmed by the server - a stored-but-unverified id (`status ===
 * 'checking'`) must never flash protected content, since it might
 * turn out to be stale (see CurrentUserContext). There is no
 * anonymous "list users" route to bootstrap from (by design - see
 * docs/ARCHITECTURE.md) - the very first sign-in on a clean install
 * genuinely requires knowing one real seeded user id (printed by
 * `npm run seed` in services/management-service).
 */
export function SignInGate({ children }: { children: ReactNode }): ReactNode {
  const { status, signIn, signInError, signingIn } = useCurrentUser()
  const [input, setInput] = useState('')

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
    void signIn(input)
  }

  return (
    <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
      <div className="card shadow-sm" style={{ width: '24rem' }}>
        <div className="card-body">
          <h1 className="h4 mb-3">Team Management Platform</h1>
          <p className="text-muted small">
            This is a development tool with no real authentication (see{' '}
            <code>docs/ARCHITECTURE.md</code>, "Request context / trust model"). Enter a user id
            from <code>npm run seed</code>&rsquo;s output to continue.
          </p>
          <form onSubmit={handleSubmit}>
            <label htmlFor="userId" className="form-label">
              User id
            </label>
            <input
              id="userId"
              name="userId"
              className="form-control"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. 66f1a2b3c4d5e6f7a8b9c0d1"
              autoFocus
              aria-describedby={signInError ? 'sign-in-error' : undefined}
            />
            {signInError && (
              <div id="sign-in-error" className="text-danger small mt-2" role="alert">
                {signInError}
              </div>
            )}
            <button type="submit" className="btn btn-primary w-100 mt-3" disabled={signingIn}>
              {signingIn ? 'Signing in…' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
