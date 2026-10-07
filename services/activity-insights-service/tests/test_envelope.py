import json

import pytest

from activity_insights.events.envelope import (
    CURRENT_SCHEMA_VERSION,
    EnvelopeValidationError,
    UnknownEventTypeError,
    UnsupportedSchemaVersionError,
    parse_envelope,
)


def _valid_envelope(**overrides: object) -> dict:
    base = {
        "eventId": "evt_01",
        "eventType": "team.created",
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "occurredAt": "2026-10-07T00:00:00.000Z",
        "producer": "management-service",
        "workspaceId": "ws_1",
        "aggregate": {"type": "Team", "id": "team_1", "version": 1},
        "correlationId": "corr_1",
        "causationId": None,
        "actorId": "user_1",
        "payload": {"code": "ENG", "name": "Engineering"},
    }
    base.update(overrides)
    return base


def test_valid_envelope_parses() -> None:
    envelope = parse_envelope(json.dumps(_valid_envelope()).encode("utf-8"))
    assert envelope.eventId == "evt_01"
    assert envelope.eventType == "team.created"
    assert envelope.aggregate.version == 1


def test_malformed_json_is_envelope_validation_error() -> None:
    with pytest.raises(EnvelopeValidationError):
        parse_envelope(b"{not json")


def test_missing_required_field_is_envelope_validation_error() -> None:
    bad = _valid_envelope()
    del bad["workspaceId"]
    with pytest.raises(EnvelopeValidationError):
        parse_envelope(json.dumps(bad).encode("utf-8"))


def test_wrong_typed_field_is_envelope_validation_error() -> None:
    bad = _valid_envelope(aggregate={"type": "Team", "id": "team_1", "version": "not-a-number"})
    with pytest.raises(EnvelopeValidationError):
        parse_envelope(json.dumps(bad).encode("utf-8"))


def test_unsupported_schema_version_is_rejected() -> None:
    bad = _valid_envelope(schemaVersion=2)
    with pytest.raises(UnsupportedSchemaVersionError):
        parse_envelope(json.dumps(bad).encode("utf-8"))


def test_unknown_event_type_is_rejected() -> None:
    bad = _valid_envelope(eventType="workitem.teleported")
    with pytest.raises(UnknownEventTypeError):
        parse_envelope(json.dumps(bad).encode("utf-8"))
