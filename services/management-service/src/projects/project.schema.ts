import { WorkspaceScoped } from '../database/workspace-scoped.repository';

export const PROJECT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectDocument extends WorkspaceScoped {
  projectKey: string;
  name: string;
  description: string | null;
  ownerId: string;
  teamId: string;
  status: ProjectStatus;
  startDate: Date | null;
  endDate: Date | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
