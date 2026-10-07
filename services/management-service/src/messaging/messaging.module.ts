import { Global, Module } from '@nestjs/common';
import { NatsConnectionService } from './nats/nats-connection.service';
import { StreamBootstrapService } from './jetstream/stream-bootstrap.service';
import { OutboxRepository } from './outbox/outbox.repository';
import { OutboxService } from './outbox/outbox.service';
import { OutboxRelayService } from './relay/outbox-relay.service';
import { InsightsClientService } from './insights/insights-client.service';
import { ActivityClientService } from './activity/activity-client.service';
import { MessagingHealthService } from './health/messaging-health.service';

/**
 * Messaging module (assignment section 9 "Messaging" domain module):
 * outbox persistence, JetStream stream/consumer bootstrap, publisher
 * relay, headers/retries, and health. Global so every domain module
 * (teams, projects, boards, work-items) can inject OutboxService
 * without an explicit import, the same way DatabaseModule is global.
 */
@Global()
@Module({
  providers: [
    NatsConnectionService,
    StreamBootstrapService,
    OutboxRepository,
    OutboxService,
    OutboxRelayService,
    InsightsClientService,
    ActivityClientService,
    MessagingHealthService,
  ],
  exports: [
    NatsConnectionService,
    StreamBootstrapService,
    OutboxRepository,
    OutboxService,
    InsightsClientService,
    ActivityClientService,
    MessagingHealthService,
  ],
})
export class MessagingModule {}
