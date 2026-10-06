# Decisions

Concise architecture decision records. Each entry: decision, why, and
what it rules out. Update this file instead of leaving a decision only
implicit in code.

## 1. Service boundaries: one writer per database

**Decision:** Management Service (NestJS/TypeScript) is the sole writer
of `management_db` (workspaces, users, teams, memberships, projects,
boards, columns, work items, outbox). Activity & Insights Service
(Python) is the sole writer of `insights_db` (inbox, activity
projection, workload projection, processing failures). Neither service
ever reads the other's collections directly.

**Why:** A single writer per database is what makes "who changed this
and when" unambiguous, and lets each service evolve its schema without
coordinating migrations with the other. Python benefits from its data
ecosystem for analytics/projections without needing to touch Node's
business logic, and vice versa.

**Rules out:** shared ORM/connection between services, Python querying
`management_db` "just for a quick read," any future service writing to
a collection it doesn't own.

## 2. Core NATS vs JetStream

**Decision:** Durable domain events (anything another service's state
depends on) go through JetStream. Synchronous point-in-time queries
(e.g. "give me this workspace's current workload") use Core NATS
request/reply.

**Why:** JetStream's persistence and redelivery are needed exactly
where losing a message would corrupt downstream state. For a query, a
timeout-on-no-responder is an acceptable, cheap failure mode, and
forcing it through JetStream would add latency and operational
complexity for no durability benefit (nothing needs to be replayed -
if the query fails, the caller just asks again).

**Rules out:** publishing domain events over Core NATS "because it's
simpler," building queries on top of JetStream consumers.

## 3. Outbox (Management Service) + inbox (Python service)

**Decision:** Management Service writes the aggregate change and an
outbox record in the same MongoDB transaction; a relay publishes outbox
rows to JetStream. Python service writes an inbox record (keyed by
`event_id`) before/with applying each projection, and only acks after
both succeed.

**Why:** MongoDB transactions can't span into NATS, so "mutate state and
emit an event" can't be a single atomic operation across the two
systems. The outbox makes the Mongo-side half of that atomic; the inbox
makes redelivery safe on the Python side. Together they're what let us
guarantee at-least-once without ever silently losing or double-applying
a change.

**Rules out:** publishing events directly from request handlers without
an outbox (risks "event sent but transaction rolled back" or vice
versa), Python processing an event without checking for a duplicate
first.

## 4. At-least-once delivery, idempotent consumers, no exactly-once claim

**Decision:** All JetStream consumers use manual ack, acknowledging only
after their work (inbox write + projection write) is durably persisted.
We explicitly do not claim, design for, or document exactly-once
delivery anywhere in this system.

**Why:** Exactly-once delivery across a network is not a thing NATS (or
most messaging systems) actually provides end-to-end; claiming it would
be false and would let a future implementer skip the idempotency work
that's actually required. At-least-once + idempotent consumers gives
the same practical outcome (no lost updates, no duplicate side effects)
without the false guarantee.

**Rules out:** auto-ack on receipt, any doc or comment claiming
"exactly-once," consumer logic that assumes an event is seen only once.

## 5. Security posture for Phase 1 skeleton

**Decision:** The only HTTP endpoint that exists in Phase 1 is an
unauthenticated `GET /health` on the Management Service. No admin or
operational endpoints exist yet; authentication, authorization, and
rate limiting are deferred until the first real public API is added,
and must be designed in before that API ships (not bolted on after).

**Why:** A liveness/readiness probe is conventionally left
unauthenticated (it has no business data to protect and is usually
called by infrastructure, not users); there is nothing else to protect
yet. Explicitly recording the deferral - rather than leaving it
unstated - means it's a tracked decision, not a thing that gets
forgotten when the first real endpoint is added.

**Rules out:** treating `/health` as a precedent for shipping later
business endpoints without auth/rate limiting.
