# Phase 7 RED/GREEN Evidence — Tasks 1–6

Date: 2026-07-23
Branch: `feat/phase7-playtest-ui-ux`
Scope: client UI/UX, local structured feedback, existing E2E extensions, and
playtest documentation only. No human playtest result is claimed.

## Baseline

- `npm.cmd run test --workspace @cooking-game/client -- --run`
  - GREEN: 8 files, 120 tests passed.

## Task 1 — Role-first briefing

- RED: `npm.cmd run test --workspace @cooking-game/client -- --run tests/role-briefing.test.ts`
  - Failed to resolve missing `../src/ui/RoleBriefing.js`; the existing 120
    client tests still passed.
- GREEN: `npm.cmd exec --workspace @cooking-game/client -- vitest run tests/role-briefing.test.ts`
  - 1 file, 18 tests passed.

## Task 2 — Phase-aware Operate surface

- RED: `npm.cmd exec --workspace @cooking-game/client -- vitest run tests/lobby.test.ts`
  - 5 new assertions failed, 34 existing Lobby tests passed. Missing evidence:
    root view-state attributes, setup/Operate visibility, role briefing, and
    role-workspace classification.
- GREEN: `npm.cmd exec --workspace @cooking-game/client -- vitest run tests/lobby.test.ts tests/role-briefing.test.ts`
  - 2 files, 57 tests passed.

## Task 3 — Privacy-minimal record model

- RED: `npm.cmd exec --workspace @cooking-game/client -- vitest run tests/playtest-feedback.test.ts`
  - Failed to resolve missing `../src/playtest/PlaytestFeedback.js`.
- GREEN: same focused command
  - 1 file, 15 tests passed.

## Task 4 — Post-round debrief

- RED: `npm.cmd exec --workspace @cooking-game/client -- vitest run tests/playtest-debrief.test.ts`
  - Failed to resolve missing `../src/ui/PlaytestDebrief.js`.
- Component GREEN: same focused command
  - 1 file, 4 tests passed.
- Lobby integration RED:
  `npm.cmd exec --workspace @cooking-game/client -- vitest run tests/lobby.test.ts`
  - New terminal integration assertion found no debrief node; 39 existing/new
    Lobby assertions passed.
- Integration GREEN:
  `npm.cmd exec --workspace @cooking-game/client -- vitest run tests/playtest-debrief.test.ts tests/lobby.test.ts`
  - 2 files, 44 tests passed.
  - `npm.cmd run typecheck --workspace @cooking-game/client` passed.

## Task 5 — Existing multiplayer/mobile regression

- Full-round RED:
  `npx.cmd playwright test tests/e2e/lobby.spec.ts --project=chromium`
  - Existing production bundle failed the new root state assertion: expected
    `data-connection-state="CONNECTED"`, attribute absent.
- Full-round GREEN: same command after production client build
  - 1 existing Chromium full-round scenario passed.
- Mobile RED:
  `npx.cmd playwright test tests/e2e/mobile-layout.spec.ts --project=mobile-chrome --project=mobile-safari`
  - 2 touch-round cases failed because the first action was below the 390px
    landscape viewport; 2 recovery cases passed.
- Mobile GREEN after low-height landscape composition:
  `npm.cmd run build --workspace @cooking-game/client` followed by the same
  Playwright command
  - Client production build passed.
  - 4 existing mobile-matrix cases passed across emulated Chrome and WebKit.

One intermediate Playwright rerun was interrupted by an accidentally short
shell timeout after the build. Its two scoped managed server processes were
identified by ports/command lines and stopped; both ports were verified free
before the successful bounded rerun. This was an execution interruption, not a
product RED/GREEN result.

## Task 6 — Protocol and evidence

- RED: direct artifact check for `docs/playtesting.md`,
  `docs/playtest-session-template.md`, and `.hermes/phase7-red-green.md`
  - Failed with all three artifacts missing.
- GREEN: the same existence check plus a focused `rg` audit for participants,
  isolation, role rotation, non-coaching, measures, export/clear, privacy,
  decision/retest log, pending human gate, and no fabricated results passed.

## Final verification

- `npm.cmd run test --workspace @cooking-game/client`
  - 11 files, 167 tests passed (baseline was 120).
- `npm.cmd run typecheck --workspace @cooking-game/client`
  - Passed.
- `npm.cmd test`
  - 256 tests passed: structure/startup 2, client 167, server 61, recipe schema
    9, shared 17.
- `npm.cmd run typecheck`
  - All five workspace typechecks passed.
- `npm.cmd run build`
  - All five ordered workspace builds passed.
- Fresh full production browser matrix:
  - 9 / 9 passed across Chromium, Firefox, WebKit, mobile Chrome, and mobile
    Safari emulation;
  - the full-round role mapping derives role keys from authoritative labels;
  - critical mobile targets must fit fully inside the first landscape viewport;
  - no per-run SQLite directory or port listener leaked.
- `npm.cmd audit --json` and `npm.cmd audit --omit=dev --json`
  - 0 vulnerabilities across the full and production dependency trees.
- `git diff --check`
  - Passed.
- Scope/privacy scan
  - No diff under `apps/server`, `packages/shared`, `packages/recipe-schema`, or
    `packages/test-utils`.
  - No feedback-code match for network APIs or prohibited identity/free-text
    fields.
  - Ports 2567 and 4173 each had zero listeners after verification.

Automated implementation is complete; human playtest gate remains pending.

## Hermes review corrections

- Guide briefing neutrality RED: the Guide copy exposed microphone/voice transport
  details. GREEN: neutral visual-control guidance with 19 role-briefing tests.
- Storage resilience RED: denied reads and quota-blocked writes escaped the local
  debrief. GREEN: denied reads produce an empty valid set and failed writes show
  an accessible error without marking the round submitted.
- Multi-round duration RED: terminal → waiting → running carried the previous
  observed duration (5 seconds instead of 1). GREEN: observation resets on exit
  from terminal state.
- Terminal account visibility RED: the full Chromium auth scenario completed the
  round but timed out because the new Operate surface kept Sign out hidden.
  GREEN: one account mount is visible during setup and terminal debrief only;
  the exact auth E2E passed in 9.0 seconds, then the full 9-case matrix passed.
- Fresh detached production restart: migrated SQLite, client HTTP 200, protected
  account API 401 without a cookie, real 1 / 3 room and role-first Operate surface,
  and zero browser console/page errors. The live app remains available at
  `http://127.0.0.1:4173` for manual inspection.
- Recipe-step clarity RED: the private recipe showed eight rows while the HUD
  counted ten actions because repeated Tomato actions omitted their quantity.
  GREEN: repeated ingredient actions now display `× 2`; all 167 client tests,
  256 root tests, all typechecks/builds, and 9 / 9 browser cases passed again.
- One matrix launch was correctly blocked because the prior live handoff still
  owned port 2567. The tracked live trees were stopped, both ports verified free,
  and the complete matrix reran successfully before a clean restart.
