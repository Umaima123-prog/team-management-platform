import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DashboardPage } from './DashboardPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { installMockFetch } from '../test/mockApi'
import { ALICE, BOARD, ITEM_A, ITEM_B, ITEM_C, PROJECT, TEAM } from '../test/fixtures'

beforeEach(() => {
  window.localStorage.setItem('admin-ui.currentUserId', ALICE.id)
})

describe('DashboardPage', () => {
  it('shows real team/project/open-item/overdue counts derived from the actual API responses', async () => {
    const overdueItem = { ...ITEM_C, id: 'item-overdue', dueDate: '2020-01-01T00:00:00.000Z' }
    installMockFetch([
      { path: '/api/users', handler: () => ({ body: { items: [ALICE] } }) },
      { path: '/api/teams', handler: () => ({ body: { items: [TEAM] } }) },
      { path: '/api/projects', handler: () => ({ body: { items: [PROJECT] } }) },
      { path: `/api/projects/${PROJECT.id}/board`, handler: () => ({ body: BOARD }) },
      {
        path: `/api/projects/${PROJECT.id}/items`,
        handler: () => ({ body: { items: [ITEM_A, ITEM_B, overdueItem], nextCursor: null } }),
      },
      {
        path: `/api/projects/${PROJECT.id}/insights`,
        handler: () => ({ body: { status: 'not_ready', reason: 'NO_DATA_YET_FOR_PROJECT' } }),
      },
    ])

    renderWithProviders(<DashboardPage />)

    expect(await screen.findByTestId('stat-Teams')).toHaveTextContent('1')
    expect(screen.getByTestId('stat-Active projects')).toHaveTextContent('1')
    // All 3 items are outside the "Done" column -> 3 open; 1 has a due date in the past -> 1 overdue.
    expect(screen.getByTestId('stat-Open work items')).toHaveTextContent('3')
    expect(screen.getByTestId('stat-Overdue items')).toHaveTextContent('1')
  })
})
