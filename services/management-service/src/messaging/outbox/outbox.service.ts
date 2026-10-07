import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongodb';
import { CURRENT_SCHEMA_VERSION, EventEnvelope } from '../events/envelope';
import { generateEventId } from '../events/event-id';
import { validateEnvelope } from '../events/envelope-validator';
import { EventType, subjectForEventType } from '../events/subjects';
import { OutboxRepository } from './outbox.repository';

export interface EnqueueEventInput {
  workspaceId: string;
  eventType: EventType;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  /** eventId of the event in the SAME command that this one is a
   * consequence of, or null if this is the root fact of the command
   * (see docs/DECISIONS.md for the causationId-chaining convention
   * used when one command produces several related facts). */
  causationId: string | null;
  actorId: string;
  payload: Record<string, unknown>;
}

/**
 * The one place domain services create outbox rows. Call this from
 * inside a DatabaseService.withTransaction callback, passing the same
 * `session` used for the authoritative domain mutation - that is what
 * makes "mutate state and record the fact" atomic (see
 * docs/ARCHITECTURE.md "Transactional outbox").
 */
@Injectable()
export class OutboxService {
  constructor(private readonly outboxRepository: OutboxRepository) {}

  async enqueue(session: ClientSession, input: EnqueueEventInput): Promise<EventEnvelope> {
    const eventId = generateEventId();
    const occurredAt = new Date();
    const envelope: EventEnvelope = {
      eventId,
      eventType: input.eventType,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      occurredAt: occurredAt.toISOString(),
      producer: 'management-service',
      workspaceId: input.workspaceId,
      aggregate: {
        type: input.aggregateType,
        id: input.aggregateId,
        version: input.aggregateVersion,
      },
      correlationId: input.correlationId,
      causationId: input.causationId,
      actorId: input.actorId,
      payload: input.payload,
    };

    // Reject before it ever reaches the outbox - an invalid envelope
    // must never be committed, let alone published.
    validateEnvelope(envelope);

    await this.outboxRepository.insert(
      {
        workspaceId: input.workspaceId,
        eventId,
        eventType: input.eventType,
        subject: subjectForEventType(input.eventType),
        schemaVersion: CURRENT_SCHEMA_VERSION,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        aggregateVersion: input.aggregateVersion,
        payload: input.payload,
        envelope,
        occurredAt,
        correlationId: input.correlationId,
        causationId: input.causationId,
        actorId: input.actorId,
      },
      session,
    );

    return envelope;
  }
}
