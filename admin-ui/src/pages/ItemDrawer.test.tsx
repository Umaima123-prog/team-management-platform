import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ItemDrawer } from './ItemDrawer'
import { AuthProvider } from '../context/AuthContext'
import { ToastProvider } from '../context/ToastContext'
import { installMockFetch, errorBody, authSessionRoutes } from '../test/mockApi'
import type { WorkItem } from '../api/types'
import { ALICE, ALICE_AUTH, ALL_USERS, BOB_AUTH, ITEM_A, TEAM_WITH_MEMBERS, DAVE } from '../test/fixtures'

function renderDrawer(item: WorkItem = ITEM_A, onUpdated = () => {}) {
  return render(
    <AuthProvider>
      <ToastProvider>
        <ItemDrawer
          item={item}
          teamMembers={TEAM_WITH_MEMBERS.members}
          users={ALL_USERS}
          onClose={() => {}}
          onUpdated={onUpdated}
        />
      </ToastProvider>
    </AuthProvider>,
  )
}

describe('ItemDrawer', () => {
  it('only offers the project team\'s members as assignee choices - not every workspace user', async () => {
    installMockFetch([
      ...authSessionRoutes(ALICE_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
    ])
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
      ...authSessionRoutes(ALICE_AUTH),
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
      ...authSessionRoutes(ALICE_AUTH),
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

  it('shows the assignee read-only for an EMPLOYEE - reassigning is ADMIN-only', async () => {
    installMockFetch([
      ...authSessionRoutes(BOB_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
    ])
    renderDrawer()

    await screen.findByLabelText('Title')
    expect(screen.queryByRole('combobox', { name: 'Assignee' })).not.toBeInTheDocument()
    expect(screen.getByText('Assignee')).toBeInTheDocument()
    expect(screen.getByText('Carol Member')).toBeInTheDocument()
  })

  describe('update/move ownership (server-enforced; mirrored in the UI)', () => {
    it('1. EMPLOYEE sees enabled update controls for a work item assigned to them', async () => {
      const ownItem = { ...ITEM_A, assigneeId: BOB_AUTH.id }
      installMockFetch([
        ...authSessionRoutes(BOB_AUTH),
        { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      ])
      renderDrawer(ownItem)

      expect(await screen.findByLabelText('Title')).toBeEnabled()
      expect(screen.getByLabelText('Description')).toBeEnabled()
      expect(screen.getByLabelText('Type')).toBeEnabled()
      expect(screen.getByLabelText('Priority')).toBeEnabled()
      expect(screen.getByLabelText('Labels')).toBeEnabled()
      expect(screen.getByLabelText('Due date')).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(screen.queryByText(/assigned to someone else/i)).not.toBeInTheDocument()
    })

    it("2. EMPLOYEE sees disabled update controls for another employee's assigned work item, and cannot save", async () => {
      // ITEM_A is assigned to Carol, not Bob.
      installMockFetch([
        ...authSessionRoutes(BOB_AUTH),
        { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      ])
      renderDrawer(ITEM_A)

      expect(await screen.findByLabelText('Title')).toBeDisabled()
      expect(screen.getByLabelText('Description')).toBeDisabled()
      expect(screen.getByLabelText('Type')).toBeDisabled()
      expect(screen.getByLabelText('Priority')).toBeDisabled()
      expect(screen.getByLabelText('Labels')).toBeDisabled()
      expect(screen.getByLabelText('Due date')).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByText(/assigned to someone else/i)).toBeInTheDocument()
    })

    it('3. ADMIN sees enabled update controls regardless of who the item is assigned to', async () => {
      // ITEM_A is assigned to Carol, not Alice - must not matter for ADMIN.
      installMockFetch([
        ...authSessionRoutes(ALICE_AUTH),
        { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      ])
      renderDrawer(ITEM_A)

      expect(await screen.findByLabelText('Title')).toBeEnabled()
      expect(screen.getByLabelText('Priority')).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(screen.queryByText(/assigned to someone else/i)).not.toBeInTheDocument()
    })
  })
})
