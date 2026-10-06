import { WorkspaceScoped } from '../database/workspace-scoped.repository';

export const WORK_ITEM_TYPES = ['TASK', 'BUG', 'STORY', 'EPIC'] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export const WORK_ITEM_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export interface WorkItemDocument extends WorkspaceScoped {
  issueKey: string;
  projectId: string;
  boardId: string;
  columnId: string;
  rank: number;
  type: WorkItemType;
  priority: WorkItemPriority;
  title: string;
  description: string | null;
  reporterId: string;
  assigneeId: string | null;
  labels: string[];
  dueDate: Date | null;
  acceptanceNotes: string | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
