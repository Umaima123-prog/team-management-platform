import { Injectable } from '@nestjs/common';
import { ClientSession, Collection } from 'mongodb';
import { DatabaseService } from '../../database/database.service';
import { EventEnvelope } from '../events/envelope';
import { EventType } from '../events/subjects';
import { OutboxEventDocument } from './outbox.schema';

export interface NewOutboxEvent {
  workspaceId: string;
  eventId: string;
  eventType: EventType;
  subject: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: Record<string, unknown>;
  envelope: EventEnvelope;
  occurredAt: Date;
  correlationId: string;
  causationId: string | null;
  actorId: string;
}

@Injectable()
export class OutboxRepository {
  private readonly collection: Collection<OutboxEventDocument>;

  constructor(databaseService: DatabaseService) {
    this.collection = databaseService.getCollection<OutboxEventDocument>('outbox_events');
  }

  /** Inserted inside the SAME transaction/session as the authoritative
   * domain mutation it documents - see DatabaseService.withTransaction
   * and docs/ARCHITECTURE.md "Transactional outbox". */
  async insert(event: NewOutboxEvent, session: ClientSession): Promise<OutboxEventDocument> {
    const now = new Date();
    const toInsert: Omit<OutboxEventDocument, '_id'> = {
      ...event,
      publishedAt: null,
      attempts: 0,
      claimedAt: null,
      leaseUntil: null,
      nextAttemptAt: null,
      lastErrorCode: null,
      failedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.collection.insertOne(toInsert, { session });
    return { ...toInsert, _id: result.insertedId } as OutboxEventDocument;
  }

  /**
   * Atomically claims up to `limit` eligible rows for this relay tick.
   * Eligible = not yet published, not terminally failed, not currently
   * leased by another in-flight claim, and not waiting out a backoff
   * window. Each claim is a single findOneAndUpdate - atomic at the
   * MongoDB level - so this is safe even if a second relay
   * instance/tick runs concurrently (see docs/ARCHITECTURE.md
   * "Outbox publisher relay").
   */
  async claimBatch(limit: number, leaseMs: number): Promise<OutboxEventDocument[]> {
    const claimed: OutboxEventDocument[] = [];
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);

    for (let i = 0; i < limit; i++) {
      const row = await this.collection.findOneAndUpdate(
        {
          publishedAt: null,
          failedAt: null,
          $and: [
            { $or: [{ claimedAt: null }, { leaseUntil: { $lt: now } }] },
            { $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] },
          ],
        },
        { $set: { claimedAt: now, leaseUntil, updatedAt: now } },
        { sort: { occurredAt: 1 }, returnDocument: 'after' },
      );
      if (!row) break;
      claimed.push(row);
    }
    return claimed;
  }

  /** Only ever called AFTER a successful JetStream publish
   * acknowledgement - see outbox-relay.service.ts. */
  async markPublished(eventId: string): Promise<void> {
    await this.collection.updateOne(
      { eventId },
      {
        $set: { publishedAt: new Date(), claimedAt: null, leaseUntil: null, lastErrorCode: null, updatedAt: new Date() },
        $inc: { attempts: 1 },
      },
    );
  }

  /** Retryable failure: release the claim and schedule the next
   * attempt after a bounded backoff (see retry-policy.ts). */
  async scheduleRetry(eventId: string, errorCode: string, nextAttemptAt: Date): Promise<void> {
    await this.collection.updateOne(
      { eventId },
      {
        $set: { claimedAt: null, leaseUntil: null, nextAttemptAt, lastErrorCode: errorCode, updatedAt: new Date() },
        $inc: { attempts: 1 },
      },
    );
  }

  /** Non-retryable or retry-budget-exhausted failure: the documented
   * terminal / operator-visible path. Never retried automatically
   * again - see docs/ARCHITECTURE.md "Failure / poison policy". */
  async markTerminalFailure(eventId: string, errorCode: string): Promise<void> {
    await this.collection.updateOne(
      { eventId },
      {
        $set: {
          claimedAt: null,
          leaseUntil: null,
          failedAt: new Date(),
          lastErrorCode: errorCode,
          updatedAt: new Date(),
        },
        $inc: { attempts: 1 },
      },
    );
  }

  /** Operator-visible count for readiness diagnostics (never includes
   * payload content or secrets - a count only). */
  countFailed(): Promise<number> {
    return this.collection.countDocuments({ failedAt: { $ne: null } });
  }

  countUnpublished(): Promise<number> {
    return this.collection.countDocuments({ publishedAt: null, failedAt: null });
  }

  findByEventId(eventId: string): Promise<OutboxEventDocument | null> {
    return this.collection.findOne({ eventId });
  }
}
