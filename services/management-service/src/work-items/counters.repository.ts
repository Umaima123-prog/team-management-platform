import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CounterDocument } from './counter.schema';

/**
 * Atomic per-project issue-sequence counter. $inc + upsert is a single
 * atomic MongoDB operation, so concurrent work-item creations never
 * hand out the same sequence number, and because the counter only
 * ever increments (never resets, never reused even if the item it
 * named is later archived), issue keys are never reused - see
 * work-items.service.ts.
 */
@Injectable()
export class CountersRepository {
  private readonly collection;

  constructor(databaseService: DatabaseService) {
    this.collection = databaseService.getCollection<CounterDocument>('counters');
  }

  async getNextSequence(workspaceId: string, projectId: string): Promise<number> {
    const result = await this.collection.findOneAndUpdate(
      { _id: projectId },
      { $inc: { seq: 1 }, $setOnInsert: { workspaceId } },
      { upsert: true, returnDocument: 'after' },
    );
    return result!.seq;
  }
}
