# Phase 5 RED/GREEN Evidence

## Baseline

- Base HEAD: `ed98e5c`; Phase 3/4 changes are intentionally uncommitted and must be preserved.
- `npm run test`: PASS before Phase 5.
- `npm run typecheck`: PASS across all workspaces before Phase 5.
- `npm run build`: PASS across all workspaces before Phase 5.
- `npm audit --audit-level=high`: 0 vulnerabilities before Phase 5.
- Existing live three-player E2E: PASS before Phase 5.

Codex must append each focused RED failure and GREEN pass here as it implements vertical slices.

## Task 1 — Prisma persistence foundation

- RED — `npm.cmd test --workspace @cooking-game/server -- --run tests/persistence.test.ts`: FAIL as expected; Vitest could not resolve the intentionally missing `src/db/client.js` (45 neighboring server tests still passed).
- GREEN — `npm.cmd test --workspace @cooking-game/server -- --run tests/persistence.test.ts`: PASS, 50 tests across 5 files.
- GREEN — `npm.cmd run typecheck --workspace @cooking-game/server`: PASS after Prisma 7 client generation, adapter-backed SQLite repository, and migration implementation.

## Tasks 2–3 — Authentication and authorized account HTTP API

- RED — `npm.cmd test --workspace @cooking-game/server -- --run tests/http-api.test.ts`: FAIL as expected; the new suite cannot resolve the intentionally missing `src/http/app.js` (50 neighboring tests still passed).
- GREEN — `npm.cmd test --workspace @cooking-game/server -- --run tests/http-api.test.ts`: PASS, 57 tests across 6 files.
- GREEN — `npm.cmd run typecheck --workspace @cooking-game/server`: PASS after adding Express 5 types and correcting strict route parameter handling.

## Task 4 — Room cookie identity and authoritative history

- RED — `npm.cmd test --workspace @cooking-game/server -- --run tests/room-auth-history.integration.test.ts`: FAIL as expected after correcting the test listener cleanup; terminal history remained empty (`expected 1, received 0`).
- GREEN — `npm.cmd test --workspace @cooking-game/server -- --run tests/room-auth-history.integration.test.ts`: PASS, 58 tests across 7 files; two authenticated cookie participants each received one terminal row and an invalid-cookie guest received no association.

## Task 5 — Optional account UI and restoration

- RED — `npm.cmd test --workspace @cooking-game/client -- --run tests/auth-panel.test.ts`: FAIL as expected; Vite cannot resolve the intentionally missing `src/ui/auth/AuthPanel.js` (96 neighboring client tests still passed).
- GREEN — `npm.cmd test --workspace @cooking-game/client -- --run tests/auth-panel.test.ts`: PASS, 100 tests across 5 files.
- GREEN — `npm.cmd test --workspace @cooking-game/client`: PASS, 101 tests including saved display-name precedence.
- GREEN — client and server workspace typechecks: PASS after strict optional request-init correction.

## Task 6 — Browser E2E, migration, and documentation

- RED — `npx.cmd playwright test tests/e2e/auth.spec.ts --project=chromium`: initial run was blocked by the prior Phase 4 live watcher on port 2567; after safely identifying and stopping that repository process, the compiled server exposed a Prisma generated-import runtime failure.
- RED — focused browser iterations then found three test/integration issues in sequence: ambiguous display-name selector, reading the async room ID too early, and retaining a structural locator after authoritative object replacement. Each failed before its asserted behavior and was corrected without weakening product assertions.
- GREEN — compiled server smoke: PASS after configuring Prisma 7 `moduleFormat = "esm"` and `importFileExtension = "js"`; `node apps/server/dist/index.js` listened on 2567.
- GREEN — `npm.cmd run prisma:migrate --workspace @cooking-game/server` against an isolated temporary SQLite URL: PASS; the checked-in `20260722170000_phase5_accounts` migration applied successfully.
- GREEN — `npx.cmd playwright test tests/e2e/auth.spec.ts --project=chromium`: PASS in 6.6s after the final guest-context assertion; registration, reload restoration, preferences, authenticated win/history, recipe ownership isolation, logout restoration, and fresh guest availability passed.
- GREEN — `npm.cmd test --workspace @cooking-game/server -- --run tests/room-auth-history.integration.test.ts`: PASS, 59 tests; reconnect drops an account association once its server session has expired.
