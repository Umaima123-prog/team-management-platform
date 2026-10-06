import {
  Abortable,
  Collection,
  Document,
  Filter,
  FindOneOptions,
  FindOptions,
  WithId,
} from 'mongodb';

/**
 * Base for every future domain repository (teams, projects, boards,
 * columns, work items, memberships, ...). Every one of those
 * collections is scoped to a workspace, and a query that forgets to
 * filter by workspaceId is a cross-tenant data leak - so scoping is
 * enforced structurally here rather than left to each call site to
 * remember.
 *
 * No concrete repository extends this yet (no domain collections
 * exist in Phase 2). This is the reusable mechanism future phases
 * build on.
 */
export interface WorkspaceScoped {
  workspaceId: string;
}

export abstract class WorkspaceScopedRepository<T extends Document & WorkspaceScoped> {
  protected constructor(protected readonly collection: Collection<T>) {}

  private scoped(workspaceId: string, filter: Filter<T> = {}): Filter<T> {
    return { ...filter, workspaceId };
  }

  protected findOneScoped(
    workspaceId: string,
    filter: Filter<T> = {},
    options?: Omit<FindOneOptions, 'timeoutMode'> & Abortable,
  ): Promise<WithId<T> | null> {
    return this.collection.findOne(this.scoped(workspaceId, filter), options);
  }

  protected findScoped(
    workspaceId: string,
    filter: Filter<T> = {},
    options?: FindOptions & Abortable,
  ): Promise<WithId<T>[]> {
    return this.collection.find(this.scoped(workspaceId, filter), options).toArray();
  }

  protected countScoped(workspaceId: string, filter: Filter<T> = {}): Promise<number> {
    return this.collection.countDocuments(this.scoped(workspaceId, filter));
  }
}
