import { ulid } from 'ulid';

/**
 * Globally-unique, time-sortable event id (ULID - Crockford base32,
 * 48-bit millisecond timestamp + 80 bits of randomness). This is the
 * `eventId` used as the Mongo outbox `_id`-adjacent unique key, the
 * JetStream `Nats-Msg-Id` (broker-level dedup), and the Python
 * service's future inbox dedup key - see docs/DECISIONS.md #3.
 *
 * ULID (not a plain UUID v4) so eventIds sort chronologically by
 * creation time, which is convenient for debugging the outbox/stream
 * without needing a separate index just to answer "what order were
 * these created in."
 */
export function generateEventId(): string {
  return ulid();
}
