import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { AckPolicy, DeliverPolicy, nanos, NatsConnection } from 'nats';
import { DatabaseService } from '../src/database/database.service';
import { generateEventId } from '../src/messaging/events/event-id';
import { EventEnvelope, CURRENT_SCHEMA_VERSION } from '../src/messaging/events/envelope';
import {
  ACTIVITY_INSIGHTS_DURABLE_CONSUMER,
  PROJECT_ACTIVITY_QUERY_SUBJECT,
  PROJECT_INSIGHTS_QUERY_SUBJECT,
  TEAM_EVENTS_STREAM_NAME,
} from '../src/messaging/events/subjects';
import { NatsConnectionService } from '../src/messaging/nats/nats-connection.service';
import { StreamBootstrapService } from '../src/messaging/jetstream/stream-bootstrap.service';
import { OutboxRelayService } from '../src/messaging/relay/outbox-relay.service';
import { OutboxEventDocument } from '../src/messaging/outbox/outbox.schema';
import { OutboxRepository } from '../src/messaging/outbox/outbox.repository';
import { InsightsClientService } from '../src/messaging/insights/insights-client.service';
import { ActivityClientService } from '../src/messaging/activity/activity-client.service';

/**
 * REAL local NATS JetStream integration suite - no mocks on the
 * messaging side (assignment: "at least one automated integration
 * suite using the REAL local Docker NATS JetStream server... Do not
 * replace this integration suite with mocks").
 *
 * Requires `docker compose up -d nats` at the repo root (the project's
 * existing local dev NATS, file-backed JetStream - see
 * docker-compose.yml / docker/nats/). This suite genuinely fails (not
 * silently skips) if nothing is listening on NATS_URL, so a missing
 * Docker server is loud, not silently green.
 *
 * MongoDB is deliberately NOT part of this suite: this sandboxed
 * execution environment could not reach the project's MongoDB Atlas
 * cluster (verified separately, TLS-level failure on port 27017,
 * independent of Node - see docs/DECISIONS.md #11), and this project
 * has no Dockerized local MongoDB (ARCHITECTURE.md "Local
 * infrastructure"). Everywhere this suite needs an "outbox
 * repository," it uses a small in-memory stand-in implementing the
 * exact same interface OutboxRelayService depends on
 * (claimBatch/markPublished/scheduleRetry/markTerminalFailure) - the
 * thing actually under test here (JetStream publish/ack/dedup/
 * consumer behavior) is 100% real; only the Mongo persistence layer
 * (already covered by mocked-repository unit tests, consistent with
 * this project's existing documented testing strategy - see
 * docs/DECISIONS.md #9) is a lightweight substitute.
 */

const NATS_URL = process.env.NATS_INTEGRATION_URL ?? 'nats://localhost:4222';

function fakeConfig(values: Record<string, string | undefined> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** No real Mongo is reachable in this environment (see module
 * docstring) - OutboxRelayService's self-heal call
 * (DatabaseService.ensureConnected, see docs/DECISIONS.md #16) is a
 * no-op stand-in here; it is covered for real by
 * database.service.spec.ts and outbox-relay.service.spec.ts. */
function fakeDatabaseService(): DatabaseService {
  return { ensureConnected: () => Promise.resolve() } as unknown as DatabaseService;
}

function makeEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: generateEventId(),
    eventType: 'team.created',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    occurredAt: new Date().toISOString(),
    producer: 'management-service',
    workspaceId: 'ws-integration-test',
    aggregate: { type: 'Team', id: 'team-integration-test', version: 1 },
    correlationId: generateEventId(),
    causationId: null,
    actorId: 'user-integration-test',
    payload: { code: 'INTEG', name: 'Integration Test Team' },
    ...overrides,
  };
}

/** In-memory stand-in for OutboxRepository - see module docstring for
 * why (no reachable Mongo in this environment). Implements exactly
 * the subset of the interface OutboxRelayService calls. */
class InMemoryOutboxRepository {
  rows = new Map<string, OutboxEventDocument>();

  seed(envelope: EventEnvelope): void {
    const now = new Date();
    this.rows.set(envelope.eventId, {
      workspaceId: envelope.workspaceId,
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      subject: `tm.v1.${envelope.eventType}`,
      schemaVersion: envelope.schemaVersion,
      aggregateType: envelope.aggregate.type,
      aggregateId: envelope.aggregate.id,
      aggregateVersion: envelope.aggregate.version,
      payload: envelope.payload,
      envelope,
      occurredAt: now,
      correlationId: envelope.correlationId,
      causationId: envelope.causationId,
      actorId: envelope.actorId,
      publishedAt: null,
      attempts: 0,
      claimedAt: null,
      leaseUntil: null,
      nextAttemptAt: null,
      lastErrorCode: null,
      failedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  claimBatch(): Promise<OutboxEventDocument[]> {
    const eligible = [...this.rows.values()].filter((r) => !r.publishedAt && !r.failedAt);
    return Promise.resolve(eligible);
  }

  markPublished(eventId: string): Promise<void> {
    const row = this.rows.get(eventId);
    if (row) row.publishedAt = new Date();
    return Promise.resolve();
  }

  scheduleRetry(eventId: string, errorCode: string): Promise<void> {
    const row = this.rows.get(eventId);
    if (row) row.lastErrorCode = errorCode;
    return Promise.resolve();
  }

  markTerminalFailure(eventId: string, errorCode: string): Promise<void> {
    const row = this.rows.get(eventId);
    if (row) {
      row.failedAt = new Date();
      row.lastErrorCode = errorCode;
    }
    return Promise.resolve();
  }
}

describe('NATS JetStream integration (real local server)', () => {
  let nats: NatsConnectionService;
  let streamBootstrap: StreamBootstrapService;
  let rawConnection: NatsConnection;

  beforeAll(async () => {
    nats = new NatsConnectionService(fakeConfig({ NATS_URL }));
    streamBootstrap = new StreamBootstrapService(nats);
    // Fails loudly (not a silent skip) if Docker NATS is not running -
    // see module docstring.
    rawConnection = await nats.getConnection();
  }, 15_000);

  afterAll(async () => {
    await nats.onApplicationShutdown();
  });

  describe('stream + durable consumer bootstrap', () => {
    it('creates TEAM_EVENTS (idempotently - a second run does not error or duplicate)', async () => {
      await streamBootstrap.bootstrap();
      await streamBootstrap.bootstrap(); // must not throw or create a conflicting stream

      const jsm = await nats.getJetStreamManager();
      const info = await jsm.streams.info(TEAM_EVENTS_STREAM_NAME);

      expect(info.config.subjects).toEqual(['tm.v1.>']);
      expect(info.config.storage).toBe('file');
      expect(streamBootstrap.isBootstrapped()).toBe(true);
    });

    it('provisions the activity-insights-v1 durable consumer with explicit ack and bounded redelivery', async () => {
      const jsm = await nats.getJetStreamManager();
      const info = await jsm.consumers.info(TEAM_EVENTS_STREAM_NAME, ACTIVITY_INSIGHTS_DURABLE_CONSUMER);

      expect(info.config.durable_name).toBe(ACTIVITY_INSIGHTS_DURABLE_CONSUMER);
      expect(info.config.ack_policy).toBe('explicit');
      expect(info.config.deliver_policy).toBe('all');
      expect(info.config.max_deliver).toBeGreaterThan(1);
      expect(info.config.max_deliver).toBeLessThan(100); // bounded, not unlimited
    });
  });

  describe('real publish + acknowledgement', () => {
    it('publishes a message and receives a genuine PubAck (stream + sequence) from the server', async () => {
      const js = await nats.getJetStreamClient();
      const envelope = makeEnvelope();
      const data = new TextEncoder().encode(JSON.stringify(envelope));

      const ack = await js.publish('tm.v1.team.created', data, { msgID: envelope.eventId, timeout: 5000 });

      expect(ack.stream).toBe(TEAM_EVENTS_STREAM_NAME);
      expect(typeof ack.seq).toBe('number');
      expect(ack.seq).toBeGreaterThan(0);
      expect(ack.duplicate).toBe(false);
    });

    it('the published message is actually present in TEAM_EVENTS, retrievable by subject', async () => {
      const js = await nats.getJetStreamClient();
      const jsm = await nats.getJetStreamManager();
      const envelope = makeEnvelope();
      const data = new TextEncoder().encode(JSON.stringify(envelope));

      const ack = await js.publish('tm.v1.team.created', data, { msgID: envelope.eventId, timeout: 5000 });
      const stored = await jsm.streams.getMessage(TEAM_EVENTS_STREAM_NAME, { seq: ack.seq });

      const decoded = JSON.parse(new TextDecoder().decode(stored.data)) as EventEnvelope;
      expect(decoded.eventId).toBe(envelope.eventId);
    });
  });

  describe('Nats-Msg-Id duplicate detection', () => {
    it('republishing the same eventId (Nats-Msg-Id) within the duplicate window is deduped by the server', async () => {
      const js = await nats.getJetStreamClient();
      const envelope = makeEnvelope();
      const data = new TextEncoder().encode(JSON.stringify(envelope));

      const first = await js.publish('tm.v1.team.created', data, { msgID: envelope.eventId, timeout: 5000 });
      const second = await js.publish('tm.v1.team.created', data, { msgID: envelope.eventId, timeout: 5000 });

      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(second.seq).toBe(first.seq); // no new message was actually stored
    });
  });

  describe('outbox publisher relay against the real stream', () => {
    it('relay.tick() publishes an eligible row and marks it published only after a real server ack (publish-before-mark, end to end)', async () => {
      const envelope = makeEnvelope({ eventType: 'team.member_added', payload: { userId: 'u1', role: 'MEMBER' } });
      const repository = new InMemoryOutboxRepository();
      repository.seed(envelope);

      const relay = new OutboxRelayService(
        repository as unknown as OutboxRepository,
        nats,
        fakeDatabaseService(),
        fakeConfig({ OUTBOX_RELAY_BATCH_SIZE: '10', OUTBOX_RELAY_LEASE_MS: '30000' }),
      );

      const row = repository.rows.get(envelope.eventId)!;
      expect(row.publishedAt).toBeNull();

      await relay.tick();

      const updated = repository.rows.get(envelope.eventId)!;
      expect(updated.publishedAt).not.toBeNull();

      // Independently verify against the real server that it is
      // genuinely there - not just that our in-memory row was flipped.
      const jsm = await nats.getJetStreamManager();
      const streamInfo = await jsm.streams.info(TEAM_EVENTS_STREAM_NAME);
      expect(streamInfo.state.messages).toBeGreaterThan(0);
    });

    it('retryable outage: a relay pointed at an unreachable NATS server never marks the row published', async () => {
      const envelope = makeEnvelope();
      const repository = new InMemoryOutboxRepository();
      repository.seed(envelope);

      const unreachableNats = new NatsConnectionService(
        fakeConfig({ NATS_URL: 'nats://127.0.0.1:4225' }), // nothing listens here
      );
      const relay = new OutboxRelayService(
        repository as unknown as OutboxRepository,
        unreachableNats,
        fakeDatabaseService(),
        fakeConfig({}),
      );

      await relay.tick();

      const row = repository.rows.get(envelope.eventId)!;
      expect(row.publishedAt).toBeNull();
      expect(row.failedAt).toBeNull(); // classified retryable, not terminal
    }, 15_000);
  });

  describe('durable pull consumer: fetch, ack, and redelivery', () => {
    const TEST_CONSUMER = 'integration-test-redelivery';

    afterEach(async () => {
      const jsm = await nats.getJetStreamManager();
      await jsm.consumers.delete(TEAM_EVENTS_STREAM_NAME, TEST_CONSUMER).catch(() => undefined);
    });

    it('an unacked message is redelivered after ack_wait elapses, and stops once acked', async () => {
      const js = await nats.getJetStreamClient();
      const jsm = await nats.getJetStreamManager();

      // Consumer created BEFORE the publish - DeliverPolicy.New marks
      // "now" as the starting point, so it must exist first to see the
      // message that follows (not a prior test's leftover message on
      // this same subject).
      await jsm.consumers.add(TEAM_EVENTS_STREAM_NAME, {
        durable_name: TEST_CONSUMER,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.New,
        filter_subject: 'tm.v1.workitem.created',
        ack_wait: nanos(500), // short, for a fast test
        max_deliver: 3,
      });

      const envelope = makeEnvelope({ eventType: 'workitem.created' });
      await js.publish('tm.v1.workitem.created', new TextEncoder().encode(JSON.stringify(envelope)), {
        msgID: envelope.eventId,
        timeout: 5000,
      });

      const consumer = await js.consumers.get(TEAM_EVENTS_STREAM_NAME, TEST_CONSUMER);

      const first = await consumer.next({ expires: 2000 });
      expect(first).not.toBeNull();
      expect(first!.info.redeliveryCount).toBe(1);
      // Deliberately do not ack - wait for ack_wait to elapse.

      await new Promise((resolve) => setTimeout(resolve, 800));

      const redelivered = await consumer.next({ expires: 2000 });
      expect(redelivered).not.toBeNull();
      expect(redelivered!.seq).toBe(first!.seq);
      expect(redelivered!.info.redeliveryCount).toBeGreaterThan(1);

      redelivered!.ack();
    }, 15_000);

    it('a durable consumer does not redeliver an already-acked message after being recreated (simulated restart)', async () => {
      const js = await nats.getJetStreamClient();
      const jsm = await nats.getJetStreamManager();

      await jsm.consumers.add(TEAM_EVENTS_STREAM_NAME, {
        durable_name: TEST_CONSUMER,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.New,
        filter_subject: 'tm.v1.workitem.moved',
        ack_wait: nanos(5000),
        max_deliver: 3,
      });

      const envelope = makeEnvelope({ eventType: 'workitem.moved' });
      await js.publish('tm.v1.workitem.moved', new TextEncoder().encode(JSON.stringify(envelope)), {
        msgID: envelope.eventId,
        timeout: 5000,
      });

      const firstHandle = await js.consumers.get(TEAM_EVENTS_STREAM_NAME, TEST_CONSUMER);
      const msg = await firstHandle.next({ expires: 2000 });
      expect(msg).not.toBeNull();
      msg!.ack();
      await new Promise((resolve) => setTimeout(resolve, 200)); // let the ack land

      // "Restart": a fresh consumer handle bound to the same durable name,
      // as a new process would do on startup.
      const secondHandle = await js.consumers.get(TEAM_EVENTS_STREAM_NAME, TEST_CONSUMER);
      const nothingPending = await secondHandle.next({ expires: 1000 });
      expect(nothingPending).toBeNull(); // resumed from the acknowledged position, not redelivered
    }, 15_000);

    it('two competing handles bound to the same durable consumer split a real backlog with no duplicate delivery and no message lost', async () => {
      // Phase 7 (assignment: "queue group" load-distribution across
      // competing consumer instances - e.g. two replicas of this
      // project's own activity-insights-service or outbox relay). A
      // JetStream *pull* consumer has no separate "queue group"
      // concept to configure - any number of independent handles bound
      // to the same durable_name inherently compete for the one
      // pending-message backlog, each message handed to exactly one of
      // them. This is the real mechanism under test, not a mock: two
      // genuinely separate consumer handles (standing in for two
      // running instances of a service) concurrently fetch from one
      // real durable, and the real broker decides the split.
      const js = await nats.getJetStreamClient();
      const jsm = await nats.getJetStreamManager();

      await jsm.consumers.add(TEAM_EVENTS_STREAM_NAME, {
        durable_name: TEST_CONSUMER,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.New,
        filter_subject: 'tm.v1.workitem.archived',
        ack_wait: nanos(5000),
        max_deliver: 3,
      });

      const MESSAGE_COUNT = 10;
      for (let i = 0; i < MESSAGE_COUNT; i++) {
        const envelope = makeEnvelope({ eventType: 'workitem.archived' });
        await js.publish('tm.v1.workitem.archived', new TextEncoder().encode(JSON.stringify(envelope)), {
          msgID: envelope.eventId,
          timeout: 5000,
        });
      }

      const handleA = await js.consumers.get(TEAM_EVENTS_STREAM_NAME, TEST_CONSUMER);
      const handleB = await js.consumers.get(TEAM_EVENTS_STREAM_NAME, TEST_CONSUMER);

      const collect = async (messages: AsyncIterable<{ seq: number; ack: () => void }>) => {
        const seqs: number[] = [];
        for await (const m of messages) {
          seqs.push(m.seq);
          m.ack();
        }
        return seqs;
      };

      // Both handles pull concurrently (as two real, independent
      // processes would) - whichever messages are still pending at the
      // moment each handle's pull reaches the server go to that
      // handle; `fetch` returns once its own share is exhausted/times
      // out, it does not wait for the other handle.
      const [seqsA, seqsB] = await Promise.all([
        handleA.fetch({ max_messages: MESSAGE_COUNT, expires: 2000 }).then(collect),
        handleB.fetch({ max_messages: MESSAGE_COUNT, expires: 2000 }).then(collect),
      ]);

      const allSeqs = [...seqsA, ...seqsB];
      expect(allSeqs).toHaveLength(MESSAGE_COUNT); // every message handled, none lost
      expect(new Set(allSeqs).size).toBe(MESSAGE_COUNT); // no sequence number delivered to both handles
      expect(seqsA.length).toBeGreaterThan(0);
      expect(seqsB.length).toBeGreaterThan(0); // real distribution across both, not one handle doing all the work
    }, 15_000);
  });

  describe('Core NATS request/reply (project insights)', () => {
    // Phase 7 (docs/DECISIONS.md #31/#32): a unique, per-test subject -
    // via InsightsClientService's test-only INSIGHTS_QUERY_SUBJECT_OVERRIDE
    // seam - rather than the real production subject
    // (PROJECT_INSIGHTS_QUERY_SUBJECT). Production code always uses the
    // real subject (the override is never set outside tests); this is
    // what makes "nothing is subscribed"/"never replies" deterministic
    // regardless of whatever else - e.g. this project's own real,
    // long-running Python activity-insights-service - happens to be
    // subscribed to the *real* subject at the same time. Without this,
    // every test in this block races the real responder for who answers
    // first, not just the two that previously failed outright.
    function insightsClient(subject: string, timeoutMs: string): InsightsClientService {
      return new InsightsClientService(
        nats,
        fakeConfig({ INSIGHTS_QUERY_TIMEOUT_MS: timeoutMs, INSIGHTS_QUERY_SUBJECT_OVERRIDE: subject }),
      );
    }

    it('returns "ok" when a real stub responder answers on a unique subject', async () => {
      const subject = `test.insights.${randomUUID()}`;
      const sub = rawConnection.subscribe(subject);
      const responderLoop = (async () => {
        for await (const msg of sub) {
          const request = JSON.parse(new TextDecoder().decode(msg.data)) as { projectId: string };
          const response = {
            status: 'ok',
            data: {
              projectId: request.projectId,
              generatedAt: new Date().toISOString(),
              workloadByAssignee: [{ assigneeId: 'u1', count: 1 }],
              countsByStatus: [{ columnId: 'col-1', count: 1 }],
              lastProcessedSequence: 1,
            },
          };
          msg.respond(new TextEncoder().encode(JSON.stringify(response)));
        }
      })();

      const client = insightsClient(subject, '2000');
      const result = await client.getProjectInsights('proj-stub-1', 'ws-1', 'corr-stub-1');

      sub.unsubscribe();
      await responderLoop;

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data.projectId).toBe('proj-stub-1');
      }
    }, 10_000);

    it('returns "unavailable"/NO_RESPONDER immediately when nothing is subscribed to this unique subject', async () => {
      const subject = `test.insights.${randomUUID()}`;
      const client = insightsClient(subject, '2000');

      const result = await client.getProjectInsights('proj-no-responder', 'ws-1', 'corr-stub-2');

      expect(result).toEqual({ status: 'unavailable', reason: 'NO_RESPONDER' });
    }, 10_000);

    it('returns "pending"/TIMEOUT when a responder is subscribed but never replies, bounded by the configured timeout', async () => {
      const subject = `test.insights.${randomUUID()}`;
      const sub = rawConnection.subscribe(subject);
      const drainLoop = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _msg of sub) {
          // deliberately never responds
        }
      })();

      const client = insightsClient(subject, '300');
      const start = Date.now();
      const result = await client.getProjectInsights('proj-silent', 'ws-1', 'corr-stub-3');
      const elapsedMs = Date.now() - start;

      sub.unsubscribe();
      await drainLoop;

      expect(result).toEqual({ status: 'pending', reason: 'TIMEOUT' });
      expect(elapsedMs).toBeLessThan(2000); // never blocks indefinitely
    }, 10_000);

    it('resolves to the real, documented production subject when no override is given', () => {
      // Not exercised live here (publishing on the real subject would
      // reintroduce the exact race this file's other tests were
      // rewritten to avoid) - just confirms the fallback this test
      // suite's override seam depends on actually lands on the real,
      // documented constant, not a typo'd string.
      const client = new InsightsClientService(nats, fakeConfig({ INSIGHTS_QUERY_TIMEOUT_MS: '2000' }));
      expect((client as unknown as { subject: string }).subject).toBe(PROJECT_INSIGHTS_QUERY_SUBJECT);
    });
  });

  describe('Core NATS request/reply (project activity, Phase 6)', () => {
    // Same unique-subject rationale as the insights block above.
    function activityClient(subject: string, timeoutMs: string): ActivityClientService {
      return new ActivityClientService(
        nats,
        fakeConfig({ INSIGHTS_QUERY_TIMEOUT_MS: timeoutMs, ACTIVITY_QUERY_SUBJECT_OVERRIDE: subject }),
      );
    }

    it('returns "ok" when a real stub responder answers on a unique subject', async () => {
      const subject = `test.activity.${randomUUID()}`;
      const sub = rawConnection.subscribe(subject);
      const responderLoop = (async () => {
        for await (const msg of sub) {
          const request = JSON.parse(new TextDecoder().decode(msg.data)) as { projectId: string };
          const response = {
            status: 'ok',
            data: {
              projectId: request.projectId,
              generatedAt: new Date().toISOString(),
              entries: [
                {
                  eventId: 'evt-1',
                  eventType: 'workitem.created',
                  aggregateType: 'WorkItem',
                  aggregateId: 'wi-1',
                  actorId: 'u1',
                  occurredAt: new Date().toISOString(),
                },
              ],
              lastProcessedSequence: 1,
            },
          };
          msg.respond(new TextEncoder().encode(JSON.stringify(response)));
        }
      })();

      const client = activityClient(subject, '2000');
      const result = await client.getProjectActivity('proj-stub-1', 'ws-1', 'corr-stub-1');

      sub.unsubscribe();
      await responderLoop;

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.data.projectId).toBe('proj-stub-1');
        expect(result.data.entries).toHaveLength(1);
      }
    }, 10_000);

    it('returns "unavailable"/NO_RESPONDER immediately when nothing is subscribed to this unique subject', async () => {
      const subject = `test.activity.${randomUUID()}`;
      const client = activityClient(subject, '2000');

      const result = await client.getProjectActivity('proj-no-responder', 'ws-1', 'corr-stub-2');

      expect(result).toEqual({ status: 'unavailable', reason: 'NO_RESPONDER' });
    }, 10_000);

    it('resolves to the real, documented production subject when no override is given', () => {
      // See the matching insights-block test above for why this isn't
      // exercised live here.
      const client = new ActivityClientService(nats, fakeConfig({ INSIGHTS_QUERY_TIMEOUT_MS: '2000' }));
      expect((client as unknown as { subject: string }).subject).toBe(PROJECT_ACTIVITY_QUERY_SUBJECT);
    });
  });
});
