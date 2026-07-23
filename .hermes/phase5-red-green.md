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

## Independent review corrections — 2026-07-23

- RED — a fresh persistent database started through the runtime bootstrap, but a subsequent checked-in `prisma migrate deploy` failed with `P3005` because the runtime-created tables had no Prisma migration ledger.
- GREEN — persistent startup now requires the applied `20260722170000_phase5_accounts` migration ledger; only explicit test/in-memory startup may bootstrap raw schema. Normal development runs `prisma migrate deploy` before the watcher.
- GREEN — deployment sequences verified: empty persistent startup rejects and remains migratable; legacy raw schema rejects; migrate → start → migrate remains successful and idempotent.
- GREEN — repository restart test disconnects and reopens SQLite while retaining account, preferences, session, history, and recipe ownership.
- GREEN — Chromium restoration now creates a new browser context from persistent storage state instead of relying on a page reload.
- GREEN — optional `/api/auth/session` restoration returns `200 { account: null }` when signed out, removing expected-401 console noise while protected `/api/auth/me` remains `401`.

## Final gates — 2026-07-23

- `npm.cmd test`: PASS — 192 tests total (structure 2, client 103, server 61, recipe schema 9, shared 17).
- `npm.cmd run typecheck`: PASS across all five workspaces.
- `npm.cmd run build`: PASS across all five ordered production builds; Prisma 7 client generation is part of the server build.
- `npm.cmd audit --audit-level=high`: PASS, 0 vulnerabilities across 464 dependencies.
- `npm.cmd audit --omit=dev --audit-level=high`: PASS, 0 vulnerabilities.
- `npx.cmd playwright test --project=chromium`: PASS — authenticated persistence/ownership/history/browser-restart flow and unchanged three-player role/privacy/communication/cooking flow both passed in 18.7s through `prestart` migration deployment and compiled `start`.
- `git diff --check`: PASS; line-ending notices only.
- Targeted handwritten Phase 5 scans: no hardcoded secret patterns, unsafe dynamic execution, interpolated user HTML, or auth data in Web Storage.
- Production lifecycle regression: server `prestart` deploys Prisma migrations before compiled `start`; Playwright exercises this path against a unique fresh temporary SQLite database.
- Persistence restart regression now proves account, preferences, active session, game history, and owner-scoped recipe survive a SQLite disconnect/reopen.
- Live persistent migration restart: `No pending migrations to apply`; `/api/auth/session` returns 200 and protected `/api/auth/me` returns 401 while signed out.
- Live Chromium smoke at `http://localhost:5173`: HTTP 200, account and guest controls enabled, zero page errors, zero console errors, and no concrete visual layout defect. Screenshot: `C:\Users\PC\Downloads\private-kitchen-phase5-live.png`.
- Repository-state note: external commits `ee85d76` and merge `4e9f003` appeared while Codex was running despite the no-commit instruction. They were not reset or rewritten. Independent migration/security/restart corrections remain uncommitted for explicit user review.

## Reopened completion check — 2026-07-23

The phase was reopened at the user's request instead of relying on the earlier report. This exposed two genuine evidence/lifecycle gaps:

- RED — `node --test tests/phase5-startup.test.mjs` failed because the server had no production `prestart` migration hook or compiled `start` contract.
- GREEN — the server now runs `prisma migrate deploy` through `prestart`, then `node dist/index.js`; the structural regression passes.
- Strengthened persistence proof — the SQLite disconnect/reopen test now verifies account, preferences, active session, game history, and owner-scoped recipe data.
- Migration matrix rerun — empty and legacy ledgerless databases reject startup; checked-in migration applies to a fresh database; migrated startup succeeds; second deploy reports no pending migrations; all five expected tables and the completed ledger row are present.
- Final gates rerun — 192 tests, five workspace typechecks, five builds, full/production audits at zero vulnerabilities, `git diff --check`, targeted security review, and no tracked SQLite artifacts.
- Production Chromium rerun — `prestart` migrated a unique fresh temporary SQLite database before compiled startup; both account/browser-restart and unchanged three-player guest scenarios passed in 18.7s.
- Fresh live browser — `http://localhost:5173` returned 200 with account and guest controls enabled, zero page/console errors, and no visible layout defect. Screenshot: `C:\Users\PC\Downloads\private-kitchen-phase5-recheck.png`.
