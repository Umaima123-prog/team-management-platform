export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
}

export interface User {
  id: string
  workspaceId: string
  name: string
  email: string
  createdAt: string
}

export type TeamRole = 'OWNER' | 'LEAD' | 'MEMBER'

export interface Team {
  id: string
  workspaceId: string
  code: string
  name: string
  description: string | null
  archivedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface Membership {
  id: string
  workspaceId: string
  teamId: string
  userId: string
  role: TeamRole
  removedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TeamWithMembers extends Team {
  members: Membership[]
}

export type ProjectStatus = 'ACTIVE' | 'ARCHIVED'

export interface Project {
  id: string
  workspaceId: string
  projectKey: string
  name: string
  description: string | null
  ownerId: string
  teamId: string
  startDate: string | null
  endDate: string | null
  status: ProjectStatus
  archivedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface BoardColumn {
  id: string
  name: string
  order: number
  wipLimit: number | null
}

export interface Board {
  id: string
  workspaceId: string
  projectId: string
  columns: BoardColumn[]
  version: number
  createdAt: string
  updatedAt: string
}

export type WorkItemType = 'TASK' | 'BUG' | 'STORY'
export type WorkItemPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export interface WorkItem {
  id: string
  workspaceId: string
  issueKey: string
  projectId: string
  boardId: string
  columnId: string
  rank: number
  type: WorkItemType
  priority: WorkItemPriority
  title: string
  description: string | null
  reporterId: string
  assigneeId: string | null
  labels: string[]
  dueDate: string | null
  acceptanceNotes: string | null
  archivedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface ProjectInsightsData {
  projectId: string
  generatedAt: string
  workloadByAssignee: Array<{ assigneeId: string | null; count: number }>
  countsByStatus: Array<{ columnId: string; count: number }>
  workloadByPriority?: Array<{ priority: string; count: number }>
  lastProcessedSequence: number | null
}

export type InsightsOutcome =
  | { status: 'ok'; data: ProjectInsightsData }
  | { status: 'not_ready'; reason: string }
  | { status: 'pending'; reason: string }
  | { status: 'unavailable'; reason: string }

export interface ProjectActivityEntry {
  eventId: string
  eventType: string
  aggregateType: string
  aggregateId: string
  /** Resolved from the Python service's own item_state projection
   * (never management_db) - present only for WorkItem aggregates
   * whose workitem.created event has been processed. Null/absent
   * otherwise - callers must fall back to aggregateType/aggregateId. */
  issueKey?: string | null
  actorId: string
  occurredAt: string
}

export interface ProjectActivityData {
  projectId: string
  generatedAt: string
  entries: ProjectActivityEntry[]
  lastProcessedSequence: number | null
}

export type ActivityOutcome =
  | { status: 'ok'; data: ProjectActivityData }
  | { status: 'not_ready'; reason: string }
  | { status: 'pending'; reason: string }
  | { status: 'unavailable'; reason: string }
