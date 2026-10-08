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

/** Optional per-call metadata. Identity is no longer passed through
 * here at all - apiRequest attaches the Authorization header itself
 * from the access token AuthContext holds (see docs/ARCHITECTURE.md
 * "Request context / trust model"); the server derives the caller
 * entirely from the verified JWT, never from anything the client
 * sends in the request body or query string. */
export interface RequestMeta {
  signal?: AbortSignal
}

// ---- Users ----

export function listUsers({ signal }: RequestMeta = {}): Promise<Page<User>> {
  return apiRequest<Page<User>>('/api/users', { signal })
}

// ---- Teams ----

export function listTeams(
  { signal }: RequestMeta = {},
  includeArchived = false,
): Promise<Page<Team>> {
  return apiRequest<Page<Team>>(`/api/teams?includeArchived=${includeArchived}`, { signal })
}

export function getTeam({ signal }: RequestMeta = {}, teamId: string): Promise<TeamWithMembers> {
  return apiRequest<TeamWithMembers>(`/api/teams/${teamId}`, { signal })
}

export interface CreateTeamInput {
  code: string
  name: string
  description?: string
}

export function createTeam({ signal }: RequestMeta = {}, input: CreateTeamInput): Promise<Team> {
  return apiRequest<Team>('/api/teams', { signal, method: 'POST', body: input })
}

export interface AddTeamMemberInput {
  userId: string
  role: 'OWNER' | 'LEAD' | 'MEMBER'
}

export function addTeamMember(
  { signal }: RequestMeta = {},
  teamId: string,
  input: AddTeamMemberInput,
): Promise<Membership> {
  return apiRequest<Membership>(`/api/teams/${teamId}/members`, {
    signal,
    method: 'POST',
    body: input,
  })
}

export function updateTeamMemberRole(
  { signal }: RequestMeta = {},
  teamId: string,
  memberUserId: string,
  role: 'OWNER' | 'LEAD' | 'MEMBER',
): Promise<Membership> {
  return apiRequest<Membership>(`/api/teams/${teamId}/members/${memberUserId}`, {
    signal,
    method: 'PATCH',
    body: { role },
  })
}

export function removeTeamMember(
  { signal }: RequestMeta = {},
  teamId: string,
  memberUserId: string,
): Promise<void> {
  return apiRequest<void>(`/api/teams/${teamId}/members/${memberUserId}`, {
    signal,
    method: 'DELETE',
  })
}

// ---- Projects ----

export function listProjects(
  { signal }: RequestMeta = {},
  includeArchived = false,
): Promise<Page<Project>> {
  return apiRequest<Page<Project>>(`/api/projects?includeArchived=${includeArchived}`, {
    signal,
  })
}

export function getProject({ signal }: RequestMeta = {}, projectId: string): Promise<Project> {
  return apiRequest<Project>(`/api/projects/${projectId}`, { signal })
}

export interface CreateProjectInput {
  projectKey: string
  name: string
  ownerId: string
  teamId: string
}

export function createProject(
  { signal }: RequestMeta = {},
  input: CreateProjectInput,
): Promise<Project> {
  return apiRequest<Project>('/api/projects', { signal, method: 'POST', body: input })
}

export function getBoard({ signal }: RequestMeta = {}, projectId: string): Promise<Board> {
  return apiRequest<Board>(`/api/projects/${projectId}/board`, { signal })
}

export function getProjectInsights(
  { signal }: RequestMeta = {},
  projectId: string,
): Promise<InsightsOutcome> {
  return apiRequest<InsightsOutcome>(`/api/projects/${projectId}/insights`, { signal })
}

export function getProjectActivity(
  { signal }: RequestMeta = {},
  projectId: string,
): Promise<ActivityOutcome> {
  return apiRequest<ActivityOutcome>(`/api/projects/${projectId}/activity`, { signal })
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
  { signal }: RequestMeta = {},
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
    signal,
  })
}

export function getWorkItem({ signal }: RequestMeta = {}, itemId: string): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/items/${itemId}`, { signal })
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
  { signal }: RequestMeta = {},
  projectId: string,
  input: CreateWorkItemInput,
): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/projects/${projectId}/items`, {
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
  { signal }: RequestMeta = {},
  itemId: string,
  input: UpdateWorkItemInput,
): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/items/${itemId}`, {
    signal,
    method: 'PATCH',
    body: input,
  })
}

export function assignWorkItem(
  { signal }: RequestMeta = {},
  itemId: string,
  expectedVersion: number,
  assigneeId: string | null,
): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/items/${itemId}/assign`, {
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
  { signal }: RequestMeta = {},
  itemId: string,
  input: MoveWorkItemInput,
): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/items/${itemId}/move`, {
    signal,
    method: 'POST',
    body: input,
  })
}

export function archiveWorkItem(
  { signal }: RequestMeta = {},
  itemId: string,
  expectedVersion: number,
): Promise<WorkItem> {
  return apiRequest<WorkItem>(`/api/items/${itemId}/archive`, {
    signal,
    method: 'POST',
    body: { expectedVersion },
  })
}
