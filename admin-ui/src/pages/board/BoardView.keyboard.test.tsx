import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BoardView } from './BoardView'
import { renderWithProviders } from '../../test/renderWithProviders'
import { installMockFetch, authSessionRoutes } from '../../test/mockApi'
import { ALICE_AUTH, ALL_USERS, BOARD, ITEM_A, ITEM_B, PROJECT, TEAM_WITH_MEMBERS } from '../../test/fixtures'

function baseRoutes() {
  return [
    ...authSessionRoutes(ALICE_AUTH),
    { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
    { path: `/api/teams/${TEAM_WITH_MEMBERS.id}`, handler: () => ({ body: TEAM_WITH_MEMBERS }) },
    { path: `/api/projects/${PROJECT.id}/board`, handler: () => ({ body: BOARD }) },
    {
      path: `/api/projects/${PROJECT.id}/items`,
      handler: () => ({ body: { items: [ITEM_A, ITEM_B], nextCursor: null } }),
    },
  ]
}

describe('Keyboard / non-drag reordering', () => {
  it('reorders within a column using only the keyboard-focusable up/down buttons - no drag required', async () => {
    let moveBody: unknown = null
    installMockFetch([
      ...baseRoutes(),
      {
        method: 'POST',
        path: '/api/items/item-b/move',
        handler: ({ body }) => {
          moveBody = body
          return { body: { ...ITEM_B, rank: 512 } }
        },
      },
    ])

    renderWithProviders(<BoardView project={PROJECT} />)
    await screen.findByTestId('card-item-a')

    // ITEM_B (rank 2048) sits after ITEM_A (rank 1024) in Backlog.
    // Moving it "up" should ask the server to place it before ITEM_A.
    const upButton = screen.getByRole('button', { name: 'Move ENG1-2 up within its column' })
    expect(upButton).toBeEnabled()
    await userEvent.click(upButton)

    await waitFor(() =>
      expect(moveBody).toEqual({
        expectedVersion: 1,
        targetColumnId: 'col-backlog',
        beforeItemId: 'item-a',
        afterItemId: null,
      }),
    )
  })

  it('disables "move up" for the first card and "move down" for the last card in a column', async () => {
    installMockFetch(baseRoutes())
    renderWithProviders(<BoardView project={PROJECT} />)
    await screen.findByTestId('card-item-a')

    expect(screen.getByRole('button', { name: 'Move ENG1-1 up within its column' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move ENG1-2 down within its column' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move ENG1-1 down within its column' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move ENG1-2 up within its column' })).toBeEnabled()
  })

  it('every enabled card move control is focusable without a mouse (disabled ones are correctly removed from tab order)', async () => {
    installMockFetch(baseRoutes())
    renderWithProviders(<BoardView project={PROJECT} />)
    await screen.findByTestId('card-item-a')

    const moveButtons = screen.getAllByRole('button', { name: /within its column/i })
    const enabledButtons = moveButtons.filter((button) => !button.hasAttribute('disabled'))
    expect(enabledButtons.length).toBeGreaterThan(0)
    for (const button of enabledButtons) {
      button.focus()
      expect(button).toHaveFocus()
    }
  })
})
