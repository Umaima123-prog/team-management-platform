# Railway build - standard Debian-based Node, not Nixpacks/Railpack.
#
# Why: Nixpacks' Nix-packaged Node runtime was negotiating TLS with
# MongoDB Atlas incorrectly (nats.js.errors-equivalent was NOT the
# issue here - this is the Node/Mongo driver side - every connection
# attempt failed with [SSL: TLSV1_ALERT_INTERNAL_ERROR] *before* any
# credential was ever evaluated, while the exact same MONGODB_URI
# connected fine - got as far as a real auth response - from a plain
# Debian/Windows network). A standard Debian base with its own
# well-tested OpenSSL avoids that runtime-specific TLS stack entirely.
# No application code, dependency versions, or Mongo connection logic
# changed - only the OS/runtime the already-existing build/start
# commands run on top of.
FROM node:22-slim

# CA certificates so TLS connections (MongoDB Atlas, NATS over TLS if
# ever enabled) can verify server certificates normally - never
# disabled/bypassed anywhere in this image or in application code.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .
RUN npm ci && npm run build

ENV NODE_ENV=production

CMD ["npm", "run", "start:prod"]
