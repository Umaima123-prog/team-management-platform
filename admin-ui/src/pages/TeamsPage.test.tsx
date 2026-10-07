import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { TeamsPage } from './TeamsPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { installMockFetch, errorBody } from '../test/mockApi'
import { ALICE, ALL_USERS, TEAM } from '../test/fixtures'

beforeEach(() => {
  window.localStorage.setItem('admin-ui.currentUserId', ALICE.id)
})

describe('TeamsPage', () => {
  it('lists existing teams and creates a new one through the real API shape', async () => {
    let createdBody: unknown = null
    installMockFetch([
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

    await userEvent.type(screen.getByLabelText('Code'), 'QA')
    await userEvent.type(screen.getByLabelText('Name'), 'Quality')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(createdBody).toEqual({ code: 'QA', name: 'Quality' }))
  })

  it('shows the server validation error clearly, not a raw exception', async () => {
    installMockFetch([
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

    await userEvent.type(screen.getByLabelText('Code'), 'WAYTOOLONGCODE')
    await userEvent.type(screen.getByLabelText('Name'), 'Oops')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText(/Validation failed\./)).toBeInTheDocument()
    expect(screen.getByText(/code must be shorter/)).toBeInTheDocument()
  })
})
