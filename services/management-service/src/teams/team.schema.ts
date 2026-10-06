import { WorkspaceScoped } from '../database/workspace-scoped.repository';

export interface TeamDocument extends WorkspaceScoped {
  code: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
