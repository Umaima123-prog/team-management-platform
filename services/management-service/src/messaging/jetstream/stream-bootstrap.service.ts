import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { JetStreamManager, StreamInfo } from 'nats';
import { NatsConnectionService } from '../nats/nats-connection.service';
import { TEAM_EVENTS_STREAM_NAME } from '../events/subjects';
import {
  buildActivityInsightsConsumerConfig,
  buildTeamEventsStreamConfig,
  STREAM_STRUCTURAL_FIELDS,
} from './jetstream.config';
import { ACTIVITY_INSIGHTS_DURABLE_CONSUMER } from '../events/subjects';

/**
 * Idempotently ensures the TEAM_EVENTS stream and the
 * activity-insights-v1 durable consumer exist with the expected
 * configuration (assignment section 8). Runs on application bootstrap
 * but NEVER throws/crashes the app if NATS is unreachable - this is
 * infrastructure setup, not a liveness dependency (see
 * docs/ARCHITECTURE.md "Health model"); GET /health/ready surfaces the
 * resulting state instead.
 */
@Injectable()
export class StreamBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StreamBootstrapService.name);
  private lastBootstrapOk = false;

  constructor(private readonly nats: NatsConnectionService) {}

  isBootstrapped(): boolean {
    return this.lastBootstrapOk;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.bootstrap().catch((error: Error) => {
      this.logger.warn(
        `JetStream bootstrap failed (${error.name}): ${error.message} - will not retry automatically; ` +
          'GET /health/ready reports messaging.jetstreamReady=false until the app is restarted with NATS reachable.',
      );
    });
  }

  async bootstrap(): Promise<void> {
    const jsm = await this.nats.getJetStreamManager();
    await this.ensureStream(jsm);
    await this.ensureDurableConsumer(jsm);
    this.lastBootstrapOk = true;
  }

  private async ensureStream(jsm: JetStreamManager): Promise<void> {
    const desired = buildTeamEventsStreamConfig();
    let existing: StreamInfo | null = null;
    try {
      existing = await jsm.streams.info(TEAM_EVENTS_STREAM_NAME);
    } catch {
      existing = null; // stream does not exist yet - this is the expected first-run path
    }

    if (!existing) {
      await jsm.streams.add(desired);
      this.logger.log(`Created JetStream stream "${TEAM_EVENTS_STREAM_NAME}".`);
      return;
    }

    const incompatible = STREAM_STRUCTURAL_FIELDS.filter((field) => {
      if (field === 'subjects') {
        const existingSubjects = [...existing.config.subjects].sort();
        const desiredSubjects = [...(desired.subjects ?? [])].sort();
        return JSON.stringify(existingSubjects) !== JSON.stringify(desiredSubjects);
      }
      return existing.config[field] !== desired[field];
    });

    if (incompatible.length > 0) {
      // Deliberately does NOT call streams.update() or delete+recreate -
      // an idempotent bootstrap must never silently replace a prior,
      // structurally different configuration (could be production data).
      this.logger.warn(
        `Existing JetStream stream "${TEAM_EVENTS_STREAM_NAME}" has incompatible config for: ` +
          `${incompatible.join(', ')}. Leaving it untouched - resolve manually (see docs/ARCHITECTURE.md).`,
      );
      return;
    }

    // Safe, non-destructive reconciliation of fields that can drift
    // without risk (retention window tuning, replica count never
    // changes here, etc.) - never the structural fields above.
    const driftedSafeFields: Array<keyof typeof desired> = ['max_age', 'duplicate_window', 'discard'];
    const needsUpdate = driftedSafeFields.some((field) => existing.config[field] !== desired[field]);
    if (needsUpdate) {
      await jsm.streams.update(TEAM_EVENTS_STREAM_NAME, desired);
      this.logger.log(`Reconciled non-structural config drift on stream "${TEAM_EVENTS_STREAM_NAME}".`);
    } else {
      this.logger.log(`JetStream stream "${TEAM_EVENTS_STREAM_NAME}" already exists with matching config.`);
    }
  }

  private async ensureDurableConsumer(jsm: JetStreamManager): Promise<void> {
    try {
      await jsm.consumers.info(TEAM_EVENTS_STREAM_NAME, ACTIVITY_INSIGHTS_DURABLE_CONSUMER);
      this.logger.log(`Durable consumer "${ACTIVITY_INSIGHTS_DURABLE_CONSUMER}" already exists.`);
      return;
    } catch {
      // does not exist yet - expected first-run path
    }

    await jsm.consumers.add(TEAM_EVENTS_STREAM_NAME, buildActivityInsightsConsumerConfig());
    this.logger.log(
      `Created durable consumer "${ACTIVITY_INSIGHTS_DURABLE_CONSUMER}" on "${TEAM_EVENTS_STREAM_NAME}" ` +
        '(provisioned by Phase 4; consumption logic is Phase 5 - see docs/ARCHITECTURE.md).',
    );
  }
}
