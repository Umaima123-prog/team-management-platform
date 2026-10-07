import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ItemDrawer } from './ItemDrawer'
import { CurrentUserProvider } from '../context/CurrentUserContext'
import { ToastProvider } from '../context/ToastContext'
import { installMockFetch, errorBody } from '../test/mockApi'
import { ALICE, ALL_USERS, ITEM_A, TEAM_WITH_MEMBERS, DAVE } from '../test/fixtures'

function renderDrawer(onUpdated = () => {}) {
  window.localStorage.setItem('admin-ui.currentUserId', ALICE.id)
  return render(
    <CurrentUserProvider>
      <ToastProvider>
        <ItemDrawer
          item={ITEM_A}
          teamMembers={TEAM_WITH_MEMBERS.members}
          users={ALL_USERS}
          onClose={() => {}}
          onUpdated={onUpdated}
        />
      </ToastProvider>
    </CurrentUserProvider>,
  )
}

describe('ItemDrawer', () => {
  it('only offers the project team\'s members as assignee choices - not every workspace user', async () => {
    installMockFetch([{ path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) }])
    renderDrawer()

    const select = (await screen.findByLabelText('Assignee')) as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)

    // TEAM_WITH_MEMBERS only has Alice and Carol - Dave (outside the
    // team) must never appear as a selectable option, regardless of
    // being a real workspace user.
    expect(optionValues).toContain(ALICE.id)
    expect(optionValues).toContain('u-carol')
    expect(optionValues).not.toContain(DAVE.id)
  })

  it('shows the server-side rejection clearly if an invalid assignee is somehow submitted', async () => {
    installMockFetch([
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      {
        method: 'POST',
        path: '/api/items/item-a/assign',
        handler: () => ({
          status: 400,
          body: errorBody('VALIDATION_ERROR', 'assigneeId must be an active member of this project\'s owning team.'),
        }),
      },
    ])
    renderDrawer()

    const select = (await screen.findByLabelText('Assignee')) as HTMLSelectElement
    // Simulate a stale/tampered option value the UI itself would never
    // normally offer, to prove the server's own check is still the
    // real backstop even if the UI's restriction were bypassed.
    const injected = document.createElement('option')
    injected.value = DAVE.id
    injected.textContent = 'Dave Outsider'
    select.appendChild(injected)

    await userEvent.selectOptions(select, DAVE.id)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/active member of this project/i)).toBeInTheDocument()
  })

  it('sends the assign request with expectedVersion when the assignee changes', async () => {
    let assignBody: unknown = null
    installMockFetch([
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      {
        method: 'POST',
        path: '/api/items/item-a/assign',
        handler: ({ body }) => {
          assignBody = body
          return { body: { ...ITEM_A, assigneeId: ALICE.id, version: 2 } }
        },
      },
    ])
    renderDrawer()

    const select = await screen.findByLabelText('Assignee')
    await userEvent.selectOptions(select, ALICE.id)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(assignBody).toEqual({ expectedVersion: 1, assigneeId: ALICE.id }),
    )
  })
})
