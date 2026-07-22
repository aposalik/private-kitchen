# Phase 4 RED/GREEN Evidence

## Task 5 - Client UI

### UI-1 - authoritative round HUD

- RED command: `npm.cmd exec vitest -- run apps/client/tests/lobby.test.ts`
- RED result: FAIL - 3 of 15 tests failed because the accessible round section and authoritative status, timer, progress, and waiting guidance were absent.
- GREEN command: `npm.cmd exec vitest -- run apps/client/tests/lobby.test.ts`
- GREEN result: PASS - 15 tests passed in 1 test file.

### UI-2 - private Recipe Keeper panel

- RED command: `npm.cmd exec vitest -- run apps/client/tests/lobby.test.ts`
- RED result: FAIL - 2 of 19 tests failed because the Recipe Keeper private panel and waiting state were absent; both forged-payload privacy cases already remained hidden.
- GREEN command: `npm.cmd exec vitest -- run apps/client/tests/lobby.test.ts`
- GREEN result: PASS - 19 tests passed in 1 test file.

### UI-3 - Blind Cook contextual finite controls

- RED command: `npm.cmd exec vitest -- run apps/client/tests/lobby.test.ts`
- RED result: FAIL - 7 of 26 tests failed because authoritative object context, finite object/station cooking controls, paused/terminal suppression, actionable point gating, and sanitized cooking-error rendering were absent.
- GREEN command: `npm.cmd exec vitest -- run apps/client/tests/lobby.test.ts`
- GREEN result: PASS - 26 tests passed in 1 test file.

### UI-4 - authoritative result screens

- RED command: `npm.cmd exec vitest -- run apps/client/tests/lobby.test.ts`
- RED result: FAIL - 3 of 29 tests failed because WON/LOST result screens and nonterminal lifecycle cleanup were absent.
- GREEN command: `npm.cmd exec vitest -- run apps/client/tests/lobby.test.ts`
- GREEN result: PASS - 29 tests passed in 1 test file.

## Task 4 - Client network slice

### Client slice 1 - replicated round and object state

- RED command: `npm.cmd exec vitest -- run apps/client/tests/room-client.test.ts`
- RED result: FAIL - 1 of 16 tests failed; the snapshot omitted authoritative `roundStatus`, `remainingMs`, `completedStepCount`, `totalStepCount`, `outcomeReason`, plus object `preparation` and `location`.
- GREEN command: `npm.cmd exec vitest -- run apps/client/tests/room-client.test.ts`
- GREEN result: PASS - 16 tests passed in 1 test file.

### Client slice 2 - finite cooking sends and persisted sequence

- RED command: `npm.cmd exec vitest -- run apps/client/tests/room-client.test.ts`
- RED result: FAIL - 10 of 26 tests failed because the six finite methods were absent, fresh create/join retained stale cooking state, resume did not load it, and failed reconnect did not clear it.
- GREEN command: `npm.cmd exec vitest -- run apps/client/tests/room-client.test.ts`
- GREEN result: PASS - 26 tests passed in 1 test file.

### Client slice 3 - private recipe privacy and round bootstrap

- RED command: `npm.cmd exec vitest -- run apps/client/tests/room-client.test.ts`
- RED result: FAIL - 4 of 30 tests failed because valid private recipe state was absent and exact empty `ROUND_READY` bootstrap/reconnect sends were absent.
- GREEN command: `npm.cmd exec vitest -- run apps/client/tests/room-client.test.ts`
- GREEN result: PASS - 30 tests passed in 1 test file; ordering assertions confirm both Phase 4 listeners attach before bootstrap.

### Client slice 4 - strict cooking errors and lifecycle clearing

- RED command: `npm.cmd exec vitest -- run apps/client/tests/room-client.test.ts`
- RED result: FAIL - 2 of 33 tests failed because valid strict `COOKING_ERROR` payloads were not stored or exposed as sanitized message-only snapshot state.
- GREEN command: `npm.cmd exec vitest -- run apps/client/tests/room-client.test.ts`
- GREEN result: PASS - 33 tests passed in 1 test file.

### Client network final gates

- Focused RoomClient: `npm.cmd exec vitest -- run apps/client/tests/room-client.test.ts` - PASS, 33 tests in 1 file.
- Complete client tests: `npm.cmd test --workspace @cooking-game/client` - PASS, 75 tests in 4 files.
- Client typecheck: `npm.cmd run typecheck --workspace @cooking-game/client` - PASS.

### Slice 8 - disconnect pause, reconnect/replacement resume, cleanup

- RED command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- RED result: FAIL before lifecycle handling because the running countdown did not enter `PAUSED` or freeze on readiness loss.
- GREEN command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- GREEN result: PASS - 9 tests passed in 1 test file, including transient reconnect and permanent replacement.
- Independent compatibility gate: `npm.cmd test --workspace @cooking-game/server`: PASS - 45 tests in 4 files.
- Independent typecheck/build: PASS.
- `git diff --check`: PASS (line-ending warnings only).


### Slice 7 - authoritative monotonic timer and timeout loss

- RED command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- RED result: FAIL - 1 of 7 tests timed out waiting for the missing authoritative countdown.
- GREEN command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- GREEN result: PASS - 7 tests passed in 1 test file.

### Slice 6 - terminal order and completed win

- RED command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- RED result: FAIL - 1 of 6 tests timed out because terminal actions never advanced public progress or produced a win.
- GREEN command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- GREEN result: PASS - 6 tests passed in 1 test file.
- Gate: `npm.cmd run typecheck --workspace @cooking-game/server`: PASS.
- Gate: `npm.cmd run build --workspace @cooking-game/server`: PASS.
- Compatibility gate: `npm.cmd test --workspace @cooking-game/server`: PASS - 42 tests passed in 4 test files.

### Slice 5 - bounded ruin and replacement

- RED command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- RED result: FAIL - 1 of 5 tests timed out because a second legitimate `CHOP` did not produce `RUINED` state and replacement.
- GREEN command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- GREEN result: PASS - 5 tests passed in 1 test file.

### Slice 4 - required ingredient progression and physical authority

- RED command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- RED result: FAIL - 1 of 4 tests received placeholder `OUT_OF_ORDER` instead of `OBJECT_NOT_OWNED` before real cooking semantics existed.
- GREEN command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- GREEN result: PASS - 4 tests passed in 1 test file.

### Slice 3 - strict cooking authority and sequences

- RED command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- RED result: FAIL - 1 of 3 tests timed out because `COOK_ACTION` had no server handler.
- GREEN command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- GREEN result: PASS - 3 tests passed in 1 test file.
- Periodic gate: `npm.cmd run typecheck --workspace @cooking-game/server`: PASS.

### Slice 2 - private Recipe Keeper delivery

- RED command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- RED result: FAIL - 1 of 2 tests timed out because no `PRIVATE_RECIPE` message was sent.
- GREEN command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- GREEN result: PASS - 2 tests passed in 1 test file.
- Periodic gate: `npm.cmd run typecheck --workspace @cooking-game/server`: PASS.

## Task 3 - Server-authoritative recipe/cooking/timer systems

### Slice 1 - READY round bootstrap and authoritative inventory

- RED command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- RED result: FAIL - 1 test timed out waiting for missing `roundStatus: RUNNING` state.
- GREEN command: `npm.cmd exec vitest -- run apps/server/tests/recipe.integration.test.ts`
- GREEN result: PASS - 1 test passed in 1 test file.
- Dependency lock command: `npm.cmd install --package-lock-only --ignore-scripts`
- Dependency lock result: PASS - lockfile up to date, 0 vulnerabilities.

## Baseline

- Starting HEAD: `ed98e5c`; verified Phase 3 changes remain uncommitted.
- Plan: `.hermes/plans/2026-07-22_112146-phase4-first-recipe.md`
- Product decisions: 5-minute server timer, pause on disconnect, immediate timeout loss.

## Task 1 — Versioned recipe contract

### Slice 1 — valid version 1 recipe

- RED command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- RED result: FAIL — 1 test failed because `validateRecipe is not a function`.
- GREEN command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- GREEN result: PASS — 1 test passed in 1 test file.

### Slice 2 — recursively strict objects

- RED command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- RED result: FAIL — 1 of 2 tests failed because the root `metadata` field was accepted.
- GREEN command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- GREEN result: PASS — 2 tests passed in 1 test file.

### Slice 3 — finite version, recipe ID, ingredient kind, and action vocabularies

- RED command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- RED result: FAIL — 1 of 3 tests failed because unsupported recipe ID `mystery-stew` was accepted (kind/action were likewise unconstrained strings).
- GREEN command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- GREEN result: PASS — 3 tests passed in 1 test file.

### Slice 4 — numeric and identifier bounds

- RED command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- RED result: FAIL — 1 of 4 tests failed because ingredient count `0` was accepted (duration, IDs, and references were also unbounded).
- GREEN command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- GREEN result: PASS — 4 tests passed in 1 test file.

### Slice 5 — unique ingredient and step IDs

- RED command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- RED result: FAIL — 1 of 5 tests failed because duplicate ingredient ID `tomato` was accepted (step IDs also had no uniqueness check).
- GREEN command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- GREEN result: PASS — 5 tests passed in 1 test file.

### Slice 6 — possible ingredient and dependency references

- RED command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- RED result: FAIL — 1 of 6 tests failed because undeclared ingredient reference `garlic` was accepted (missing dependencies and invalid action/reference shapes were also unchecked).
- GREEN command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- GREEN result: PASS — 6 tests passed in 1 test file.

### Slice 7 — acyclic dependencies and ordered action phases

- RED command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- RED result: FAIL — 1 of 7 tests failed because a self-dependency was accepted; future/cyclic references, add-before-chop, missing matching chop, and an invalid terminal order were likewise not rejected.
- GREEN command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- GREEN result: PASS — 7 tests passed in 1 test file.

### Slice 8 — malformed JSON

- RED command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- RED result: FAIL — 1 of 8 tests failed because `validateRecipeJson is not a function`.
- GREEN command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- GREEN result: PASS — 8 tests passed in 1 test file.

### Slice 9 — trusted bundled Tomato Soup and deep immutability

- RED command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- RED result: FAIL — 1 of 9 tests failed because the missing `TOMATO_SOUP_RECIPE` export was `undefined` and did not validate.
- GREEN command: `npm.cmd exec vitest -- run packages/recipe-schema/tests/recipe.test.ts`
- GREEN result: PASS — 9 tests passed in 1 test file.

### Task 1 independent gate

- `npm.cmd test --workspace @cooking-game/recipe-schema`: PASS — 9 tests.
- `npm.cmd run typecheck --workspace @cooking-game/recipe-schema`: PASS.
- `npm.cmd run build --workspace @cooking-game/recipe-schema`: PASS.

## Task 2 — Shared finite round protocol

### Slice 1 — finite cook action/object shapes

- RED command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- RED result: FAIL — 1 test failed because `COOK_ACTIONS` was `undefined` (the cook action schema was also absent).
- GREEN command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- GREEN result: PASS — 1 test passed in 1 test file.

### Slice 2 — exact untrusted cook ingress

- RED command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- RED result: FAIL — 1 of 2 tests failed because `KITCHEN_MESSAGES.cookAction` was `undefined`; the same test covers invalid sequences, unknown keys, inherited properties, and client-supplied role, identity, progress, time, outcome, and recipe data.
- GREEN command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- GREEN result: PASS — 2 tests passed in 1 test file.

### Slice 3 — finite server responses and empty readiness

- RED command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- RED result: FAIL — 1 of 3 tests failed because `COOKING_ERROR`, `ROUND_READY`, and `PRIVATE_RECIPE` message names were absent (finite cooking errors and the strict empty readiness schema were also absent).
- GREEN command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- GREEN result: PASS — 3 tests passed in 1 test file.

### Slice 4 — finite kitchen object preparation and location

- RED command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- RED result: FAIL — 1 of 4 tests failed because `KITCHEN_OBJECT_PREPARATIONS` was `undefined`; location state and initial RAW/COUNTER values were also absent.
- GREEN command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- GREEN result: PASS — 4 tests passed in 1 test file.

### Slice 5 — bounded public authoritative round state

- RED command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- RED result: FAIL — 1 of 5 tests failed because `ROUND_STATUSES` was `undefined`; finite outcomes, bounded counters/time, progress consistency, and strict public-state parsing were also absent.
- GREEN command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- GREEN result: PASS — 5 tests passed in 1 test file.

### Slice 6 — strict private recipe payload

- RED command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- RED result: FAIL — 1 of 6 tests failed because `parsePrivateRecipe` was not a function; the strict recursive private payload schema and its finite bounds were also absent.
- GREEN command: `npm.cmd exec vitest -- run packages/shared/tests/cooking-protocol.test.ts`
- GREEN result: PASS — 6 tests passed in 1 test file.
- Task 1 built ESM import: PASS — `Tomato Soup`, duration `300000`, nested dependency arrays frozen.

### Task 2 independent gate

- `npm.cmd test --workspace @cooking-game/shared`: PASS — 17 tests passed in 4 test files.
- `npm.cmd run typecheck --workspace @cooking-game/shared`: PASS.
- `npm.cmd run build --workspace @cooking-game/shared`: PASS.
- Task 2 total: 6 strict RED→GREEN slices; all shared protocol and Phase 2/3 compatibility tests GREEN.


## Task 6 - Production E2E and timer-render regression

### Timer-only DOM stability regression

- RED: `npm.cmd exec vitest -- run apps/client/tests/communication-panel.test.ts` failed 1/12 because a timer-only snapshot replaced the drawing canvas.
- RED: `npm.cmd exec vitest -- run apps/client/tests/lobby.test.ts` failed 1/30 because a timer-only snapshot replaced object controls.
- Root cause: both subscribers rebuilt unrelated interactive DOM on every authoritative `remainingMs` patch.
- GREEN: communication panel 12/12; lobby 30/30; client typecheck PASS. Structural render keys exclude timer-only state while the round HUD still updates.

### Isolated-browser production acceptance

- Command: `npm.cmd exec playwright test -- tests/e2e/lobby.spec.ts --project=chromium`
- Result: PASS - 1 Chromium scenario in 12.0s (test body 9.8s).
- Coverage: exact-three capacity, role assignment, private Tomato Soup payload only to Recipe Keeper, decreasing server timer, 10 synchronized cooking steps, Phase 3 finite communication/voice/reconnect regressions, terminal WON/result lockout, and fourth-player rejection.

## Task 7 - Independent authority, privacy, and lifecycle review

The two isolated delegated reviewers could not access the Windows worktree because their terminals were routed through WSL with no distribution installed. Their absence of findings was not treated as approval. Hermes performed a direct independent diff/source review through the verified native Windows path.

### Review finding 1 - reconnect communication sequence continuity

- Severity: high.
- Failure: a new `RoomClient` reset the Phase 3 communication/voice sequence to zero on explicit resume while the server preserved its replay watermark, causing valid gestures, cards, drawing, pointing, and voice signaling to be rejected as stale.
- RED: focused RoomClient regression expected resumed sequence `7` but received `1`.
- GREEN: the communication sequence is strictly parsed, persisted before send, loaded on resume, reset on fresh create/join, and cleared on permanent failure/disconnect; 34 focused RoomClient tests passed.

### Review finding 2 - terminal physical interaction lockout

- Severity: medium.
- Failure: cooking commands froze after WON/LOST, but a malicious Blind Cook could still send pickup/drop messages because physical authorization checked only room readiness and role.
- RED: post-win pickup regression received no rejection and could mutate object ownership.
- GREEN: physical interaction now additionally requires authoritative `roundStatus: RUNNING`; 9 recipe integration tests and the complete 45-test server suite passed.

### Review finding 3 - point highlight after authoritative object rerender

- Severity: low.
- Failure: cooking state changes replace object rows, but the optimized communication render key ignored object structure, so the current object-point marker was not reapplied.
- RED: communication panel suite passed 12 tests and failed the new row-replacement highlight regression.
- GREEN: authoritative object structure participates in the communication render key while timer-only state remains excluded; communication and lobby suites passed 43 tests.

## Task 8 - Final Phase 4 repository gate

- Root tests: PASS - 168 tests (structure 1, client 96, server 45, recipe schema 9, shared 17).
- Type-check: PASS - client, server, recipe schema, shared, and test-utils.
- Production build: PASS - shared, recipe schema, test-utils, server, and client in dependency order.
- Audits: PASS - full and production-only trees, 0 vulnerabilities.
- Production E2E: PASS - 1 Chromium scenario in 10.9s, with 8.8s test body.
- Git hygiene: `git diff --check` PASS; line-ending notices only.
- Safety scan: 87 files, no high-confidence secrets, dynamic execution/debuggers, BOMBANANA markers, TODO/FIXME/HACK artifacts, or credential-like files.
- Git state: branch `main`, HEAD `ed98e5c`; dirty Phase 3/4 worktree intentionally preserved with no commit or history rewrite.
- Live persistent-process smoke: PASS - `http://localhost:5173` returned HTTP 200; Chromium created a room and received authoritative `1 / 3`, `Waiting`, and `Blind Cook` with zero page errors.
