"""Canonical version-1 event envelope - parsing and validation.

Mirrors services/management-service/src/messaging/events/envelope.ts
and envelope-validator.ts (docs/EVENT_CATALOG.md "Canonical event
envelope"). Every malformed/unsupported message must be routed to the
non-retryable failure/poison path (see messaging/errors.py and
messaging/processor.py) rather than retried - retrying a structurally
broken or unsupported event can never succeed. This module raises one
of three distinct, specifically-named errors so the processor/tests can
tell "doesn't parse" apart from "parses but declares an unsupported
schemaVersion" apart from "parses but names an eventType we don't
know" - three different documented test scenarios.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .subjects import EVENT_TYPES

CURRENT_SCHEMA_VERSION = 1


class EnvelopeValidationError(Exception):
    """The message body is not valid JSON, or does not have the
    canonical envelope's required fields/shape. Non-retryable."""


class UnsupportedSchemaVersionError(Exception):
    """The envelope parses, but declares a schemaVersion this consumer
    does not understand. Non-retryable - per docs/EVENT_CATALOG.md,
    "a value other than 1 is rejected, not silently accepted"."""

    def __init__(self, schema_version: int) -> None:
        self.schema_version = schema_version
        super().__init__(
            f"Unsupported schemaVersion {schema_version}; this consumer only "
            f"understands version {CURRENT_SCHEMA_VERSION}."
        )


class UnknownEventTypeError(Exception):
    """The envelope parses and declares a supported schemaVersion, but
    eventType is outside the documented catalogue (docs/EVENT_CATALOG.md).
    Non-retryable - a type we don't recognize can never be processed
    correctly by retrying."""

    def __init__(self, event_type: str) -> None:
        self.event_type = event_type
        super().__init__(f'Unknown eventType "{event_type}".')


class AggregateRef(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    id: str
    version: int = Field(ge=1)

    @field_validator("type", "id")
    @classmethod
    def _non_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("must not be empty")
        return value


class EventEnvelope(BaseModel):
    """The canonical fact envelope. `extra="allow"` deliberately: a
    future, additive field on the envelope must never make an
    otherwise-valid event malformed in this consumer's eyes (forward
    compatibility) - only a missing/wrong-typed *required* field does."""

    model_config = ConfigDict(extra="allow")

    eventId: str
    eventType: str
    schemaVersion: int
    occurredAt: str
    producer: str
    workspaceId: str
    aggregate: AggregateRef
    correlationId: str
    causationId: str | None = None
    actorId: str
    payload: dict[str, Any]

    @field_validator("eventId", "workspaceId", "correlationId", "actorId", "eventType", "producer")
    @classmethod
    def _non_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("must not be empty")
        return value


def parse_envelope(raw: bytes) -> EventEnvelope:
    """Parse and fully validate a raw NATS message body into the
    canonical envelope. Always raises one of this module's three
    specific error types on any problem - never lets a bare
    UnicodeDecodeError/json.JSONDecodeError/pydantic.ValidationError
    escape - so callers can classify deterministically.
    """
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EnvelopeValidationError(f"Message body is not valid UTF-8 ({exc}).") from exc

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise EnvelopeValidationError(f"Message body is not valid JSON ({exc}).") from exc

    try:
        envelope = EventEnvelope.model_validate(data)
    except ValidationError as exc:
        raise EnvelopeValidationError(str(exc)) from exc

    if envelope.schemaVersion != CURRENT_SCHEMA_VERSION:
        raise UnsupportedSchemaVersionError(envelope.schemaVersion)

    if envelope.eventType not in EVENT_TYPES:
        raise UnknownEventTypeError(envelope.eventType)

    return envelope
