import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ItemDrawer } from './ItemDrawer'
import { CurrentUserProvider } from '../context/CurrentUserContext'
import { ToastProvider } from '../context/ToastContext'
import { installMockFetch } from '../test/mockApi'
import { ALICE, ALL_USERS, ITEM_A, TEAM_WITH_MEMBERS } from '../test/fixtures'

describe('ItemDrawer accessibility', () => {
  it('is an aria-modal dialog, moves focus to it on open, and closes on Escape', async () => {
    window.localStorage.setItem('admin-ui.currentUserId', ALICE.id)
    installMockFetch([{ path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) }])
    const onClose = vi.fn()

    render(
      <CurrentUserProvider>
        <ToastProvider>
          <ItemDrawer
            item={ITEM_A}
            teamMembers={TEAM_WITH_MEMBERS.members}
            users={ALL_USERS}
            onClose={onClose}
            onUpdated={() => {}}
          />
        </ToastProvider>
      </CurrentUserProvider>,
    )

    const dialog = screen.getByRole('dialog', { name: 'ENG1-1' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Close item details' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('associates every field with a visible, programmatic label (not placeholder-only)', async () => {
    window.localStorage.setItem('admin-ui.currentUserId', ALICE.id)
    installMockFetch([{ path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) }])

    render(
      <CurrentUserProvider>
        <ToastProvider>
          <ItemDrawer
            item={ITEM_A}
            teamMembers={TEAM_WITH_MEMBERS.members}
            users={ALL_USERS}
            onClose={() => {}}
            onUpdated={() => {}}
          />
        </ToastProvider>
      </CurrentUserProvider>,
    )

    for (const name of ['Title', 'Description', 'Type', 'Priority', 'Assignee', 'Labels', 'Due date']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument()
    }
  })
})
