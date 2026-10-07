import { Injectable } from '@nestjs/common';
import { NatsConnectionService } from '../nats/nats-connection.service';
import { StreamBootstrapService } from '../jetstream/stream-bootstrap.service';
import { OutboxRepository } from '../outbox/outbox.repository';

export interface MessagingDiagnostics {
  natsConnected: boolean;
  jetstreamReady: boolean;
  unpublishedOutboxCount: number;
  failedOutboxCount: number;
}

/**
 * Readiness diagnostics for messaging infrastructure (assignment
 * section G/13 "Health model"). Deliberately a DIAGNOSTIC surface, not
 * a hard gate on GET /health/ready's overall status - see
 * docs/DECISIONS.md for why NATS being down must not make the whole
 * service "not ready" when the transactional outbox already makes
 * writes independently durable.
 */
@Injectable()
export class MessagingHealthService {
  constructor(
    private readonly nats: NatsConnectionService,
    private readonly streamBootstrap: StreamBootstrapService,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async diagnostics(): Promise<MessagingDiagnostics> {
    const [unpublishedOutboxCount, failedOutboxCount] = await Promise.all([
      this.outboxRepository.countUnpublished().catch(() => -1),
      this.outboxRepository.countFailed().catch(() => -1),
    ]);
    return {
      natsConnected: this.nats.isConnected(),
      jetstreamReady: this.streamBootstrap.isBootstrapped(),
      unpublishedOutboxCount,
      failedOutboxCount,
    };
  }
}
