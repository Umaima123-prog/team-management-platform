# Admin UI (Phase 6)

An AdminLTE-style admin UI for the Team Management Platform - teams,
projects, a Kanban board, a work-item drawer, the real asynchronous
activity timeline, and real insights. Talks only to the real NestJS
Management Service's REST API; never reads `insights_db` or NATS
directly from the browser - see
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) "Trust boundary".

## Stack, and why

React + TypeScript + Vite, styled with hand-rolled CSS
(`src/styles/app.css`) built on Bootstrap 5 rather than the real
`admin-lte` npm package. Real AdminLTE ships jQuery plugins that
directly mutate the DOM (sidebar toggle, etc.) - a model that actively
fights React's own DOM ownership and would make the drag/drop, filter,
and keyboard-navigation tests this phase requires far harder to write
and trust. This keeps AdminLTE's actual visual language (dark sidebar,
boxed content cards, small-box dashboard stat widgets) without a
jQuery dependency - see `docs/DECISIONS.md` #23 for the full reasoning.

## Local development

Requires the real Management Service running locally (see the
repo-root README) with CORS allowing this app's origin -
`ADMIN_UI_ORIGIN` in `services/management-service/.env`, default
`http://localhost:5173` (this app's default Vite dev port - no
`.env` needed here unless you've changed `PORT` on the API side, in
which case set `VITE_API_BASE_URL`).

```bash
npm install
npm run dev
```

There is no real authentication (see `docs/ARCHITECTURE.md` "Request
context / trust model") - on first load you'll be asked for a user id.
Get one from the Management Service's `npm run seed` output (or any
real user id already in your workspace). Once signed in, switch
between every user in that workspace from the topbar dropdown.

## Testing

```bash
npm run test       # vitest run (add -- --watch to watch)
npm run build       # tsc -b && vite build - type-checks everything under src/, including tests
npm run lint         # oxlint
```

Tests use Vitest + React Testing Library against a mocked `fetch`
(`src/test/mockApi.ts`) - no real server required to run them, but
every mocked response shape is the real documented contract
(`docs/API.md`), and the real NestJS/Python integration is covered
separately by each service's own real-NATS/real-Atlas test suites and
by this phase's manual live verification (see `docs/TIMELOG.md`
Phase 6 notes).

## Key behaviors worth knowing about

- **Card movement is never a frontend-only state change.** Every
  drag/drop or keyboard move sends `expectedVersion` to the real
  `POST /api/items/:itemId/move` endpoint, shows a pending state on
  the card while the request is in flight, and only keeps the new
  position once the server confirms it - a non-conflict failure rolls
  back to the pre-move state, and a 409 refreshes the whole board and
  shows a clear message (`src/pages/board/useBoardItems.ts`).
- **Every card has a non-drag way to move it** (up/down buttons plus a
  "Move to…" column select) - dragging is never the only way.
- **Assignee pickers are restricted to the project's owning team's
  members** in the UI, matching (never replacing) the server's own
  `assertAssigneeEligible` check.
- **Insights/Activity are explicit about eventual consistency** -
  `not_ready`/`pending`/`unavailable` are rendered distinctly from
  `ok`, never silently blank or faked as instantly consistent.
- User-authored content (titles, descriptions, labels) is rendered as
  plain text only - this app never uses `dangerouslySetInnerHTML`.
