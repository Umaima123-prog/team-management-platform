import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { headers as natsHeaders } from 'nats';
import { DatabaseService } from '../../database/database.service';
import { encodeEnvelopeToBytes } from '../events/canonicalize';
import { validateEnvelope } from '../events/envelope-validator';
import { NatsConnectionService } from '../nats/nats-connection.service';
import { OutboxEventDocument } from '../outbox/outbox.schema';
import { OutboxRepository } from '../outbox/outbox.repository';
import { formatMessagingLog } from '../logging/messaging-log';
import { classifyPublishError, computeBackoffMs, MAX_PUBLISH_ATTEMPTS } from './retry-policy';

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_LEASE_MS = 30_000;
const PUBLISH_TIMEOUT_MS = 5_000;

/**
 * The separate background publisher relay (docs/ARCHITECTURE.md
 * "Outbox publisher relay"). Polls for eligible unpublished outbox
 * rows, publishes each to JetStream with Nats-Msg-Id = eventId and the
 * documented headers, and marks a row published ONLY after a
 * successful publish acknowledgement from the server - never before
 * (see the publish-before-mark ordering test in
 * outbox-relay.service.spec.ts).
 *
 * Crash window (explicitly accepted, not a bug): if the process
 * crashes between a successful `js.publish()` resolving and
 * `markPublished()` persisting, the row is republished on the next
 * tick. JetStream's Nats-Msg-Id dedup absorbs this within the stream's
 * duplicate_window; outside that window, the Python service's future
 * inbox is the actual correctness guarantee (docs/DECISIONS.md #3/#4).
 * This system never claims exactly-once delivery.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly nats: NatsConnectionService,
    private readonly databaseService: DatabaseService,
    config: ConfigService,
  ) {
    this.pollIntervalMs = Number(config.get('OUTBOX_RELAY_INTERVAL_MS') ?? DEFAULT_POLL_INTERVAL_MS);
    this.batchSize = Number(config.get('OUTBOX_RELAY_BATCH_SIZE') ?? DEFAULT_BATCH_SIZE);
    this.leaseMs = Number(config.get('OUTBOX_RELAY_LEASE_MS') ?? DEFAULT_LEASE_MS);
  }

  onApplicationBootstrap(): void {
    // Test environments construct the module without wanting a live
    // timer running in the background - see MessagingModule.register().
    if (process.env.OUTBOX_RELAY_DISABLED === 'true') return;
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Avoids unsafe concurrent relay processing within this process: a
   * tick that is still running is never re-entered by the next timer
   * fire (see docs/ARCHITECTURE.md). Cross-process safety is provided
   * independently by the atomic claim in OutboxRepository.claimBatch. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Self-heals a MongoClient whose topology closed itself after an
      // earlier failed connection attempt (see
      // DatabaseService.ensureConnected and docs/DECISIONS.md #16) -
      // near-instant no-op once healthy, so this is safe to call every
      // tick without ever constructing a new MongoClient.
      await this.databaseService.ensureConnected();
      const batch = await this.outboxRepository.claimBatch(this.batchSize, this.leaseMs);
      for (const record of batch) {
        await this.publishOne(record);
      }
    } catch (error) {
      this.logger.warn(`Relay tick failed (${(error as Error).name}): ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async publishOne(record: OutboxEventDocument): Promise<void> {
    const start = Date.now();
    const attemptNumber = record.attempts + 1;
    try {
      validateEnvelope(record.envelope); // defense in depth - see docs/ARCHITECTURE.md

      const js = await this.nats.getJetStreamClient();
      const h = natsHeaders();
      h.set('X-Correlation-Id', record.correlationId);
      if (record.causationId) h.set('X-Causation-Id', record.causationId);
      h.set('X-Event-Id', record.eventId);
      h.set('X-Schema-Version', String(record.schemaVersion));
      h.set('X-Aggregate-Type', record.aggregateType);
      h.set('X-Aggregate-Id', record.aggregateId);
      h.set('X-Aggregate-Version', String(record.aggregateVersion));

      const data = encodeEnvelopeToBytes(record.envelope);

      const pubAck = await js.publish(record.subject, data, {
        msgID: record.eventId,
        headers: h,
        timeout: PUBLISH_TIMEOUT_MS,
      });

      // Only now, after a real publish acknowledgement, is the row
      // marked published - never before (see module docstring).
      await this.outboxRepository.markPublished(record.eventId);

      this.logger.log(
        formatMessagingLog({
          service: 'management-service',
          correlationId: record.correlationId,
          eventId: record.eventId,
          aggregateId: record.aggregateId,
          subject: record.subject,
          attempt: attemptNumber,
          latencyMs: Date.now() - start,
          result: pubAck.duplicate ? 'published_duplicate' : 'published',
          streamSeq: pubAck.seq,
        }),
      );
    } catch (error) {
      const classification = classifyPublishError(error);
      const terminal = !classification.retryable || attemptNumber >= MAX_PUBLISH_ATTEMPTS;

      if (terminal) {
        await this.outboxRepository.markTerminalFailure(record.eventId, classification.code);
        this.logger.error(
          formatMessagingLog({
            service: 'management-service',
            correlationId: record.correlationId,
            eventId: record.eventId,
            aggregateId: record.aggregateId,
            subject: record.subject,
            attempt: attemptNumber,
            latencyMs: Date.now() - start,
            result: 'terminal_failure',
            errorCode: classification.code,
          }),
        );
      } else {
        const delayMs = computeBackoffMs(attemptNumber);
        await this.outboxRepository.scheduleRetry(record.eventId, classification.code, new Date(Date.now() + delayMs));
        this.logger.warn(
          formatMessagingLog({
            service: 'management-service',
            correlationId: record.correlationId,
            eventId: record.eventId,
            aggregateId: record.aggregateId,
            subject: record.subject,
            attempt: attemptNumber,
            latencyMs: Date.now() - start,
            result: 'retry_scheduled',
            errorCode: classification.code,
            nextAttemptInMs: delayMs,
          }),
        );
      }
    }
  }
}
