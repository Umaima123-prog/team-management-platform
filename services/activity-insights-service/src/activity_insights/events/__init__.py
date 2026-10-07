"""Canonical event envelope (shape + validation) and the subject/event
catalogue this consumer understands - the Python-side mirror of the
Management Service's src/messaging/events/ (TypeScript). Kept as a
hand-written mirror, not a shared package, because the two services are
intentionally decoupled (docs/ARCHITECTURE.md "Trust boundary") - the
only thing that must actually agree is the wire contract documented in
docs/EVENT_CATALOG.md.
"""
