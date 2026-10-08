import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Topbar } from './Topbar'
import { AuthProvider } from '../../context/AuthContext'
import { installMockFetch, authSessionRoutes } from '../../test/mockApi'
import { ALICE_AUTH, BOB_AUTH } from '../../test/fixtures'

function renderTopbar() {
  return render(
    <AuthProvider>
      <Topbar onToggleSidebar={() => {}} sidebarOpen={false} />
    </AuthProvider>,
  )
}

describe('Topbar', () => {
  it('shows the signed-in ADMIN\'s name and role', async () => {
    installMockFetch([...authSessionRoutes(ALICE_AUTH)])
    renderTopbar()

    expect(await screen.findByText('Alice Owner')).toBeInTheDocument()
    expect(screen.getByText('ADMIN')).toBeInTheDocument()
  })

  it('shows the signed-in EMPLOYEE\'s name and role', async () => {
    installMockFetch([...authSessionRoutes(BOB_AUTH)])
    renderTopbar()

    expect(await screen.findByText('Bob Lead')).toBeInTheDocument()
    expect(screen.getByText('EMPLOYEE')).toBeInTheDocument()
  })

  it('signs the user out when "Sign out" is clicked', async () => {
    installMockFetch([...authSessionRoutes(ALICE_AUTH)])
    renderTopbar()

    await screen.findByText('Alice Owner')
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(screen.queryByText('Alice Owner')).not.toBeInTheDocument())
  })
})
