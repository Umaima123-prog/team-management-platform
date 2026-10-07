import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { BoardView } from './BoardView'
import { renderWithProviders } from '../../test/renderWithProviders'
import { installMockFetch, errorBody } from '../../test/mockApi'
import { ALICE, ALL_USERS, BOARD, ITEM_A, ITEM_B, ITEM_C, PROJECT, TEAM_WITH_MEMBERS } from '../../test/fixtures'

beforeEach(() => {
  window.localStorage.setItem('admin-ui.currentUserId', ALICE.id)
})

function baseRoutes(itemsOverride?: (typeof ITEM_A)[]) {
  return [
    { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
    { path: `/api/teams/${TEAM_WITH_MEMBERS.id}`, handler: () => ({ body: TEAM_WITH_MEMBERS }) },
    { path: `/api/projects/${PROJECT.id}/board`, handler: () => ({ body: BOARD }) },
    {
      path: `/api/projects/${PROJECT.id}/items`,
      handler: () => ({ body: { items: itemsOverride ?? [ITEM_A, ITEM_B, ITEM_C], nextCursor: null } }),
    },
  ]
}

describe('BoardView rendering', () => {
  it('renders columns in order with correct per-column items and counts', async () => {
    installMockFetch(baseRoutes())

    renderWithProviders(<BoardView project={PROJECT} />)

    const columns = await screen.findAllByRole('region', { name: /column/i })
    expect(columns.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Backlog column',
      'To Do column',
      'In Progress column',
      'Done column',
    ])

    const backlog = screen.getByTestId(`column-${BOARD.columns[0].id}`)
    expect(within(backlog).getByTestId('card-item-a')).toBeInTheDocument()
    expect(within(backlog).getByTestId('card-item-b')).toBeInTheDocument()
    const todo = screen.getByTestId(`column-${BOARD.columns[1].id}`)
    expect(within(todo).getByTestId('card-item-c')).toBeInTheDocument()
  })

  it('shows a WIP warning badge when a column exceeds its configured limit', async () => {
    // In Progress has wipLimit 1; put two items there.
    const overLimitItem = { ...ITEM_C, id: 'item-d', issueKey: 'ENG1-4', columnId: 'col-inprogress' }
    installMockFetch(baseRoutes([ITEM_A, { ...ITEM_C, columnId: 'col-inprogress' }, overLimitItem]))

    renderWithProviders(<BoardView project={PROJECT} />)

    const inProgress = await screen.findByTestId('column-col-inprogress')
    expect(within(inProgress).getByText('WIP ⚠')).toBeInTheDocument()
  })
})

describe('Filters', () => {
  it('re-requests items with the selected filters as query params', async () => {
    const fetchMock = installMockFetch(baseRoutes())
    renderWithProviders(<BoardView project={PROJECT} />)

    await screen.findByTestId('card-item-a')
    fetchMock.mockClear()

    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'HIGH')

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/items?'))
      expect(call).toBeDefined()
      expect(String(call![0])).toContain('priority=HIGH')
    })
  })
})

describe('Move/drag command behavior', () => {
  it('sends expectedVersion and keeps the optimistic position only after server success', async () => {
    let moveBody: unknown = null
    installMockFetch([
      ...baseRoutes(),
      {
        method: 'POST',
        path: '/api/items/item-a/move',
        handler: ({ body }) => {
          moveBody = body
          return { body: { ...ITEM_A, columnId: 'col-todo', version: 2 } }
        },
      },
    ])

    renderWithProviders(<BoardView project={PROJECT} />)
    await screen.findByTestId('card-item-a')

    // Keyboard, non-drag movement - the accessible equivalent of drag/drop.
    const moveSelect = screen.getByLabelText('Move ENG1-1 to column')
    await userEvent.selectOptions(moveSelect, 'col-todo')

    await waitFor(() =>
      expect(moveBody).toEqual({
        expectedVersion: 1,
        targetColumnId: 'col-todo',
        beforeItemId: null,
        afterItemId: 'item-c',
      }),
    )

    // After success, the card is now rendered under To Do.
    const todo = screen.getByTestId('column-col-todo')
    expect(await within(todo).findByTestId('card-item-a')).toBeInTheDocument()
  })

  it('rolls back the optimistic move on a non-conflict failure', async () => {
    installMockFetch([
      ...baseRoutes(),
      {
        method: 'POST',
        path: '/api/items/item-a/move',
        handler: () => ({ status: 500, body: errorBody('INTERNAL_ERROR', 'Something broke.') }),
      },
    ])

    renderWithProviders(<BoardView project={PROJECT} />)
    await screen.findByTestId('card-item-a')

    await userEvent.selectOptions(screen.getByLabelText('Move ENG1-1 to column'), 'col-todo')

    const backlog = screen.getByTestId('column-col-backlog')
    await waitFor(() => expect(within(backlog).getByTestId('card-item-a')).toBeInTheDocument())
  })

  it('on a 409 conflict, refreshes the whole board and tells the user clearly', async () => {
    let boardFetchCount = 0
    installMockFetch([
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      { path: `/api/teams/${TEAM_WITH_MEMBERS.id}`, handler: () => ({ body: TEAM_WITH_MEMBERS }) },
      {
        path: `/api/projects/${PROJECT.id}/board`,
        handler: () => {
          boardFetchCount += 1
          return { body: BOARD }
        },
      },
      {
        path: `/api/projects/${PROJECT.id}/items`,
        handler: () => ({ body: { items: [ITEM_A, ITEM_B, ITEM_C], nextCursor: null } }),
      },
      {
        method: 'POST',
        path: '/api/items/item-a/move',
        handler: () => ({
          status: 409,
          body: errorBody('CONFLICT', 'Resource has been modified since you last read it.', {
            currentVersion: 3,
          }),
        }),
      },
    ])

    renderWithProviders(<BoardView project={PROJECT} />)
    await screen.findByTestId('card-item-a')
    const boardFetchesBeforeMove = boardFetchCount

    await userEvent.selectOptions(screen.getByLabelText('Move ENG1-1 to column'), 'col-todo')

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/changed on the server/i))
    await waitFor(() => expect(boardFetchCount).toBeGreaterThan(boardFetchesBeforeMove))
  })
})
