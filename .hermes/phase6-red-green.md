# Phase 6 RED / GREEN Evidence

## Baseline — 2026-07-23

- Branch: `feat/phase6-mobile-browser-support`
- Base/head before Phase 6 edits: `1ef1dcb751219bee6ce14cf042f519e9a618fe6f` (verified Phase 5 head)
- `npm.cmd test`: PASS
- `npm.cmd run typecheck`: PASS across client, server, recipe-schema, shared, and test-utils
- `npm.cmd run build`: PASS across all ordered workspaces
- `npm.cmd audit --audit-level=low --json`: PASS, 0 vulnerabilities
- Existing generated-output warnings are baseline-only; no Phase 6 behavior exists yet.

## TDD slices

Codex/Hermes must append each observed RED failure and GREEN pass here. Production code must not precede its failing behavioral test.

### Task 2 — Orientation gate

- RED 2026-07-23: `npm.cmd test --workspace @cooking-game/client -- orientation-gate.test.ts` failed as expected because `src/ui/OrientationGate.ts` did not exist (`Failed to resolve import`); existing client tests remained 103 passed.
- GREEN 2026-07-23: same command passed 104 tests across 6 files after rendering the accessible portrait gate and applying `inert`.
- RED 2026-07-23: same command failed 1 of 105 tests because no portrait `change` listener was registered.
- GREEN 2026-07-23: same command passed 105 tests after landscape recovery removed the overlay and `inert`.
- RED 2026-07-23: same command failed 1 of 107 tests because activating the gate button did not request fullscreen or landscape lock; the desktop-portrait regression passed.
- GREEN 2026-07-23: same command passed 107 tests after button-only fullscreen followed by optional landscape lock.
- RED 2026-07-23: same command failed 1 of 108 tests because the missing fullscreen path gave no inline fallback guidance.
- GREEN 2026-07-23: same command passed 108 tests after missing/rejected fullscreen or lock paths produced bounded inline manual-rotation guidance without leaking rejections.
- RED 2026-07-23: same command failed 1 of 109 tests because `destroy()` was absent.
- GREEN 2026-07-23: same command passed 109 tests after teardown removed listeners, overlay, and `inert`; the gate is mounted from client startup.

### Task 3 — Touch input annotation

- RED 2026-07-23: `npm.cmd test --workspace @cooking-game/client -- touch-controls.test.ts` failed as expected because `src/input/TouchControls.ts` did not exist; 109 existing tests passed.
- GREEN 2026-07-23: same command passed 110 tests after coarse-pointer/maxTouchPoints capability annotation.
- RED 2026-07-23: same command failed the 3 parameterized pointer-mode cases (110 passed, 3 failed) because `pointerdown` was not subscribed on the injected event target; native events remained unprevented.
- GREEN 2026-07-23: same command passed 113 tests after pointerdown annotated touch, pen, or mouse mode without calling `preventDefault`.
- RED 2026-07-23: same command failed 1 of 114 tests because keyboard events were not annotated; the event remained unprevented.
- GREEN 2026-07-23: same command passed 114 tests after keydown annotated keyboard mode while preserving default behavior.
- RED 2026-07-23: same command failed 1 of 115 tests because the coarse-pointer media query had no change listener.
- GREEN 2026-07-23: same command passed 115 tests after capability updates subscribed to coarse-pointer changes.
- RED 2026-07-23: same command failed 1 of 116 tests because `destroy()` was absent.
- GREEN 2026-07-23: same command passed 116 tests after teardown removed input/media listeners and both markers; TouchControls is mounted at startup.

### Task 4 — Responsive and touch-safe UI

- RED 2026-07-23: `npm.cmd test --workspace @cooking-game/client -- communication-panel.test.ts` failed 1 of 117 tests because `lostpointercapture` did not discard the active stroke (the existing `pointercancel` path did).
- GREEN 2026-07-23: same command passed 117 tests after both cancellation signals clear the stroke without sending.
- RED 2026-07-23: `npm.cmd test --workspace @cooking-game/client -- lobby.test.ts` failed 1 of 118 tests because the stylesheet lacked the dynamic-viewport/safe-area/nonoverflow/touch-target/focus/canvas/wrapping/reduced-motion contract.
- GREEN 2026-07-23: same command passed 118 tests after adding that responsive/touch-safe stylesheet contract.
- RED 2026-07-23: `npm.cmd run typecheck --workspace @cooking-game/client` failed because `browserEnvironment()` explicitly assigned `undefined` to exact-optional `requestFullscreen`/`lockLandscape` properties.
- GREEN 2026-07-23: client typecheck passed, then client production build passed (129 modules; CSS 7.64 kB, JS 228.10 kB) after conditionally spreading only supported optional functions.

### Task 5 — Scoped browser and mobile Playwright coverage

- RED 2026-07-23: after adding `browser-support.spec.ts` and `mobile-layout.spec.ts`, `npx.cmd playwright test --list --project=firefox` failed with `Project(s) "firefox" not found. Available projects: "chromium"`.
- GREEN 2026-07-23: `npx.cmd playwright test --list` parsed 9 cases in 5 projects with the expensive existing suite limited to Chromium.
- RED 2026-07-23: the first full matrix passed 8/9; desktop WebKit raised `Wrong protocol for WebSocket '[object Object]'` because the current Colyseus SDK passes a Node-only options object to native WebSocket before its browser fallback. No E2E database directory leaked.
- RED 2026-07-23: `websocket-compatibility.test.ts` failed because the compatibility module did not exist.
- GREEN 2026-07-23: the idempotent pre-SDK constructor guard passed 2 focused tests, client typecheck/build passed, and the previously failing WebKit production smoke passed.
- GREEN 2026-07-23: the repeated full production matrix passed 9/9 across Chromium, Firefox, WebKit, mobile Chrome emulation, and mobile Safari/WebKit emulation; unique SQLite cleanup left no new temporary directory.

### Task 6 — Documentation and completion boundary

- GREEN 2026-07-23: browser policy, architecture, test commands, automated evidence, and the physical iOS/Android checklist are recorded. Physical iOS Safari and Android Chrome remain a blocking manual completion gate and are not claimed.
- RED 2026-07-23: portrait dialog focus remained on `<body>` while the app became inert.
- GREEN 2026-07-23: the gate focuses `Use landscape`, restores prior in-app focus after rotation/destroy, 120 client tests and client typecheck pass, and rebuilt production assets pass 4/4 mobile Chrome/WebKit focus-and-gameplay cases. A direct Playwright run against stale `dist` first exposed the need to build before scoped commands; `docs/testing.md` now records it.

### Task 7 — CI and final verification

- GREEN 2026-07-23: `.github/workflows/ci.yml` parses with separate `validate` and `e2e` jobs; E2E installs exactly Chromium, Firefox, and WebKit and runs `npm run test:e2e`. The same root command passes locally 9/9, but remote Actions are pending commit/push and are not claimed.
