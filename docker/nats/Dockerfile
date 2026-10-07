# Railway deployment of the official nats:2.10-alpine image, with
# JetStream enabled via a baked-in config file - see railway.conf and
# docs/DECISIONS.md for why a custom start command alone doesn't work
# for a Docker-image-sourced Railway service.
FROM nats:2.10-alpine

COPY railway.conf /etc/nats/nats-server.conf
