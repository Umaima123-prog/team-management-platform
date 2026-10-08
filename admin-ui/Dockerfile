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

# Vite inlines import.meta.env.VITE_* at BUILD time, reading it from
# this build step's own process.env - Railway passes service variables
# to a Dockerfile build as --build-arg, but only for names explicitly
# declared with ARG here; without this, `npm run build` below never
# saw the real value and silently fell back to the client's own
# `http://localhost:3000` default (the real bug behind "Could not
# reach the server" - the browser was never pointed at
# management-service's real public URL in the first place).
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY . .
RUN npm install && npm run build

ENV NODE_ENV=production

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "8080"]
