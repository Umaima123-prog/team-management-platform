"""A minimal, in-memory stand-in for the small slice of the Motor/
PyMongo API this service's repositories actually use.

Mirrors the Management Service's own testing precedent
(test/nats-integration.e2e-spec.ts's InMemoryOutboxRepository): no
real MongoDB is required to exercise the actual production repository/
processor code paths, including the subtle bits (version-gated
conditional upsert, DuplicateKeyError-on-stale-version, transaction
callback semantics) - this is NOT a generic MongoDB emulator, only
exactly what projections/*.py, inbox/repository.py,
failures/repository.py, and consumer_state.py call.
"""

from __future__ import annotations

import copy
import itertools
from typing import Any

from pymongo.errors import DuplicateKeyError


def _matches(doc: dict[str, Any], filt: dict[str, Any]) -> bool:
    for key, expected in filt.items():
        actual = doc.get(key)
        if isinstance(expected, dict) and any(k.startswith("$") for k in expected):
            for op, operand in expected.items():
                if op == "$lt" and not (actual is not None and actual < operand):
                    return False
                if op == "$lte" and not (actual is not None and actual <= operand):
                    return False
                if op == "$gt" and not (actual is not None and actual > operand):
                    return False
                if op == "$gte" and not (actual is not None and actual >= operand):
                    return False
                if op == "$eq" and actual != operand:
                    return False
                if op == "$ne" and actual == operand:
                    return False
                if op == "$in" and actual not in operand:
                    return False
        else:
            if actual != expected:
                return False
    return True


def _apply_set(doc: dict[str, Any], update: dict[str, Any]) -> None:
    for key, value in update.get("$set", {}).items():
        doc[key] = value
    for key, value in update.get("$inc", {}).items():
        doc[key] = doc.get(key, 0) + value


def _equality_seed(filt: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in filt.items() if not isinstance(v, dict)}


class FakeCursor:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self._docs = docs

    def limit(self, n: int) -> FakeCursor:
        self._docs = self._docs[:n]
        return self

    def __aiter__(self) -> FakeCursor:
        self._iter = iter(self._docs)
        return self

    async def __anext__(self) -> dict[str, Any]:
        try:
            return next(self._iter)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


def _project(doc: dict[str, Any], projection: dict[str, Any] | None) -> dict[str, Any]:
    result = copy.deepcopy(doc)
    if not projection:
        return result
    if all(v == 0 for v in projection.values()):
        for key in projection:
            result.pop(key, None)
        return result
    included = {k: result[k] for k in projection if k in result and projection[k]}
    if "_id" in result and projection.get("_id", 1):
        included["_id"] = result["_id"]
    return included


class FakeCollection:
    def __init__(self) -> None:
        self._docs: dict[Any, dict[str, Any]] = {}
        self._unique_keys: list[tuple[str, ...]] = []
        self._id_seq = itertools.count(1)

    def declare_unique(self, *fields: str) -> None:
        self._unique_keys.append(fields)

    def _check_unique(self, doc: dict[str, Any], *, ignore_id: Any = object()) -> None:
        for fields in self._unique_keys:
            candidate = tuple(doc.get(f) for f in fields)
            for existing_id, existing in self._docs.items():
                if existing_id == ignore_id:
                    continue
                if tuple(existing.get(f) for f in fields) == candidate:
                    raise DuplicateKeyError(f"duplicate key on {fields}: {candidate}")

    async def find_one(
        self,
        filt: dict[str, Any],
        projection: dict[str, Any] | None = None,
        sort: list[tuple[str, int]] | None = None,
        session: Any = None,
    ) -> dict[str, Any] | None:
        matches = [d for d in self._docs.values() if _matches(d, filt)]
        if sort:
            for field, direction in reversed(sort):
                matches.sort(key=lambda d: d.get(field), reverse=(direction < 0))
        if not matches:
            return None
        return _project(matches[0], projection)

    def find(
        self,
        filt: dict[str, Any] | None = None,
        projection: dict[str, Any] | None = None,
        sort: list[tuple[str, int]] | None = None,
        session: Any = None,
    ) -> FakeCursor:
        filt = filt or {}
        docs = [d for d in self._docs.values() if _matches(d, filt)]
        if sort:
            for field, direction in reversed(sort):
                docs.sort(key=lambda d: d.get(field), reverse=(direction < 0))
        matches = [_project(d, projection) for d in docs]
        return FakeCursor(matches)

    async def insert_one(self, doc: dict[str, Any], session: Any = None) -> None:
        _id = doc.get("_id", f"auto-{next(self._id_seq)}")
        if _id in self._docs:
            raise DuplicateKeyError(f"duplicate _id: {_id}")
        self._check_unique(doc)
        stored = copy.deepcopy(doc)
        stored["_id"] = _id
        self._docs[_id] = stored

    async def update_one(
        self,
        filt: dict[str, Any],
        update: dict[str, Any],
        *,
        upsert: bool = False,
        session: Any = None,
    ) -> None:
        matches = [(k, d) for k, d in self._docs.items() if _matches(d, filt)]
        if matches:
            key, doc = matches[0]
            _apply_set(doc, update)
            self._docs[key] = doc
            return

        if not upsert:
            return

        new_doc = _equality_seed(filt)
        for key, value in update.get("$setOnInsert", {}).items():
            new_doc.setdefault(key, value)
        _apply_set(new_doc, update)
        _id = new_doc.get("_id", f"auto-{next(self._id_seq)}")
        new_doc["_id"] = _id
        self._docs[_id] = new_doc

    async def drop_index(self, name: str) -> None:
        return None

    async def create_indexes(self, indexes: list[Any]) -> None:
        for index in indexes:
            doc = index.document
            if doc.get("unique"):
                self.declare_unique(*doc["key"].keys())


class FakeDatabase:
    def __init__(self) -> None:
        self._collections: dict[str, FakeCollection] = {}

    def __getitem__(self, name: str) -> FakeCollection:
        return self._collections.setdefault(name, FakeCollection())


class FakeSession:
    def __init__(self) -> None:
        self.ended = False

    async def with_transaction(self, coro: Any) -> Any:
        return await coro(self)

    async def end_session(self) -> None:
        self.ended = True


class FakeMongoClient:
    async def start_session(self) -> FakeSession:
        return FakeSession()
