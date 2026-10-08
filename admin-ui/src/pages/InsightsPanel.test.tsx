import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InsightsPanel } from './InsightsPanel'
import { renderWithProviders } from '../test/renderWithProviders'
import { installMockFetch, authSessionRoutes } from '../test/mockApi'
import { ALICE_AUTH, ALL_USERS, BOARD, PROJECT } from '../test/fixtures'

function usersAndBoardRoutes() {
  return [
    ...authSessionRoutes(ALICE_AUTH),
    { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
    { path: `/api/projects/${PROJECT.id}/board`, handler: () => ({ body: BOARD }) },
  ]
}

describe('InsightsPanel', () => {
  it('shows "Ready" with real non-zero workload data when status is ok', async () => {
    installMockFetch([
      ...usersAndBoardRoutes(),
      {
        path: `/api/projects/${PROJECT.id}/insights`,
        handler: () => ({
          body: {
            status: 'ok',
            data: {
              projectId: PROJECT.id,
              generatedAt: new Date().toISOString(),
              workloadByAssignee: [{ assigneeId: 'u-carol', count: 2 }],
              countsByStatus: [{ columnId: 'col-backlog', count: 2 }],
              lastProcessedSequence: 10,
            },
          },
        }),
      },
    ])

    renderWithProviders(<InsightsPanel projectId={PROJECT.id} />)

    expect(await screen.findByText('Ready')).toBeInTheDocument()
    const assigneeList = screen.getByText('Workload by assignee').closest('div')!
    expect(within(assigneeList).getByText('Carol Member')).toBeInTheDocument()
    expect(within(assigneeList).getByText('2')).toBeInTheDocument()
    const statusList = screen.getByText('Counts by column/status').closest('div')!
    expect(within(statusList).getByText('Backlog')).toBeInTheDocument() // resolved from columnId, not the raw id
  })

  it('shows a typed not_ready state and never fakes instant consistency', async () => {
    installMockFetch([
      ...usersAndBoardRoutes(),
      {
        path: `/api/projects/${PROJECT.id}/insights`,
        handler: () => ({ body: { status: 'not_ready', reason: 'NO_DATA_YET_FOR_PROJECT' } }),
      },
    ])

    renderWithProviders(<InsightsPanel projectId={PROJECT.id} />)

    expect(await screen.findByText(/Not ready yet/)).toBeInTheDocument()
    expect(screen.getByText(/asynchronous projection/i)).toBeInTheDocument()
  })

  it('shows a typed pending (timeout) state with a retry action', async () => {
    installMockFetch([
      ...usersAndBoardRoutes(),
      {
        path: `/api/projects/${PROJECT.id}/insights`,
        handler: () => ({ body: { status: 'pending', reason: 'TIMEOUT' } }),
      },
    ])

    renderWithProviders(<InsightsPanel projectId={PROJECT.id} />)

    expect(await screen.findByText(/Pending\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows a typed unavailable state, distinct from not_ready/pending', async () => {
    installMockFetch([
      ...usersAndBoardRoutes(),
      {
        path: `/api/projects/${PROJECT.id}/insights`,
        handler: () => ({ body: { status: 'unavailable', reason: 'NO_RESPONDER' } }),
      },
    ])

    renderWithProviders(<InsightsPanel projectId={PROJECT.id} />)

    expect(await screen.findByText(/Temporarily unavailable/)).toBeInTheDocument()
    expect(screen.getByText(/NO_RESPONDER/)).toBeInTheDocument()
  })
})
