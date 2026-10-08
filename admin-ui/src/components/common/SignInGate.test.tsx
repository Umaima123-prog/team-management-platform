import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SignInGate } from './SignInGate'
import { renderWithProviders } from '../../test/renderWithProviders'
import { installMockFetch, errorBody } from '../../test/mockApi'
import { ALICE_AUTH } from '../../test/fixtures'

describe('SignInGate', () => {
  it('never flashes protected content while a restored session is still being confirmed', async () => {
    installMockFetch([
      {
        method: 'POST',
        path: '/api/auth/refresh',
        handler: () => ({ status: 401, body: errorBody('UNAUTHENTICATED', 'No refresh token provided.') }),
      },
    ])

    renderWithProviders(
      <SignInGate>
        <div>Protected content</div>
      </SignInGate>,
    )

    // Must never appear, not even transiently, before the silent
    // refresh attempt resolves.
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('signs in with email/password and reveals the app', async () => {
    installMockFetch([
      {
        method: 'POST',
        path: '/api/auth/refresh',
        handler: () => ({ status: 401, body: errorBody('UNAUTHENTICATED', 'No refresh token provided.') }),
      },
      {
        method: 'POST',
        path: '/api/auth/login',
        handler: () => ({ body: { accessToken: 'test-access-token', user: ALICE_AUTH } }),
      },
    ])

    renderWithProviders(
      <SignInGate>
        <div>Protected content</div>
      </SignInGate>,
    )

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    await screen.findByLabelText('Email')

    await userEvent.type(screen.getByLabelText('Email'), ALICE_AUTH.email)
    await userEvent.type(screen.getByLabelText('Password'), 'AdminDemo#2026')
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Protected content')).toBeInTheDocument()
  })

  it('shows a clear error, not a raw exception, for an invalid login', async () => {
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

    renderWithProviders(
      <SignInGate>
        <div>Protected content</div>
      </SignInGate>,
    )

    await screen.findByLabelText('Email')
    await userEvent.type(screen.getByLabelText('Email'), 'nobody@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid email or password/i))
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })
})
