import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TeamDetailPage } from './TeamDetailPage'
import { AuthProvider } from '../context/AuthContext'
import { ToastProvider } from '../context/ToastContext'
import { installMockFetch, authSessionRoutes } from '../test/mockApi'
import { ALICE_AUTH, ALL_USERS, BOB_AUTH, TEAM_WITH_MEMBERS } from '../test/fixtures'

function renderTeamDetail() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/teams/${TEAM_WITH_MEMBERS.id}`]}>
          <Routes>
            <Route path="/teams/:teamId" element={<TeamDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </AuthProvider>,
  )
}

describe('TeamDetailPage', () => {
  it('shows members with their roles, and only non-members as addable', async () => {
    installMockFetch([
      ...authSessionRoutes(ALICE_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      { path: `/api/teams/${TEAM_WITH_MEMBERS.id}`, handler: () => ({ body: TEAM_WITH_MEMBERS }) },
    ])

    renderTeamDetail()

    expect(await screen.findByText('Alice Owner')).toBeInTheDocument()
    expect(screen.getByText('Carol Member')).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: /role for alice owner/i })).toHaveValue('OWNER')

    const addSelect = (await screen.findByLabelText('Add member')) as HTMLSelectElement
    const optionLabels = Array.from(addSelect.options).map((o) => o.textContent)
    expect(optionLabels.some((label) => label?.includes('Bob Lead'))).toBe(true)
    expect(optionLabels.some((label) => label?.includes('Alice Owner'))).toBe(false) // already a member
  })

  it('updates a member role via PATCH and removes a member via DELETE', async () => {
    let patchedRole: unknown = null
    let removedUserId: string | null = null
    installMockFetch([
      ...authSessionRoutes(ALICE_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      { path: `/api/teams/${TEAM_WITH_MEMBERS.id}`, handler: () => ({ body: TEAM_WITH_MEMBERS }) },
      {
        method: 'PATCH',
        path: `/api/teams/${TEAM_WITH_MEMBERS.id}/members/u-carol`,
        handler: ({ body }) => {
          patchedRole = body
          return { body: { ...TEAM_WITH_MEMBERS.members[1], role: 'LEAD' } }
        },
      },
      {
        method: 'DELETE',
        path: `/api/teams/${TEAM_WITH_MEMBERS.id}/members/u-carol`,
        handler: () => {
          removedUserId = 'u-carol'
          return { status: 204 }
        },
      },
    ])

    renderTeamDetail()
    await screen.findByText('Carol Member')

    const roleSelect = await screen.findByRole('combobox', { name: /role for carol member/i })
    await userEvent.selectOptions(roleSelect, 'LEAD')
    await waitFor(() => expect(patchedRole).toEqual({ role: 'LEAD' }))

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    await userEvent.click(removeButtons[1])
    await waitFor(() => expect(removedUserId).toBe('u-carol'))
  })

  it('shows members read-only for an EMPLOYEE, with no add/role-change/remove controls', async () => {
    installMockFetch([
      ...authSessionRoutes(BOB_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      { path: `/api/teams/${TEAM_WITH_MEMBERS.id}`, handler: () => ({ body: TEAM_WITH_MEMBERS }) },
    ])

    renderTeamDetail()

    expect(await screen.findByText('Alice Owner')).toBeInTheDocument()
    expect(screen.getByText('Carol Member')).toBeInTheDocument()
    expect(screen.getByText('OWNER')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /role for/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Add member')).not.toBeInTheDocument()
  })
})
