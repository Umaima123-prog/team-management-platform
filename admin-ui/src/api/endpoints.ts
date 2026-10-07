import { apiRequest } from './client'
import type {
  ActivityOutcome,
  Board,
  InsightsOutcome,
  Membership,
  Page,
  Project,
  Team,
  TeamWithMembers,
  User,
  WorkItem,
} from './types'

/** Every call needs the caller's dev user id - see
 * docs/ARCHITECTURE.md "Request context / trust model". Passed
 * explicitly (not read from a module-level global) so callers always
 * go through CurrentUserContext and it stays obvious in each call
 * site which identity is acting. */
export interface AuthedRequest {
  userId: string
  signal?: AbortSignal
}

// ---- Users ----

export function listUsers({ userId, signal }: AuthedRequest): Promise<Page<User>> {
  return apiRequest<Page<User>>('/api/users', { userId, signal })
}

// ---- Teams ----

export function listTeams(
  { userId, signal }: AuthedRequest,
  includeArchived = false,
): Promise<Page<Team>> {
  return apiRequest<Page<Team>>(`/api/teams?includeArchived=${includeArchived}`, { userId, signal })
}

export function getTeam({ userId, signal }: AuthedRequest, teamId: string): Promise<TeamWithMembers> {
  return apiRequest<TeamWithMembers>(`/api/teams/${teamId}`, { userId, signal })
}

export interface CreateTeamInput {
  code: string
  name: string
  description?: string
}

export function createTeam({ userId, signal }: AuthedRequest, input: CreateTeamInput): Promise<Team> {
  return apiRequest<Team>('/api/teams', { userId, signal, method: 'POST', body: input })
}

export interface AddTeamMemberInput {
  userId: string
  role: 'OWNER' | 'LEAD' | 'MEMBER'
}

export function addTeamMember(
  { userId, signal }: AuthedRequest,
  teamId: string,
  input: AddTeamMemberInput,
): Promise<Membership> {
  return apiRequest<Membership>(`/api/teams/${teamId}/members`, {
    userId,
    signal,
    method: 'POST',
    body: input,
  })
}

export function updateTeamMemberRole(
  { userId, signal }: AuthedRequest,
  teamId: string,
  memberUserId: string,
  role: 'OWNER' | 'LEAD' | 'MEMBER',
): Promise<Membership> {
  return apiRequest<Membership>(`/api/teams/${teamId}/members/${memberUserId}`, {
    userId,
    signal,
    method: 'PATCH',
    body: { role },
  })
}

export function removeTeamMember(
  { userId, signal }: AuthedRequest,
  teamId: string,
  memberUserId: string,
): Promise<void> {
  return apiRequest<void>(`/api/teams/${teamId}/members/${memberUserId}`, {
    userId,
    signal,
    method: 'DELETE',
  })
}

// ---- Projects ----

export function listProjects(
  { userId, signal }: AuthedRequest,
  includeArchived = false,
): Promise<Page<Project>> {
  return apiRequest<Page<Project>>(`/api/projects?includeArchived=${includeArchived}`, {
    userId,
    signal,
  })
}

export function getProject({ userId, signal }: AuthedRequest, projectId: string): Promise<Project> {
  return apiRequest<Project>(`/api/projects/${projectId}`, { userId, signal })
}

export interface CreateProjectInput {
  projectKey: string
  name: string
  ownerId: string
  teamId: string
}

export function createProject(
  { userId, signal }: AuthedRequest,
  input: CreateProjectInput,
): Promise<Project> {
  return apiRequest<Project>('/api/projects', { userId, signal, method: 'POST', body: input })
}

export function getBoard({ userId, signal }: AuthedRequest, projectId: string): Promise<Board> {
  return apiRequest<Board>(`/api/projects/${projectId}/board`, { userId, signal })
}

export function getProjectInsights(
  { userId, signal }: AuthedRequest,
  projectId: string,
): Promise<InsightsOutcome> {
  return apiRequest<InsightsOutcome>(`/api/projects/${projectId}/insights`, { userId, signal })
}

export function getProjectActivity(
  { userId, signal }: AuthedRequest,
  projectId: string,
): Promise<ActivityOutcome> {
  return apiRequest<ActivityOutcome>(`/api/projects/${projectId}/activity`, { userId, signal })
}

// ---- Work items ----

export interface ListItemsFilters {
  assigneeId?: string
  priority?: string
  type?: string
  label?: string
  q?: string
  includeArchived?: boolean
  cursor?: string
  limit?: number
}

export function listWorkItems(
  { userId, signal }: AuthedRequest,
  projectId: string,
  filters: ListItemsFilters = {},
): Promise<Page<WorkItem>> {
  const params = new URLSearchParams()
  if (filters.assigneeId) params.set('assigneeId', filters.assigneeId)
  if (filters.priority) params.set('priority', filters.priority)
  if (filters.type) params.set('type', filters.type)
  if (filters.label) params.set('label', filters.label)
  if (filters.q) params.set('q', filters.q)
  params.set('includeArchived', String(filters.includeArchived ?? false))
  if (filters.cursor) params.set('cursor', filters.cursor)
  params.set('limit', String(filters.limit ?? 100))
  return apiRequest<Page<WorkItem>>(`/api/projects/${projectId}/items?${params.toString()}`, {
    userId,
    signal,
  })
}

export function getWorkItem({ userId, signal }: AuthedRequest, itemId: string): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/items/${itemId}`, { userId, signal })
}

export interface CreateWorkItemInput {
  type: string
  priority: string
  title: string
  description?: string
  assigneeId?: string | null
  labels?: string[]
  dueDate?: string | null
}

export function createWorkItem(
  { userId, signal }: AuthedRequest,
  projectId: string,
  input: CreateWorkItemInput,
): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/projects/${projectId}/items`, {
    userId,
    signal,
    method: 'POST',
    body: input,
  })
}

export interface UpdateWorkItemInput {
  expectedVersion: number
  title?: string
  description?: string | null
  type?: string
  priority?: string
  labels?: string[]
  dueDate?: string | null
  acceptanceNotes?: string | null
}

export function updateWorkItem(
  { userId, signal }: AuthedRequest,
  itemId: string,
  input: UpdateWorkItemInput,
): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/items/${itemId}`, {
    userId,
    signal,
    method: 'PATCH',
    body: input,
  })
}

export function assignWorkItem(
  { userId, signal }: AuthedRequest,
  itemId: string,
  expectedVersion: number,
  assigneeId: string | null,
): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/items/${itemId}/assign`, {
    userId,
    signal,
    method: 'POST',
    body: { expectedVersion, assigneeId },
  })
}

export interface MoveWorkItemInput {
  expectedVersion: number
  targetColumnId: string
  beforeItemId?: string | null
  afterItemId?: string | null
}

export function moveWorkItem(
  { userId, signal }: AuthedRequest,
  itemId: string,
  input: MoveWorkItemInput,
): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/items/${itemId}/move`, {
    userId,
    signal,
    method: 'POST',
    body: input,
  })
}

export function archiveWorkItem(
  { userId, signal }: AuthedRequest,
  itemId: string,
  expectedVersion: number,
): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/items/${itemId}/archive`, {
    userId,
    signal,
    method: 'POST',
    body: { expectedVersion },
  })
}
