import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import { apiRequest } from '../api/client'
import { installMockFetch, errorBody, authSessionRoutes } from '../test/mockApi'
import { ALICE_AUTH } from '../test/fixtures'

/** A minimal consumer that exposes AuthContext state/actions through
 * the DOM, so these tests can drive real user-facing behavior (text,
 * buttons) rather than reaching into the hook's internals. */
function Probe({ onCallProtected }: { onCallProtected?: () => void } = {}): React.ReactElement {
  const { user, status, login, loginError, logout } = useAuth()
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="user">{user ? `${user.name} (${user.role})` : 'none'}</div>
      {loginError && <div role="alert">{loginError}</div>}
      <button onClick={() => void login('alice@example.test', 'AdminDemo#2026')}>Login</button>
      <button onClick={() => void logout()}>Logout</button>
      {onCallProtected && <button onClick={onCallProtected}>Call protected</button>}
    </div>
  )
}

describe('AuthContext', () => {
  it('restores a session on mount via a silent refresh, without any user action', async () => {
    installMockFetch([...authSessionRoutes(ALICE_AUTH)])

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    expect(screen.getByTestId('status')).toHaveTextContent('checking')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'))
    expect(screen.getByTestId('user')).toHaveTextContent('Alice Owner (ADMIN)')
  })

  it('ends up signed-out, with no error shown, when there is no valid session to restore', async () => {
    installMockFetch([
      {
        method: 'POST',
        path: '/api/auth/refresh',
        handler: () => ({ status: 401, body: errorBody('UNAUTHENTICATED', 'No refresh token provided.') }),
      },
    ])

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('login failure surfaces a clear error and leaves the session signed-out', async () => {
    installMockFetch([
      {
        method: 'POST',
        path: '/api/auth/refresh',
        handler: () => ({ status: 401, body: errorBody('UNAUTHENTICATED', 'No refresh token provided.') }),
      },
      {
        method: 'POST',
        path: '/api/auth/login',
        handler: () => ({ status: 401, body: errorBody('UNAUTHENTICATED', 'Invalid email or password.') }),
      },
    ])

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'))

    await userEvent.click(screen.getByRole('button', { name: 'Login' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid email or password/i))
    expect(screen.getByTestId('status')).toHaveTextContent('signed-out')
  })

  it('logout clears the session even though the server call is fire-and-forget from the UI\'s perspective', async () => {
    installMockFetch([...authSessionRoutes(ALICE_AUTH)])

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'))

    await userEvent.click(screen.getByRole('button', { name: 'Logout' }))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
  })

  it('transparently refreshes and retries once after a 401, instead of surfacing it to the caller', async () => {
    let protectedCallCount = 0
    installMockFetch([
      ...authSessionRoutes(ALICE_AUTH),
      {
        path: '/api/protected-thing',
        handler: () => {
          protectedCallCount += 1
          // First call (stale/expired access token): rejected. After
          // the silent refresh-and-retry, the second call succeeds.
          if (protectedCallCount === 1) {
            return { status: 401, body: errorBody('UNAUTHENTICATED', 'Access token expired.') }
          }
          return { body: { ok: true } }
        },
      },
    ])

    let result: unknown = null
    render(
      <AuthProvider>
        <Probe onCallProtected={() => void apiRequest('/api/protected-thing').then((r) => (result = r))} />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'))

    await userEvent.click(screen.getByRole('button', { name: 'Call protected' }))

    await waitFor(() => expect(result).toEqual({ ok: true }))
    expect(protectedCallCount).toBe(2)
    // Still signed in as the same user - the 401 was handled silently.
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in')
  })
})
