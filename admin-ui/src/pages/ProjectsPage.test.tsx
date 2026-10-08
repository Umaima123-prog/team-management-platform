import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ProjectsPage } from './ProjectsPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { installMockFetch, authSessionRoutes } from '../test/mockApi'
import { ALICE, ALICE_AUTH, ALL_USERS, BOB_AUTH, PROJECT, TEAM } from '../test/fixtures'

describe('ProjectsPage', () => {
  it('lists existing projects with status, and creates a new one choosing the owning team', async () => {
    let createdBody: unknown = null
    installMockFetch([
      ...authSessionRoutes(ALICE_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      { path: '/api/teams', handler: () => ({ body: { items: [TEAM] } }) },
      { path: '/api/projects', handler: () => ({ body: { items: [PROJECT] } }) },
      {
        method: 'POST',
        path: '/api/projects',
        handler: ({ body }) => {
          createdBody = body
          return { status: 201, body: { id: 'proj-2', workspaceId: 'ws-1', version: 1, status: 'ACTIVE', ...(body as object) } }
        },
      },
    ])

    renderWithProviders(<ProjectsPage />)

    expect(await screen.findByText('Engine Overhaul')).toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()

    await userEvent.type(await screen.findByLabelText('Key'), 'NEW')
    await userEvent.type(screen.getByLabelText('Name'), 'New Project')
    await userEvent.selectOptions(screen.getByLabelText('Owning team'), TEAM.id)
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(createdBody).toEqual({ projectKey: 'NEW', name: 'New Project', teamId: TEAM.id, ownerId: ALICE.id }),
    )
  })

  it('hides the "Create a project" form for an EMPLOYEE - creating projects is ADMIN-only', async () => {
    installMockFetch([
      ...authSessionRoutes(BOB_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      { path: '/api/teams', handler: () => ({ body: { items: [TEAM] } }) },
      { path: '/api/projects', handler: () => ({ body: { items: [PROJECT] } }) },
    ])

    renderWithProviders(<ProjectsPage />)

    expect(await screen.findByText('Engine Overhaul')).toBeInTheDocument()
    expect(screen.queryByText('Create a project')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Key')).not.toBeInTheDocument()
  })
})
