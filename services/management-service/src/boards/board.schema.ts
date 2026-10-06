import { WorkspaceScoped } from '../database/workspace-scoped.repository';

export interface BoardColumn {
  id: string;
  name: string;
  order: number;
  wipLimit: number | null;
}

export interface BoardDocument extends WorkspaceScoped {
  projectId: string;
  columns: BoardColumn[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_COLUMN_NAMES = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const;
