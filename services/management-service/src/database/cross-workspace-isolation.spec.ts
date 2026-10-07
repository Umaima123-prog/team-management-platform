import { ObjectId } from 'mongodb';
import { DatabaseService } from './database.service';
import { TeamsRepository } from '../teams/teams.repository';
import { ProjectsRepository } from '../projects/projects.repository';
import { WorkItemsRepository } from '../work-items/work-items.repository';

/**
 * Phase 7 gap: WorkspaceScopedRepository's own spec proves the
 * mechanism in isolation (every call gets workspaceId merged into its
 * filter), and each service's spec mocks its repository's `findById`
 * entirely - so nothing exercised the REAL repository classes against
 * two tenants' documents to prove an id that genuinely exists, just
 * in a different workspace, is actually unreachable. This is the
 * concrete tenant-isolation guarantee the assignment's "cross-
 * workspace access" requirement is about, so it is tested here
 * end-to-end through the real repository code, not by stipulation.
 *
 * A minimal real collection (not a fully-mocked `findOne`) is used
 * deliberately so the filter WorkspaceScopedRepository builds is
 * actually evaluated, not just asserted to have been called with the
 * right shape.
 */
class FakeCollection<T extends { _id: ObjectId; workspaceId: string }> {
  private readonly docs: T[] = [];

  insert(doc: T): void {
    this.docs.push(doc);
  }

  findOne(filter: { _id?: ObjectId; workspaceId: string }) {
    const match = this.docs.find(
      (d) =>
        d.workspaceId === filter.workspaceId &&
        (!filter._id || d._id.equals(filter._id)),
    );
    return Promise.resolve(match ?? null);
  }
}

function fakeDatabaseService<T extends { _id: ObjectId; workspaceId: string }>(
  collection: FakeCollection<T>,
) {
  return { getCollection: () => collection } as unknown as DatabaseService;
}

describe('Cross-workspace isolation (real repository classes, two tenants)', () => {
  const WORKSPACE_A = 'ws-a';
  const WORKSPACE_B = 'ws-b';

  it('TeamsRepository.findById cannot see workspace A\'s team from workspace B', async () => {
    const collection = new FakeCollection<{ _id: ObjectId; workspaceId: string }>();
    const teamId = new ObjectId();
    collection.insert({ _id: teamId, workspaceId: WORKSPACE_A });
    const repository = new TeamsRepository(fakeDatabaseService(collection));

    await expect(repository.findById(WORKSPACE_B, teamId.toHexString())).resolves.toBeNull();
    await expect(repository.findById(WORKSPACE_A, teamId.toHexString())).resolves.toMatchObject({
      _id: teamId,
    });
  });

  it('ProjectsRepository.findById cannot see workspace A\'s project from workspace B', async () => {
    const collection = new FakeCollection<{ _id: ObjectId; workspaceId: string }>();
    const projectId = new ObjectId();
    collection.insert({ _id: projectId, workspaceId: WORKSPACE_A });
    const repository = new ProjectsRepository(fakeDatabaseService(collection));

    await expect(repository.findById(WORKSPACE_B, projectId.toHexString())).resolves.toBeNull();
    await expect(repository.findById(WORKSPACE_A, projectId.toHexString())).resolves.toMatchObject({
      _id: projectId,
    });
  });

  it('WorkItemsRepository.findById cannot see workspace A\'s work item from workspace B', async () => {
    const collection = new FakeCollection<{ _id: ObjectId; workspaceId: string }>();
    const itemId = new ObjectId();
    collection.insert({ _id: itemId, workspaceId: WORKSPACE_A });
    const repository = new WorkItemsRepository(fakeDatabaseService(collection));

    await expect(repository.findById(WORKSPACE_B, itemId.toHexString())).resolves.toBeNull();
    await expect(repository.findById(WORKSPACE_A, itemId.toHexString())).resolves.toMatchObject({
      _id: itemId,
    });
  });
});
