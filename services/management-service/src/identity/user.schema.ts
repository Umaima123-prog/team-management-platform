import { WorkspaceScoped } from '../database/workspace-scoped.repository';

export interface UserDocument extends WorkspaceScoped {
  name: string;
  email: string;
  createdAt: Date;
}
