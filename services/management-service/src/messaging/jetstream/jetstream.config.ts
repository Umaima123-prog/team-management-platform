import {
  AckPolicy,
  ConsumerConfig,
  DeliverPolicy,
  DiscardPolicy,
  nanos,
  ReplayPolicy,
  RetentionPolicy,
  StorageType,
  StreamConfig,
} from 'nats';
import {
  ACTIVITY_INSIGHTS_DURABLE_CONSUMER,
  TEAM_EVENTS_STREAM_NAME,
  TEAM_EVENTS_SUBJECT_FILTER,
} from '../events/subjects';

/**
 * TEAM_EVENTS stream configuration (assignment PDF section 8 + 15,
 * docs/ARCHITECTURE.md "JetStream").
 *
 * Retention decision (explicitly chosen, not mandated by the
 * assignment - it only says "a documented retention policy"):
 * `limits` retention with a 14-day max age and a byte ceiling at the
 * `nats-server.conf` file-store cap (10GB, see docker/nats/). 14 days
 * comfortably covers this exercise's demo/replay needs (restart the
 * Python consumer and replay recent history) while bounding local disk
 * use indefinitely, which an "unlimited" retention would not. A real
 * production deployment with a durable consumer that reliably keeps
 * pace could use a shorter age or rely entirely on consumer ack
 * position instead of stream-level expiry; this is a documented
 * development-exercise trade-off, not a claim that 14 days is
 * universally correct.
 *
 * `duplicate_window` (broker-level Nats-Msg-Id dedup horizon) is set
 * to 2 hours - longer than the default 2 minutes - so that a relay
 * crash-and-restart within a normal operational window still gets
 * deduped by JetStream itself before falling back to the Python
 * inbox's dedup (the actual source of correctness - see
 * docs/DECISIONS.md #3/#4). This is a convenience optimization, not
 * the system's primary at-least-once safety net.
 */
export function buildTeamEventsStreamConfig(): Partial<StreamConfig> {
  return {
    name: TEAM_EVENTS_STREAM_NAME,
    subjects: [TEAM_EVENTS_SUBJECT_FILTER],
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    discard: DiscardPolicy.Old,
    max_age: nanos(14 * 24 * 60 * 60 * 1000),
    max_bytes: -1,
    max_msgs: -1,
    max_msgs_per_subject: -1,
    max_consumers: -1,
    duplicate_window: nanos(2 * 60 * 60 * 1000),
    num_replicas: 1,
  };
}

/** Fields that, if they differ from an existing stream, mean the
 * existing stream is a genuinely incompatible prior configuration that
 * must NOT be silently overwritten (see stream-bootstrap.service.ts -
 * "idempotent must not create conflicting streams or silently replace
 * incompatible config"). */
export const STREAM_STRUCTURAL_FIELDS = ['subjects', 'storage', 'retention'] as const;

/**
 * Durable pull consumer for the Python Activity & Insights service
 * (assignment-mandated name: activity-insights-v1). Phase 4
 * provisions/validates this configuration only - the Python consumer
 * loop itself is Phase 5 (see docs/ARCHITECTURE.md).
 *
 * - ack_policy Explicit: the consumer must ack each message
 *   individually, only after its inbox+projection write succeeds
 *   (docs/DECISIONS.md #4) - never auto-ack-on-receipt.
 * - deliver_policy All: a fresh/rebuilt consumer replays the full
 *   retained history, matching "Support replay into a clean
 *   projection" (assignment section 10).
 * - max_deliver 5 with exponential backoff: bounded redelivery for a
 *   transient consumer-side failure. After 5 attempts NATS stops
 *   redelivering and the message is the Python service's
 *   responsibility to record in `processing_failures` (Phase 5) -
 *   this is the documented poison-message / dead-letter boundary (see
 *   docs/ARCHITECTURE.md "Failure / poison policy").
 * - ack_wait 30s: how long a delivered-but-unacked message waits
 *   before being considered for redelivery.
 */
export function buildActivityInsightsConsumerConfig(): Partial<ConsumerConfig> {
  return {
    durable_name: ACTIVITY_INSIGHTS_DURABLE_CONSUMER,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    replay_policy: ReplayPolicy.Instant,
    max_deliver: 5,
    ack_wait: nanos(30_000),
    backoff: [nanos(1_000), nanos(5_000), nanos(30_000), nanos(120_000)],
    max_ack_pending: 500,
  };
}
