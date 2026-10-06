import { ConflictException, NotFoundException } from '@nestjs/common';
import { Collection } from 'mongodb';
import { conditionalUpdate } from './conditional-update';

interface Thing {
  _id: string;
  workspaceId: string;
  name: string;
  version: number;
}

describe('conditionalUpdate', () => {
  let collection: { findOneAndUpdate: jest.Mock; findOne: jest.Mock };

  beforeEach(() => {
    collection = { findOneAndUpdate: jest.fn(), findOne: jest.fn() };
  });

  it('applies the update and increments version on a matching document', async () => {
    const updated = { _id: '1', workspaceId: 'ws', name: 'new', version: 2 };
    collection.findOneAndUpdate.mockResolvedValue(updated);

    const result = await conditionalUpdate(
      collection as unknown as Collection<Thing>,
      { _id: '1', workspaceId: 'ws' },
      1,
      { $set: { name: 'new' } },
    );

    expect(result).toBe(updated);
    const [filter, update] = collection.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $inc: Record<string, unknown>; $set: Record<string, unknown> },
    ];
    expect(filter).toEqual({ _id: '1', workspaceId: 'ws', version: 1 });
    expect(update.$inc).toEqual({ version: 1 });
    expect(update.$set.name).toBe('new');
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
  });

  it('throws 404 when no document matches the base filter at all', async () => {
    collection.findOneAndUpdate.mockResolvedValue(null);
    collection.findOne.mockResolvedValue(null);

    await expect(
      conditionalUpdate(collection as unknown as Collection<Thing>, { _id: 'missing' }, 1, {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws a ConflictException carrying the current version when the document exists but version is stale', async () => {
    collection.findOneAndUpdate.mockResolvedValue(null);
    collection.findOne.mockResolvedValue({ _id: '1', workspaceId: 'ws', name: 'x', version: 5 });

    let caught: unknown;
    try {
      await conditionalUpdate(collection as unknown as Collection<Thing>, { _id: '1' }, 1, {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toMatchObject({ currentVersion: 5 });
  });
});
