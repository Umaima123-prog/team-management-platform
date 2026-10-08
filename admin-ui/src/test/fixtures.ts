import type { AuthUser, Board, Project, Team, TeamWithMembers, User, WorkItem } from '../api/types'

export const ALICE: User = {
  id: 'u-alice',
  workspaceId: 'ws-1',
  name: 'Alice Owner',
  email: 'alice@example.test',
  createdAt: '2026-01-01T00:00:00.000Z',
}
export const BOB: User = {
  id: 'u-bob',
  workspaceId: 'ws-1',
  name: 'Bob Lead',
  email: 'bob@example.test',
  createdAt: '2026-01-01T00:00:00.000Z',
}
export const CAROL: User = {
  id: 'u-carol',
  workspaceId: 'ws-1',
  name: 'Carol Member',
  email: 'carol@example.test',
  createdAt: '2026-01-01T00:00:00.000Z',
}
export const DAVE: User = {
  id: 'u-dave',
  workspaceId: 'ws-1',
  name: 'Dave Outsider',
  email: 'dave@example.test',
  createdAt: '2026-01-01T00:00:00.000Z',
}

export const ALL_USERS = [ALICE, BOB, CAROL, DAVE]

/** The authenticated-session shape (role/active) - distinct from the
 * plain `User` records above, which only mirror GET /api/users and
 * never carry a role. Alice is the seeded ADMIN; the rest are
 * EMPLOYEE, matching services/management-service/src/seed/seed-ids.ts. */
export const ALICE_AUTH: AuthUser = { ...ALICE, role: 'ADMIN', active: true }
export const BOB_AUTH: AuthUser = { ...BOB, role: 'EMPLOYEE', active: true }
export const CAROL_AUTH: AuthUser = { ...CAROL, role: 'EMPLOYEE', active: true }
export const DAVE_AUTH: AuthUser = { ...DAVE, role: 'EMPLOYEE', active: true }

export const TEAM: Team = {
  id: 'team-1',
  workspaceId: 'ws-1',
  code: 'ENG',
  name: 'Engineering',
  description: 'The engineering team',
  archivedAt: null,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const TEAM_WITH_MEMBERS: TeamWithMembers = {
  ...TEAM,
  members: [
    {
      id: 'mem-1',
      workspaceId: 'ws-1',
      teamId: TEAM.id,
      userId: ALICE.id,
      role: 'OWNER',
      removedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'mem-2',
      workspaceId: 'ws-1',
      teamId: TEAM.id,
      userId: CAROL.id,
      role: 'MEMBER',
      removedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}

export const PROJECT: Project = {
  id: 'proj-1',
  workspaceId: 'ws-1',
  projectKey: 'ENG1',
  name: 'Engine Overhaul',
  description: null,
  ownerId: ALICE.id,
  teamId: TEAM.id,
  startDate: null,
  endDate: null,
  status: 'ACTIVE',
  archivedAt: null,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export const BOARD: Board = {
  id: 'board-1',
  workspaceId: 'ws-1',
  projectId: PROJECT.id,
  columns: [
    { id: 'col-backlog', name: 'Backlog', order: 0, wipLimit: null },
    { id: 'col-todo', name: 'To Do', order: 1, wipLimit: null },
    { id: 'col-inprogress', name: 'In Progress', order: 2, wipLimit: 1 },
    { id: 'col-done', name: 'Done', order: 3, wipLimit: null },
  ],
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function item(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: 'item-x',
    workspaceId: 'ws-1',
    issueKey: 'ENG1-1',
    projectId: PROJECT.id,
    boardId: BOARD.id,
    columnId: 'col-backlog',
    rank: 1024,
    type: 'TASK',
    priority: 'MEDIUM',
    title: 'Untitled',
    description: null,
    reporterId: ALICE.id,
    assigneeId: null,
    labels: [],
    dueDate: null,
    acceptanceNotes: null,
    archivedAt: null,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export const ITEM_A = item({
  id: 'item-a',
  issueKey: 'ENG1-1',
  title: 'First item',
  columnId: 'col-backlog',
  rank: 1024,
  assigneeId: CAROL.id,
  priority: 'HIGH',
})

export const ITEM_B = item({
  id: 'item-b',
  issueKey: 'ENG1-2',
  title: 'Second item',
  columnId: 'col-backlog',
  rank: 2048,
  assigneeId: null,
  priority: 'LOW',
})

export const ITEM_C = item({
  id: 'item-c',
  issueKey: 'ENG1-3',
  title: 'Third item',
  columnId: 'col-todo',
  rank: 1024,
  assigneeId: ALICE.id,
  priority: 'MEDIUM',
})
