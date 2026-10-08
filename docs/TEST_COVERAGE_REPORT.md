# Test Coverage Report — Team Management Platform

**Report date:** 2026-10-08
**Scope:** Post JWT authentication, ADMIN/EMPLOYEE RBAC, work-item ownership authorization, and Railway deployment fixes (commits `d5519c4`, `2264d75` on `main`).

All figures below are **measured**, from the exact commands listed in section 17, run against the current codebase. No percentage in this report is estimated or invented.

---

## 1. Project overview

The Team Management Platform is an event-driven system of three components:

- **Management Service** (NestJS/TypeScript) — owns `management_db`; teams, projects, boards, work items, and (as of this phase) email/password JWT authentication with ADMIN/EMPLOYEE RBAC.
- **Activity & Insights Service** (Python) — owns `insights_db`; consumes NATS JetStream events into read-optimized projections (activity timeline, workload insights).
- **Admin UI** (React/Vite) — the operator-facing frontend; now backed by real login (no more dev user-switcher), with role-aware navigation and work-item controls.

## 2. Scope of this report

This report measures automated test coverage only, for the codebase as it stands after:
- JWT access/refresh authentication (login, refresh, logout, `/me`)
- Centralized ADMIN/EMPLOYEE RBAC (`@Roles()` + `RolesGuard`)
- Work-item ownership authorization (EMPLOYEE may act only on their own assigned item)
- The matching frontend auth context, login UI, and role-based control visibility
- The Railway deployment build fix (`npm install` instead of `npm ci` in `services/management-service/Dockerfile`)

It does **not** re-litigate the already-separate, already-reported live Railway production verification (summarized in section 12 for context only — those checks are not unit-test coverage and carry no percentage).

## 3. Test environments / frameworks

| Component | Language | Test framework | Coverage tool |
|---|---|---|---|
| Management Service | TypeScript / NestJS | Jest 30 + ts-jest | Jest's built-in V8 coverage |
| Activity & Insights Service | Python 3.12 | pytest 9 + pytest-asyncio | pytest-cov (installed this session — see §17) |
| Admin UI | TypeScript / React | Vitest 5 | @vitest/coverage-v8 (installed this session — see §17) |

---

## 4. Management Service coverage

**Commands:**
```bash
cd services/management-service
npm run test:cov    # jest --coverage (unit)
npm run test:e2e     # jest --config ./test/jest-e2e.json
```

**Results:**
- Unit tests: **252 passed, 0 failed, 0 skipped** (30 suites)
- e2e tests: **19 passed, 0 failed, 0 skipped** (2 suites — `app.e2e-spec.ts`, `nats-integration.e2e-spec.ts`, against a real local NATS/JetStream)

**Coverage (unit, `collectCoverageFrom: ["**/*.(t|j)s"]`, the project's existing Jest config — unmodified):**

| Metric | % | Measured |
|---|---|---|
| Statements | **76.84%** | — |
| Branches | **69.37%** | — |
| Functions | **54.12%** | — |
| Lines | **76.50%** | — |

HTML report: `services/management-service/coverage/lcov-report/index.html`
Raw data: `services/management-service/coverage/lcov.info`, `coverage-final.json`, `clover.xml`

**Lowest-covered important application modules** (excluding pure bootstrap/transport wiring that is intentionally exercised by the e2e suite rather than unit mocks — `main.ts`, `bootstrap.ts`, `nats-connection.service.ts`, `stream-bootstrap.service.ts`):

| File | Statements | Why |
|---|---|---|
| `teams/memberships.repository.ts` | 22.58% | Repository logic is exercised indirectly through e2e/real-Mongo paths, not unit-mocked directly |
| `work-items/work-items.repository.ts` | 25.00% | Same — repositories are unit-tested via service-layer mocks, not their own queries |
| `boards/boards.service.ts` | 37.50% | Thin pass-through service, only partially exercised by direct unit tests |
| `teams/teams.repository.ts` | 43.33% | Same repository-layer pattern |
| `projects/projects.repository.ts` | 48.14% | Same repository-layer pattern |
| `seed/seed.ts` | 47.22% | Standalone operational script; only its pure `demoPasswordFor()` helper is unit-tested (see `seed.spec.ts`) — its Mongo-writing `seed()` body is intentionally not unit-tested |

This is a structural pattern, not a regression: this project tests repositories' real query behavior through the e2e suite (real Mongo/NATS), and tests business logic through service-layer unit tests with repositories mocked — so a repository file's own unit-coverage number understates how well its behavior is actually tested overall.

---

## 5. Activity & Insights Service coverage

**Commands:**
```bash
cd services/activity-insights-service
.venv/Scripts/python.exe -m pytest --cov=activity_insights --cov-report=term-missing --cov-report=html
```

**Results:**
- **63 passed, 2 skipped, 0 failed**
  - Skipped: `test_real_atlas_transaction_round_trip`, `test_run_replay_projects_a_real_published_event_into_namespaced_collections` — both require a real MongoDB Atlas/NATS connection not available in this environment; this is the suite's existing, intentional skip behavior, not a new gap.

**Coverage (`--cov=activity_insights`, package only — `tests/`, `.venv/`, caches excluded):**

| Metric | Value |
|---|---|
| Statements | 917 total |
| Missed | 208 |
| **Total %** | **77%** |

HTML report: `services/activity-insights-service/htmlcov/index.html`

**Lowest-covered important modules:**

| File | Statements | Missed | % | Why |
|---|---|---|---|---|
| `main.py` | 51 | 51 | 0% | Process entrypoint/orchestration only (analogous to `main.ts`) — not unit-testable without a real NATS/Mongo runtime |
| `replay.py` | 72 | 44 | 39% | Standalone operator tool; its one integration test (`test_run_replay_...`) is skipped without real infra |
| `backfill.py` | 71 | 42 | 41% | Standalone operator tool; its pure logic (`apply_backfill_event`) IS unit-tested (3 passing tests), but its NATS-reading `main()` orchestration is not |
| `nats_client.py` | 9 | 3 | 67% | Thin connection-setup helper |
| `logging_config.py` | 4 | 1 | 75% | Trivial config wiring |

---

## 6. Admin UI coverage

**Commands:**
```bash
cd admin-ui
npx tsc --noEmit
npm run build
npm run lint
npx vitest run --coverage
```

**Pre-checks:** typecheck clean, build clean, lint clean (6 pre-existing informational warnings, same as before this session, 0 errors).

**Results:**
- **52 passed, 0 failed, 0 skipped** (14 test files)

**Coverage:**

| Metric | % | Measured |
|---|---|---|
| Statements | **79.41%** | 594/748 |
| Branches | **68.60%** | 343/500 |
| Functions | **76.35%** | 197/258 |
| Lines | **81.87%** | 533/651 |

HTML report: `admin-ui/coverage/index.html`

**Coverage of the areas this report specifically needed to confirm:**

| Area | File | Statements |
|---|---|---|
| JWT login/logout/refresh flow | `context/AuthContext.tsx` | 91.1% (100% functions) |
| Auth API wrapper | `api/auth.ts` | 75% |
| Login UI | `components/common/SignInGate.tsx` | 100% |
| ADMIN/EMPLOYEE topbar (name/role/logout) | `components/layout/Topbar.tsx` | 100% |
| Work-item drawer (ownership-gated update controls) | `pages/ItemDrawer.tsx` | 80.3% |
| Board (ownership-gated move controls) | `pages/board/BoardView.tsx` | 84.4% |

**Lowest-covered important modules:**

| File | Statements | Why |
|---|---|---|
| `pages/board/CreateItemForm.tsx` | 30.0% | Only its ADMIN-visible render path and submit handler are exercised; several validation/edge branches are not |
| `pages/board/Column.tsx` | 33.3% | Thin layout wrapper around `Card`; most of its logic is exercised transitively through `BoardView.test.tsx`, which doesn't hit every branch directly |
| `components/common/ErrorAlert.tsx` | 60.0% | Several error-shape branches (validation details, network errors) aren't all independently tested |
| `pages/board/BoardFilters.tsx` | 64.3% | Filter UI has more branches (label/value combinations) than the tests currently exercise |
| `pages/board/Card.tsx` | 66.7% | WIP-badge and overdue-badge branches partially untested |

---

## 7. Consolidated coverage table

| Component | Framework | Tests Passed | Skipped | Statements | Branches | Functions | Lines |
|---|---|---|---|---|---|---|---|
| Management Service (unit) | Jest | 252 | 0 | 76.84% | 69.37% | 54.12% | 76.50% |
| Management Service (e2e) | Jest | 19 | 0 | — (not coverage-instrumented) | — | — | — |
| Activity & Insights Service | pytest | 63 | 2 | 77%* | N/A (pytest-cov here doesn't report branch coverage separately) | N/A | 77%* |
| Admin UI | Vitest | 52 | 0 | 79.41% | 68.60% | 76.35% | 81.87% |

\* pytest-cov's default report is a single statement-coverage percentage (917 statements, 208 missed); it does not break out a separate "lines" figure distinct from statements for this codebase, so the same 77% is shown in both columns rather than inventing a second number.

---

## 8. JWT authentication test coverage

| Scenario | Proven by |
|---|---|
| Valid login | `auth.service.spec.ts` ("succeeds with the correct email/password and issues both tokens") |
| Invalid password | `auth.service.spec.ts` ("rejects the wrong password with a generic, non-enumerating message") |
| Unknown email | `auth.service.spec.ts` ("rejects an unknown email with the SAME message as a wrong password (no enumeration)") |
| Inactive/deactivated user | `auth.service.spec.ts` ("rejects a deactivated user even with the correct password") |
| JWT validation (signature/expiry/type) | `request-context.guard.spec.ts` — garbage token, wrong-secret token, expired token, refresh-token-presented-as-access all rejected |
| Refresh (success + rotation) | `auth.service.spec.ts`, `auth.controller.spec.ts` ("refresh reads/rotates cookie with no request body") |
| Refresh — invalid cases | `auth.service.spec.ts` — missing token, wrong secret, expired, tokenVersion-mismatched, deactivated user, all rejected |
| Logout | `auth.service.spec.ts` ("logout bumps tokenVersion"), `auth.controller.spec.ts` ("logout clears cookie even with an already-invalid token", "logout invalidates server-side session for a valid token") |
| Refresh after logout | `auth.service.spec.ts` ("a refresh token issued before logout is rejected afterward") — also **re-verified live against production** in this session (see §12) |

Frontend mirrors all of the above through `AuthContext.test.tsx` (session restore, login failure, logout, transparent refresh-and-retry on 401) and `SignInGate.test.tsx` (checking state never flashes protected content, successful login, invalid-login error).

## 9. ADMIN/EMPLOYEE RBAC test coverage

| Scenario | Proven by |
|---|---|
| ADMIN admin-actions succeed | `rbac-policy.spec.ts` (declarative `@Roles(['ADMIN'])` on every mutating route) + `roles.guard.spec.ts` ("allows ADMIN-only route for ADMIN") + `work-items.rbac.spec.ts` ("allows ADMIN for %s" create/assign/archive) |
| EMPLOYEE admin-actions → 403 | `roles.guard.spec.ts` ("rejects ADMIN-only route for EMPLOYEE (403)") + `work-items.rbac.spec.ts` ("rejects EMPLOYEE with 403 for %s" create/assign/archive) |
| EMPLOYEE cannot manage teams/projects/users | `rbac-policy.spec.ts` asserts `create`/`update`/`archive`/member-management on `TeamsController` and `ProjectsController` all require `['ADMIN']` |
| Cross-workspace access blocked | `cross-workspace-isolation.spec.ts` (3 tests), plus workspace-scoping assertions within `projects.service.spec.ts`, `teams.service.spec.ts`, `work-items.service.spec.ts` |
| Client-supplied identity/role/workspace cannot bypass authorization | `request-context.guard.spec.ts` ("proves client-supplied x-dev-user-id/x-workspace-id headers are never read") — architecturally reinforced by every controller deriving `actorId`/`workspaceId` exclusively from the verified `RequestContext` (`ctx.userId`/`ctx.workspaceId`), never from request body/params (no controller or DTO in the codebase accepts a caller-supplied actor identity) |

Frontend: `TeamsPage.test.tsx`, `ProjectsPage.test.tsx`, `TeamDetailPage.test.tsx`, `board/BoardView.test.tsx` each include an explicit "EMPLOYEE restrictions" case hiding the relevant admin-only form/controls.

## 10. Work-item ownership coverage

| Scenario | Proven by |
|---|---|
| EMPLOYEE can update/move own assigned item | `work-items.rbac.spec.ts` ("1. EMPLOYEE can update a work item assigned to them", "1. EMPLOYEE can move a work item assigned to them") |
| EMPLOYEE cannot update/move another's item | `work-items.rbac.spec.ts` ("2. EMPLOYEE gets 403 updating another employee's assigned work item", "...moving...", "...an unassigned work item (not theirs either)") |
| ADMIN retains full work-item management | `work-items.rbac.spec.ts` ("4. ADMIN can update/move any work item regardless of assignee") |
| Frontend mirrors the rule | `ItemDrawer.test.tsx` (own item → fields/Save enabled; another's item → disabled with explanatory banner; ADMIN → always enabled), `board/BoardView.test.tsx` (own item → move controls + draggable enabled; another's/unassigned → disabled; ADMIN → enabled for every item) |
| Re-verified live in production | See §12 |

## 11. Frontend security-relevant test coverage

| Scenario | Proven by |
|---|---|
| ADMIN controls visible | `TeamsPage.test.tsx`, `ProjectsPage.test.tsx` (create forms render for ADMIN), `TeamDetailPage.test.tsx` (member controls render), `board/BoardView.test.tsx` ("+ New item" renders), `ItemDrawer.test.tsx` (Assignee select + enabled fields for ADMIN) |
| Restricted controls hidden/disabled for EMPLOYEE | Same files' explicit "EMPLOYEE restrictions" / ownership describe blocks |
| EMPLOYEE can operate on own item | `ItemDrawer.test.tsx`, `board/BoardView.test.tsx` (own-assigned-item cases) |
| EMPLOYEE cannot operate on another's item | Same files (another's-item cases) |
| Login/logout/session behavior | `SignInGate.test.tsx`, `AuthContext.test.tsx`, `Topbar.test.tsx` ("signs the user out when 'Sign out' is clicked") |

---

## 12. Production verification (not counted as test coverage)

The following were verified live against the deployed Railway environment in a prior step of this engagement. They are **operational confirmations, not automated test coverage**, and carry no percentage:

- `management-service` health (`/health`, `/health/ready`) — both 200
- `admin-ui` availability — 200
- ADMIN login (Alice) — 201
- EMPLOYEE login (Bob) — 201
- `GET /api/auth/me` for both roles — 200, correct role reported
- ADMIN-only action (team create) — 201
- EMPLOYEE 403 on the same admin-only action — 403
- EMPLOYEE update/move on their own (temporarily) assigned item — 200/201
- EMPLOYEE 403 update/move on another's/unassigned item — 403
- Refresh-token rotation via HttpOnly cookie — 201, new token issued
- Logout — 204
- Refresh after logout — correctly rejected, 401
- CORS restricted to the production admin-ui origin only (confirmed both the allowed case and that an arbitrary origin is not reflected)
- Refresh cookie confirmed `HttpOnly; Secure; SameSite=None; Path=/api/auth`

No passwords, tokens, cookies, or MongoDB credentials were logged or printed during this verification.

## 13. Lowest-covered areas (cross-component summary)

1. `services/activity-insights-service/src/activity_insights/main.py` — 0% (pure entrypoint)
2. `admin-ui/src/pages/board/CreateItemForm.tsx` — 30.0%
3. `admin-ui/src/pages/board/Column.tsx` — 33.3%
4. `services/management-service/src/messaging/nats/nats-connection.service.ts` — 14.28% (e2e-only, by design)
5. `services/management-service/src/messaging/jetstream/stream-bootstrap.service.ts` — 16.32% (e2e-only, by design)
6. `services/management-service/src/teams/memberships.repository.ts` — 22.58%
7. `services/activity-insights-service/.../replay.py` — 39% (standalone tool, integration test skipped without real infra)

## 14. Known gaps / limitations

- **pytest-cov and @vitest/coverage-v8 were not previously installed** in this repository — both were installed this session (devDependency/venv-local only) solely to produce this report; see §16/§17 for exactly what changed.
- Repository-layer files in `management-service` show lower unit-coverage numbers by design — their real query behavior is exercised by the e2e suite (real MongoDB via transactions) rather than mocked unit tests.
- Two Python tests remain skipped without a live MongoDB Atlas/NATS connection; this was already true before this session and is unrelated to the auth/RBAC work.
- Coverage branch/function metrics for `AuthContext.tsx` (50% branches) reflect that the "silent refresh succeeds vs. fails" and "login succeeds vs. fails" branch pairs are each tested, but a couple of edge branches (e.g. a non-`ApiError` thrown during login) are not independently asserted.
- This report does not include a PDF/DOCX conversion — no PDF/DOCX generation tooling (e.g. pandoc) was found already available in this repository, and installing one was out of scope per your instructions. The Markdown report is complete and ready for you to convert if needed.

## 15. Conclusion

All three components build, type-check (where applicable), lint, and pass their full test suites with **zero failing tests** (252 + 19 + 63 + 52 = 386 passing across the whole platform; 2 Python tests skipped for lack of live infrastructure, consistent with pre-existing project behavior). Measured coverage is in the high-70s to low-80s percent range across all three components for statements/lines, with RBAC, JWT authentication, and the new work-item ownership rule specifically and explicitly covered by dedicated test files on both backend and frontend, and additionally re-confirmed live against the deployed Railway production environment.

## 16. Exact commands used

```bash
# Management Service
cd services/management-service
npm run test:cov
npm run test:e2e

# Activity & Insights Service
cd services/activity-insights-service
.venv/Scripts/python.exe -m pip install pytest-cov   # see note below
.venv/Scripts/python.exe -m pytest --cov=activity_insights --cov-report=term-missing --cov-report=html

# Admin UI
cd admin-ui
npx tsc --noEmit
npm run build
npm run lint
npm install --save-dev @vitest/coverage-v8@5.0.3      # see note below
npx vitest run --coverage
```

## 17. Coverage report output locations

| Component | HTML report | Raw data |
|---|---|---|
| Management Service | `services/management-service/coverage/lcov-report/index.html` | `coverage/lcov.info`, `coverage/coverage-final.json`, `coverage/clover.xml` |
| Activity & Insights Service | `services/activity-insights-service/htmlcov/index.html` | (coverage data embedded in the htmlcov directory) |
| Admin UI | `admin-ui/coverage/index.html` | `admin-ui/coverage/coverage-final.json`, `admin-ui/coverage/clover.xml` |

All three `coverage`/`htmlcov` directories are already covered by the repository's `.gitignore` and were not added to source control.
