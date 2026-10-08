import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TeamsPage } from './TeamsPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { installMockFetch, errorBody, authSessionRoutes } from '../test/mockApi'
import { ALICE_AUTH, ALL_USERS, BOB_AUTH, TEAM } from '../test/fixtures'

describe('TeamsPage', () => {
  it('lists existing teams and creates a new one through the real API shape', async () => {
    let createdBody: unknown = null
    installMockFetch([
      ...authSessionRoutes(ALICE_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      {
        path: '/api/teams',
        handler: ({ url }) => {
          if (url.searchParams.has('includeArchived')) return { body: { items: [TEAM] } }
          return { body: { items: [TEAM] } }
        },
      },
      {
        method: 'POST',
        path: '/api/teams',
        handler: ({ body }) => {
          createdBody = body
          return {
            status: 201,
            body: { id: 'team-2', workspaceId: 'ws-1', version: 1, ...(body as object) },
          }
        },
      },
    ])

    renderWithProviders(<TeamsPage />)

    expect(await screen.findByText('Engineering')).toBeInTheDocument()

    await userEvent.type(await screen.findByLabelText('Code'), 'QA')
    await userEvent.type(screen.getByLabelText('Name'), 'Quality')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(createdBody).toEqual({ code: 'QA', name: 'Quality' }))
  })

  it('shows the server validation error clearly, not a raw exception', async () => {
    installMockFetch([
      ...authSessionRoutes(ALICE_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      { path: '/api/teams', handler: () => ({ body: { items: [] } }) },
      {
        method: 'POST',
        path: '/api/teams',
        handler: () => ({
          status: 400,
          body: errorBody('VALIDATION_ERROR', 'Validation failed.', ['code must be shorter than or equal to 10 characters']),
        }),
      },
    ])

    renderWithProviders(<TeamsPage />)
    await screen.findByText('No teams yet.')

    await userEvent.type(await screen.findByLabelText('Code'), 'WAYTOOLONGCODE')
    await userEvent.type(screen.getByLabelText('Name'), 'Oops')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText(/Validation failed\./)).toBeInTheDocument()
    expect(screen.getByText(/code must be shorter/)).toBeInTheDocument()
  })

  it('hides the "Create a team" form for an EMPLOYEE - creating teams is ADMIN-only', async () => {
    installMockFetch([
      ...authSessionRoutes(BOB_AUTH),
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      { path: '/api/teams', handler: () => ({ body: { items: [TEAM] } }) },
    ])

    renderWithProviders(<TeamsPage />)

    expect(await screen.findByText('Engineering')).toBeInTheDocument()
    expect(screen.queryByText('Create a team')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
  })
})
