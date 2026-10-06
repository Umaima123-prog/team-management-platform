# Event Catalog

**Status: design catalog.** No publisher or consumer code exists yet
(Phase 1 scope is service skeletons + infra only). This document records
the planned JetStream subjects and the canonical envelope they will use,
so later phases implement against an agreed contract instead of each
inventing their own. Update the status of each row as events are
actually implemented - do not let this drift into describing events
that don't exist in code yet as if they do.

## Subject naming convention

```
tm.v1.<aggregate>.<event>
```

- `tm` - platform prefix.
- `v1` - envelope/subject schema version. A breaking change to an
  event's payload gets a new subject version (`tm.v2....`) rather than
  silently changing `v1` payloads.
- `<aggregate>` - the owning aggregate, singular, lower_snake_case.
- `<event>` - past-tense fact about what happened.

All of these subjects are published to JetStream (durable domain
events), never Core NATS - see `ARCHITECTURE.md`.

## Canonical event envelope

Every event published by the Management Service uses this envelope.
`payload` is the only part that varies per event type.

```json
{
  "event_id": "018f3b1a-7c2e-7c3e-9b1a-2f6f1a2e3c4d",
  "event_type": "tm.v1.workspace.created",
  "event_version": 1,
  "occurred_at": "2026-10-06T19:52:00.000Z",
  "aggregate_type": "workspace",
  "aggregate_id": "66f1c2a9e1b2c3d4e5f6a7b8",
  "aggregate_version": 1,
  "producer": "management-service",
  "correlation_id": "018f3b1a-4e21-7a3b-9c21-7e9a2b1c3d4f",
  "causation_id": null,
  "payload": {}
}
```

| Field               | Type           | Notes                                                                 |
|---------------------|----------------|------------------------------------------------------------------------|
| `event_id`          | string (UUID)  | Unique per event. This is the inbox dedup key on the consumer side.    |
| `event_type`        | string         | The JetStream subject the event is published on.                      |
| `event_version`     | integer        | Payload schema version for this `event_type`.                         |
| `occurred_at`       | string (ISO-8601, UTC) | When the change was committed in `management_db`.              |
| `aggregate_type`    | string         | e.g. `workspace`, `team`, `work_item`.                                |
| `aggregate_id`      | string         | Mongo `_id` of the affected aggregate.                                 |
| `aggregate_version` | integer        | Aggregate's version *after* this event, for consumers that care about ordering/staleness. |
| `producer`          | string         | Always `management-service` for now (single producer).                |
| `correlation_id`    | string (UUID)  | Ties together all events from the same originating command/request.   |
| `causation_id`      | string or null | `event_id` of the event that caused this one, if any (chained effects).|
| `payload`           | object         | Event-specific fields. Only new aggregate state needed by consumers - not a full document dump. |

## Planned subjects

All marked **planned** - none are published or consumed yet.

| Subject                          | Aggregate   | Meaning                                  | Status  |
|-----------------------------------|-------------|-------------------------------------------|---------|
| `tm.v1.workspace.created`         | workspace   | A workspace was created.                  | planned |
| `tm.v1.workspace.updated`         | workspace   | Workspace metadata changed.               | planned |
| `tm.v1.user.created`              | user        | A user account was created.               | planned |
| `tm.v1.user.updated`              | user        | User profile fields changed.              | planned |
| `tm.v1.team.created`              | team        | A team was created within a workspace.    | planned |
| `tm.v1.team.updated`              | team        | Team metadata changed.                    | planned |
| `tm.v1.membership.created`        | membership  | A user was added to a team/workspace.     | planned |
| `tm.v1.membership.removed`        | membership  | A user was removed from a team/workspace. | planned |
| `tm.v1.project.created`           | project     | A project was created within a workspace. | planned |
| `tm.v1.project.updated`           | project     | Project metadata changed.                 | planned |
| `tm.v1.board.created`             | board       | A board was created within a project.     | planned |
| `tm.v1.board.updated`             | board       | Board metadata changed.                   | planned |
| `tm.v1.column.created`            | column      | A column was added to a board.            | planned |
| `tm.v1.column.updated`            | column      | Column metadata changed.                  | planned |
| `tm.v1.column.reordered`          | column      | Column ordering within a board changed.   | planned |
| `tm.v1.work_item.created`         | work_item   | A work item was created on a board.       | planned |
| `tm.v1.work_item.updated`         | work_item   | Work item fields changed.                 | planned |
| `tm.v1.work_item.moved`           | work_item   | Work item moved between columns/boards.   | planned |
| `tm.v1.work_item.assigned`        | work_item   | Work item assignee changed.               | planned |
| `tm.v1.work_item.deleted`         | work_item   | A work item was deleted.                  | planned |

## Core NATS subjects (non-durable, request/reply)

Not JetStream, not in this catalog's versioning scheme - these are
synchronous queries answered by the Activity & Insights Service. None
are implemented yet either; naming convention is
`tm.v1.insights.<query>` and will be documented here once the first one
is built.
