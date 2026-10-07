import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TeamDetailPage } from './TeamDetailPage'
import { CurrentUserProvider } from '../context/CurrentUserContext'
import { ToastProvider } from '../context/ToastContext'
import { installMockFetch } from '../test/mockApi'
import { ALICE, ALL_USERS, TEAM_WITH_MEMBERS } from '../test/fixtures'

beforeEach(() => {
  window.localStorage.setItem('admin-ui.currentUserId', ALICE.id)
})

function renderTeamDetail() {
  return render(
    <CurrentUserProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/teams/${TEAM_WITH_MEMBERS.id}`]}>
          <Routes>
            <Route path="/teams/:teamId" element={<TeamDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </CurrentUserProvider>,
  )
}

describe('TeamDetailPage', () => {
  it('shows members with their roles, and only non-members as addable', async () => {
    installMockFetch([
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      { path: `/api/teams/${TEAM_WITH_MEMBERS.id}`, handler: () => ({ body: TEAM_WITH_MEMBERS }) },
    ])

    renderTeamDetail()

    expect(await screen.findByText('Alice Owner')).toBeInTheDocument()
    expect(screen.getByText('Carol Member')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /role for alice owner/i })).toHaveValue('OWNER')

    const addSelect = screen.getByLabelText('Add member') as HTMLSelectElement
    const optionLabels = Array.from(addSelect.options).map((o) => o.textContent)
    expect(optionLabels.some((label) => label?.includes('Bob Lead'))).toBe(true)
    expect(optionLabels.some((label) => label?.includes('Alice Owner'))).toBe(false) // already a member
  })

  it('updates a member role via PATCH and removes a member via DELETE', async () => {
    let patchedRole: unknown = null
    let removedUserId: string | null = null
    installMockFetch([
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

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /role for carol member/i }), 'LEAD')
    await waitFor(() => expect(patchedRole).toEqual({ role: 'LEAD' }))

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    await userEvent.click(removeButtons[1])
    await waitFor(() => expect(removedUserId).toBe('u-carol'))
  })
})
