"""Event consumption, processing, and the Core NATS insights responder.

- `errors.py`: processing-error classification (transient vs
  non-retryable) - the Python mirror of the Management Service's
  relay/retry-policy.ts.
- `processor.py`: `EventProcessor` - per-message orchestration (parse,
  dedupe, project, record, ack-eligibility decision).
- `consumer.py`: `EventConsumer` - the durable pull-consumer loop
  bound to `activity-insights-v1` on `TEAM_EVENTS`.
- `responder.py`: `InsightsResponder` - the Core NATS request/reply
  responder for `tm.query.v1.project_insights`.
"""
