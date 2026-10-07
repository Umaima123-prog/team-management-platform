import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ActivityPanel } from './ActivityPanel'
import { renderWithProviders } from '../test/renderWithProviders'
import { installMockFetch } from '../test/mockApi'
import { ALICE, ALL_USERS, PROJECT } from '../test/fixtures'

beforeEach(() => {
  window.localStorage.setItem('admin-ui.currentUserId', ALICE.id)
})

describe('ActivityPanel', () => {
  it('renders actor, action, affected item, and time in chronological (newest-first) order', async () => {
    installMockFetch([
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      {
        path: `/api/projects/${PROJECT.id}/activity`,
        handler: () => ({
          body: {
            status: 'ok',
            data: {
              projectId: PROJECT.id,
              generatedAt: '2026-10-07T12:00:00.000Z',
              entries: [
                {
                  eventId: 'evt-2',
                  eventType: 'workitem.moved',
                  aggregateType: 'WorkItem',
                  aggregateId: 'item-a',
                  actorId: ALICE.id,
                  occurredAt: '2026-10-07T11:00:00.000Z',
                },
                {
                  eventId: 'evt-1',
                  eventType: 'workitem.created',
                  aggregateType: 'WorkItem',
                  aggregateId: 'item-a',
                  actorId: ALICE.id,
                  occurredAt: '2026-10-07T10:00:00.000Z',
                },
              ],
              lastProcessedSequence: 12,
            },
          },
        }),
      },
    ])

    renderWithProviders(<ActivityPanel projectId={PROJECT.id} />)

    const list = await screen.findByRole('list', { name: /project activity/i })
    const entries = list.querySelectorAll('li')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('Alice Owner')
    expect(entries[0]).toHaveTextContent('moved')
    expect(entries[0]).toHaveTextContent('item-a')
    expect(entries[1]).toHaveTextContent('created')
  })

  it('shows the human-readable issue key instead of the raw internal WorkItem id when available', async () => {
    installMockFetch([
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      {
        path: `/api/projects/${PROJECT.id}/activity`,
        handler: () => ({
          body: {
            status: 'ok',
            data: {
              projectId: PROJECT.id,
              generatedAt: '2026-10-07T12:00:00.000Z',
              entries: [
                {
                  eventId: 'evt-1',
                  eventType: 'workitem.moved',
                  aggregateType: 'WorkItem',
                  aggregateId: '6ac5f633cbe07abdaad58ffd',
                  issueKey: 'PH5VER-2',
                  actorId: ALICE.id,
                  occurredAt: '2026-10-07T11:00:00.000Z',
                },
                {
                  // No issue key resolved (e.g. its "created" event
                  // hasn't been processed yet) - must still render,
                  // falling back to the raw aggregate reference.
                  eventId: 'evt-2',
                  eventType: 'project.created',
                  aggregateType: 'Project',
                  aggregateId: PROJECT.id,
                  issueKey: null,
                  actorId: ALICE.id,
                  occurredAt: '2026-10-07T10:00:00.000Z',
                },
              ],
              lastProcessedSequence: 12,
            },
          },
        }),
      },
    ])

    renderWithProviders(<ActivityPanel projectId={PROJECT.id} />)

    const list = await screen.findByRole('list', { name: /project activity/i })
    expect(list).toHaveTextContent('PH5VER-2')
    expect(list).not.toHaveTextContent('6ac5f633cbe07abdaad58ffd')
    expect(list).toHaveTextContent(`Project ${PROJECT.id}`)
  })

  it('shows a clear not_ready message rather than an empty or broken view', async () => {
    installMockFetch([
      { path: '/api/users', handler: () => ({ body: { items: ALL_USERS } }) },
      {
        path: `/api/projects/${PROJECT.id}/activity`,
        handler: () => ({ body: { status: 'not_ready', reason: 'NO_DATA_YET_FOR_PROJECT' } }),
      },
    ])

    renderWithProviders(<ActivityPanel projectId={PROJECT.id} />)

    expect(await screen.findByText(/isn.t available/i)).toBeInTheDocument()
  })
})
