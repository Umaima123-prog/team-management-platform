"""NATS connection helper.

Provides both the Core NATS connection (used for request/reply) and the
JetStream context (used for durable domain event consumption). No
subjects are subscribed to yet - this is Phase 1 scaffolding only.
"""

from __future__ import annotations

import nats
from nats.aio.client import Client as NatsClient
from nats.js import JetStreamContext

from .config import Settings


async def connect(settings: Settings) -> tuple[NatsClient, JetStreamContext]:
    nc = await nats.connect(settings.nats_url)
    js = nc.jetstream()
    return nc, js
