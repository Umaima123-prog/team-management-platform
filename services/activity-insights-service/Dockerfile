# Railway build - standard Debian-based Python, not Nixpacks/Railpack.
#
# Why: Railway's Nixpacks builder runs this service on a Nix-packaged
# Python (confirmed in its own crash traceback:
# /root/.nix-profile/lib/python3.12/...) whose bundled OpenSSL
# negotiates TLS with MongoDB Atlas incorrectly - every connection
# failed with pymongo.errors.ServerSelectionTimeoutError
# ([SSL: TLSV1_ALERT_INTERNAL_ERROR]) *before* any credential was ever
# evaluated, while the exact same MONGODB_URI reached a real auth
# response (bad auth, not a TLS error) from a plain Debian/Windows
# network. A standard python:3.12-slim (Debian) base carries its own
# well-tested OpenSSL build, avoiding that runtime-specific TLS stack
# entirely. No application code, dependency versions, or Mongo
# connection logic changed - only the OS/runtime underneath the
# already-existing `pip install -r requirements.txt` /
# `python -m activity_insights.main` commands.
FROM python:3.12-slim

# CA certificates so TLS connections (MongoDB Atlas, NATS over TLS if
# ever enabled) can verify server certificates normally - never
# disabled/bypassed anywhere in this image or in application code.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# requirements.txt's first line (`-e .`) installs this project itself
# in editable mode, which needs pyproject.toml/src/ present - so the
# full source is copied before installing, same as every other phase
# of this project's own documented packaging fix (docs/DECISIONS.md).
COPY . .
RUN pip install --no-cache-dir -r requirements.txt

CMD ["python", "-m", "activity_insights.main"]
