import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SignInGate } from './SignInGate'
import { renderWithProviders } from '../../test/renderWithProviders'
import { installMockFetch, errorBody } from '../../test/mockApi'
import { ALICE, ALL_USERS } from '../../test/fixtures'

describe('SignInGate', () => {
  it('never flashes protected content for a stored-but-unverified id - shows a checking state until the server confirms it', async () => {
    window.localStorage.setItem('admin-ui.currentUserId', 'stale-id')
    installMockFetch([
      {
        path: '/api/users',
        handler: () => ({ status: 401, body: errorBody('UNAUTHENTICATED', 'Unknown user.') }),
      },
    ])

    renderWithProviders(
      <SignInGate>
        <div>Protected content</div>
      </SignInGate>,
    )

    // Must never appear, not even transiently, before the stale id is rejected.
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByLabelText('User id')).toBeInTheDocument())
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })


  it('blocks the app until a valid user id is entered', async () => {
    installMockFetch([{ path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) }])

    renderWithProviders(
      <SignInGate>
        <div>Protected content</div>
      </SignInGate>,
    )

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    expect(screen.getByLabelText('User id')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('User id'), ALICE.id)
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Protected content')).toBeInTheDocument()
  })

  it('shows a clear error, not a raw exception, for an unrecognized user id', async () => {
    installMockFetch([
      {
        path: '/api/users',
        handler: () => ({ status: 401, body: errorBody('UNAUTHENTICATED', 'Unknown user.') }),
      },
    ])

    renderWithProviders(
      <SignInGate>
        <div>Protected content</div>
      </SignInGate>,
    )

    await userEvent.type(screen.getByLabelText('User id'), 'not-a-real-id')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not recognized/i))
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })
})
