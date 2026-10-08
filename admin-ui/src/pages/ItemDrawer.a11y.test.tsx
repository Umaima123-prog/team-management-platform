import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ItemDrawer } from './ItemDrawer'
import { AuthProvider } from '../context/AuthContext'
import { ToastProvider } from '../context/ToastContext'
import { installMockFetch, authSessionRoutes } from '../test/mockApi'
import { ALICE_AUTH, ALL_USERS, ITEM_A, TEAM_WITH_MEMBERS } from '../test/fixtures'

describe('ItemDrawer accessibility', () => {
  it('is an aria-modal dialog, moves focus to it on open, and closes on Escape', async () => {
    installMockFetch([
      ...authSessionRoutes(ALICE_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
    ])
    const onClose = vi.fn()

    render(
      <AuthProvider>
        <ToastProvider>
          <ItemDrawer
            item={ITEM_A}
            teamMembers={TEAM_WITH_MEMBERS.members}
            users={ALL_USERS}
            onClose={onClose}
            onUpdated={() => {}}
          />
        </ToastProvider>
      </AuthProvider>,
    )

    await screen.findByRole('dialog', { name: 'ENG1-1' })

    const dialog = screen.getByRole('dialog', { name: 'ENG1-1' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Close item details' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('associates every field with a visible, programmatic label (not placeholder-only)', async () => {
    installMockFetch([
      ...authSessionRoutes(ALICE_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
    ])

    render(
      <AuthProvider>
        <ToastProvider>
          <ItemDrawer
            item={ITEM_A}
            teamMembers={TEAM_WITH_MEMBERS.members}
            users={ALL_USERS}
            onClose={() => {}}
            onUpdated={() => {}}
          />
        </ToastProvider>
      </AuthProvider>,
    )

    for (const name of ['Title', 'Description', 'Type', 'Priority', 'Assignee', 'Labels', 'Due date']) {
      expect(await screen.findByLabelText(name)).toBeInTheDocument()
    }
  })
})
