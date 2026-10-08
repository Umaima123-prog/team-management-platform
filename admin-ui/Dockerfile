# Railway build - explicit Dockerfile, not Nixpacks' automatic install
# phase.
#
# Why: Nixpacks' automatic phase runs `npm ci`, which hit a
# well-documented npm bug (npm/cli#4828) here - optional,
# platform-specific native dependencies (@rolldown/binding-*, the
# Rust-based Vite bundler's prebuilt binary) were not installed even
# though they were correctly present in package-lock.json, and npm's
# own error message names the fix: use `npm install` instead of
# `npm ci`. A Dockerfile gives direct control over that one command;
# nothing else about the build changed.
FROM node:22-slim

WORKDIR /app

COPY . .
RUN npm install && npm run build

ENV NODE_ENV=production

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "8080"]
