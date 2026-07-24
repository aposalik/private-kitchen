# Phase 6 Mobile and Browser Support Implementation Plan

> **For Hermes:** Execute this plan with the Planner → Codex developer → independent Tester workflow. Use strict RED → GREEN → REFACTOR slices and record observed failures/passes in `.hermes/phase6-red-green.md`.

**Goal:** Make the existing three-player cooking UI playable in landscape on supported desktop and mobile browsers with touch-safe controls, an accessible portrait orientation prompt, and an honest automated/manual browser support matrix.

**Architecture:** Keep game rules, role privacy, networking, and server authority unchanged. Add client-only environment adapters for orientation/fullscreen and input-mode detection, responsive CSS that removes viewport overflow while preserving native controls, and narrow Playwright projects: full Chromium regression once, browser-engine smoke on Firefox/WebKit, and touch/viewport scenarios on emulated Android Chrome/iOS Safari. Treat Playwright WebKit/device emulation as compatibility evidence, not proof of physical Safari, microphone, speaker, safe-area, or fullscreen behavior.

**Tech Stack:** TypeScript, DOM APIs, CSS media queries and safe-area env variables, Vitest/jsdom, Playwright Chromium/Firefox/WebKit, existing Vite/Colyseus application.

**Dependency:** This branch is stacked on Phase 5 PR #1 (`1ef1dcb`). Phase 6 must not be merged to `main` before Phase 5, unless rebased after Phase 5 is merged.

---

## Acceptance contract

Automated blockers:

1. Touch-capable portrait view shows a keyboard-accessible rotate-to-landscape gate; desktop portrait/narrow windows are not blocked.
2. The fullscreen action is user initiated, never auto-triggered, and gracefully handles unavailable/rejected fullscreen or orientation lock APIs.
3. Landscape mobile view has no document-level horizontal overflow at representative iOS and Android sizes.
4. All actionable controls are at least 44×44 CSS pixels in touch mode; object and communication controls are not exceptions.
5. Native button/input keyboard behavior and visible focus remain intact; touch support must not globally call `preventDefault`.
6. Editable drawing canvas uses Pointer Events and `touch-action: none`; non-drawing page areas retain normal scrolling/zooming.
7. A mobile touch context can create a room, retain/reconnect its authoritative identity after reload, and operate an allowed Blind Cook action once three players are present.
8. Current Chromium, Firefox, and WebKit engine smoke checks pass. Existing full authority/privacy E2E remains on Chromium.
9. Existing unit/integration tests, typecheck, build, audit, migration lifecycle, and test-database cleanup remain green.

Manual completion blockers:

1. Real current iOS Safari and Android Chrome devices verify landscape prompt and rotation recovery.
2. Fullscreen behavior is recorded as supported, unsupported, or browser-limited without blocking play.
3. Touch lobby, gameplay buttons, Recipe Keeper drawing, scroll, pinch zoom, and reconnect work.
4. Real microphone permission, role-filtered audio, speaker output, and a three-device round work on the target LAN.
5. Safe areas/notches do not cover controls. Record browser/OS/device versions and evidence in `docs/browser-support.md`.

Phase 6 is **automation complete / manual gate pending** until those physical checks are performed.

---

### Task 1: Establish isolated Phase 6 baseline

**Objective:** Preserve Phase 5 and create an explicit stacked feature branch.

**Files:**
- Create: `.hermes/phase6-red-green.md`
- Reference: `.hermes/plans/2026-07-23_115656-phase6-mobile-browser-support.md`

**Steps:**
1. Confirm a clean worktree and local/upstream SHA `1ef1dcb`.
2. Create `feat/phase6-mobile-browser-support` from the verified Phase 5 head.
3. Record baseline commands and counts without changing production behavior.
4. Do not merge, commit, or push unless the user later requests it.

### Task 2: Add portrait orientation gate using TDD

**Objective:** Prompt only touch-capable portrait users and offer a safe, optional fullscreen/landscape request.

**Files:**
- Create: `apps/client/src/ui/OrientationGate.ts`
- Create: `apps/client/tests/orientation-gate.test.ts`
- Modify: `apps/client/src/main.ts`

**RED slices:**
1. Touch + portrait renders a fixed `data-orientation-gate` dialog/status with “Rotate your device” guidance and makes `#app` inert.
2. Landscape removes the gate and inert state after the media-query change event.
3. Desktop/nontouch portrait stays usable and ungated.
4. Fullscreen is requested only from button activation; orientation lock follows only after fullscreen succeeds.
5. Missing/rejected APIs produce bounded inline guidance and no unhandled rejection.
6. `destroy()` removes listeners, overlay, and inert state.

**Design constraints:**
- Inject a small environment interface (media queries, touch capability, fullscreen request, optional orientation lock) so jsdom tests are deterministic.
- Do not use user-agent parsing.
- Do not auto-enter fullscreen or auto-lock orientation.
- Do not treat fullscreen support as required for play.

**Commands:**
- RED/GREEN: `npm.cmd test --workspace @cooking-game/client -- orientation-gate.test.ts`
- Regression: `npm.cmd test --workspace @cooking-game/client`

### Task 3: Detect touch input without breaking keyboard/mouse

**Objective:** Apply touch-specific sizing/behavior while retaining native semantics for keyboard and pointer users.

**Files:**
- Create: `apps/client/src/input/TouchControls.ts`
- Create: `apps/client/tests/touch-controls.test.ts`
- Modify: `apps/client/src/main.ts`

**RED slices:**
1. Coarse-pointer/maxTouchPoints capability sets a stable `data-touch-capable` marker.
2. `pointerdown` records touch, pen, or mouse input mode without preventing native events.
3. keyboard navigation records keyboard mode and preserves default behavior.
4. media-query changes update capability.
5. teardown removes listeners/markers.

**Design constraints:**
- This module annotates input mode only; it does not invent client-authoritative gameplay or synthesize network commands.
- Native buttons remain the action surface.
- No blanket `touchstart` prevention and no disabling browser zoom.

**Commands:**
- RED/GREEN: `npm.cmd test --workspace @cooking-game/client -- touch-controls.test.ts`
- Regression: `npm.cmd test --workspace @cooking-game/client`

### Task 4: Make all existing UI surfaces responsive and touch-safe

**Objective:** Fit the actual lobby/account, room HUD, objects, station actions, gestures, cards, drawing, and voice controls in mobile landscape without horizontal document overflow.

**Files:**
- Modify: `apps/client/src/styles.css`
- Modify if needed for semantic hooks only: `apps/client/src/ui/CommunicationPanel.ts`
- Modify: `apps/client/src/ui/DrawingBoard.ts`
- Modify: `apps/client/tests/communication-panel.test.ts`
- Modify: `apps/client/tests/lobby.test.ts`

**RED slices:**
1. Editable canvas exposes the required touch behavior hook and still emits bounded normalized pointer strokes.
2. Pointer cancellation and lost capture clear an in-progress stroke without sending it.
3. Static/structure assertions require safe-area padding, dynamic viewport units, 44px minimum touch targets, responsive nonoverflow grids, wrapping communication controls, and reduced-motion handling.

**CSS requirements:**
- Use `min-height: 100dvh` with a compatible fallback and `env(safe-area-inset-*)` padding.
- Replace fixed/minimum grid tracks that force document overflow with `minmax(min(100%, ...), 1fr)` or wrapping layouts.
- Make canvas and media `max-width: 100%`; use `touch-action: none` only on editable drawing canvas.
- Keep page pan/pinch available elsewhere.
- Ensure interactive controls are at least 44×44 CSS pixels; prefer the existing 48px baseline.
- Add `:focus-visible` treatment and `prefers-reduced-motion` animation suppression.
- Avoid hiding role/private information with CSS only; role privacy remains DOM/render-policy enforced.

**Commands:**
- RED/GREEN: targeted client tests
- Regression: `npm.cmd test --workspace @cooking-game/client`

### Task 5: Add responsive/touch and browser-engine Playwright coverage

**Objective:** Exercise production assets at representative desktop/mobile engines without multiplying the expensive full multiplayer suite across every project.

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/mobile-layout.spec.ts`
- Create: `tests/e2e/browser-support.spec.ts`
- Modify if useful: `package.json`

**Projects:**
- `chromium`: existing full suite plus new smoke/layout coverage, with fake-media flags.
- `firefox`: browser-support smoke only.
- `webkit`: browser-support smoke only (compatibility proxy, not real desktop/iOS Safari certification).
- `mobile-chrome`: mobile-layout tests using a current Playwright Android/Chrome device descriptor.
- `mobile-safari`: mobile-layout tests using a current Playwright iPhone/Safari descriptor.

**RED scenarios:**
1. Portrait touch viewport shows the orientation gate; rotating to landscape hides it and restores app interaction.
2. Landscape iOS/Android emulation has zero document-level horizontal overflow and no clipped visible controls.
3. Every visible enabled action has a bounding box at least 44×44.
4. Touch `tap()` creates a room; reload restores the same authoritative room/role.
5. After two helper clients join, the touch Blind Cook can tap pickup/drop and all clients observe authoritative state.
6. Fullscreen unavailable/rejected path leaves the app recoverable.
7. Browser-engine smoke loads the app, creates a room, and reloads/reconnects without page or console errors.

**Isolation constraints:**
- Reuse the unique per-run SQLite lifecycle from Phase 5.
- Close every context even after failure.
- Do not claim mobile emulation verifies real microphone, speaker, safe areas, or OS browser chrome.

**Commands:**
- Install engines if missing: `npx.cmd playwright install chromium firefox webkit`
- Targeted RED/GREEN: `npx.cmd playwright test tests/e2e/mobile-layout.spec.ts --project=mobile-chrome`
- Matrix: `npm.cmd run test:e2e`

### Task 6: Document support policy and physical-device gate

**Objective:** Publish an honest support matrix with exact automated and manual evidence.

**Files:**
- Create: `docs/browser-support.md`
- Modify: `docs/testing.md`
- Modify: `docs/project-status.md`
- Modify: `docs/architecture.md`
- Modify: `.hermes/phase6-red-green.md`

**Required documentation:**
- Current-major version policy and update cadence.
- Engine equivalence limits: Chromium is evidence for Chrome/Edge engine behavior; Playwright WebKit is not actual Safari certification.
- Automated project/scenario table with command and date.
- Physical iOS/Android checklist with blank result/evidence fields until performed.
- Known fullscreen/orientation API differences and playable fallback.
- Accessibility: keyboard remains supported; orientation gate only targets touch portrait.
- State Phase 6 honestly as manual-gate pending until physical tests are recorded.

### Task 7: Independent review and final verification

**Objective:** Prove Phase 6 did not weaken authority/privacy and works on the promised automated matrix.

**Review gates:**
1. Codex returns a parseable completion summary and exact test output; a failed/empty/timed-out Codex run is not approval.
2. Hermes independently reviews the full diff.
3. Independent reviewers check responsive/browser scope and accessibility/input safety.
4. Fix every blocking finding with a new failing regression first.

**Verification commands:**
- `npm.cmd test`
- Delete generated workspace declaration outputs, then `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd run test:e2e`
- `npm.cmd audit --audit-level=low`
- `npm.cmd audit --omit=dev --audit-level=low`
- `git diff --check`

**Live gate:**
1. Stop the old client/server process trees.
2. Start the new production server and fresh client.
3. Verify server/session HTTP, client HTTP 200, portrait prompt, landscape recovery, touch-sized controls, room creation/reload, and zero fresh browser errors.
4. Keep the verified app running for user inspection.

**Stop condition:** Automated implementation may be declared complete only after all automated gates pass. Overall Phase 6 remains incomplete until real iOS and Android evidence is entered in `docs/browser-support.md`.
