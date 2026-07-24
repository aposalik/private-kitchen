# Phase 7 2.5D Kitchen World Implementation Plan

> **For Hermes:** Execute Planner → Codex → Tester with strict RED-GREEN-REFACTOR. Do not claim the human playtest gate without real people.

**Goal:** Replace the long text/button gameplay dashboard with a responsive, accessible Phaser-powered 2.5D kitchen world while preserving the existing exactly-three-player roles, privacy policy, bounded communication, and server authority.

**Architecture:** Add a Phaser scene that procedurally renders an isometric kitchen from `LobbySnapshot`. A thin world adapter owns mount/update/destroy; the scene never mutates authoritative state and emits only existing `LobbyConnection` commands. A DOM hotspot/accessibility layer mirrors spatial objects and stations for pointer, keyboard, screen-reader, and Playwright use without becoming a visible dashboard. The current text recipe, communication tools, and debrief become compact role-specific overlays/drawers around the stage.

**Tech stack:** TypeScript, Phaser 3.90, DOM/CSS overlays, Vitest/jsdom for model/adapter tests, Playwright for real three-client/cross-engine/mobile verification.

---

## Non-negotiable boundaries

- Exactly three players; server-assigned immutable roles.
- Server owns room state, timers, objects, positions, actions, progress, win/loss, persistence, and reconnect behavior.
- No client-owned walking: current server state has no player coordinates. The three monkey avatars occupy fixed role stations until a future server-authoritative movement slice is explicitly approved.
- Private recipe remains Recipe Keeper-only. Communication recipients and voice policy remain unchanged.
- No unrestricted in-round text.
- Existing commands only: pickup/drop, chop/add-to-pot, terminal cooking actions, point, gesture, emote, recipe card, drawing, and voice signaling.
- Generated vector/graphics art only for this slice; no missing external asset may block first render.
- Semantic/keyboard controls must provide parity with pointer/touch controls, but the primary visible experience is the 2.5D world.

## Creative direction

- Warm after-hours private kitchen: charcoal floor, terracotta walls, amber task lights, copper stove, teal prep counter, cream serving pass.
- Isometric diamond floor with depth-sorted counters, ingredient sprites, steam/sparkle feedback, shadows, and subtle ambient animation.
- Three anthropomorphic monkey cooks at fixed role stations, differentiated by silhouette/apron color and role tool: Blind Cook at the floor, Recipe Keeper at a recipe lectern, Deaf Kitchen Guide at a gesture/sign board.
- Compact top HUD: role, timer, progress, connection/pause state.
- Recipe appears as a fold-out parchment overlay only for the Keeper; communication controls appear as compact role tool trays; terminal debrief appears only after the authoritative result.

## Task 1 — Pure world projection model

**Create:**
- `apps/client/src/game/KitchenWorldModel.ts`
- `apps/client/tests/kitchen-world-model.test.ts`

**RED:** Assert deterministic world-to-isometric projection, bounded hotspot percentages, fixed station/avatar placements, object visual states, role-safe labels, and stable depth ordering from representative `LobbySnapshot` values.

**GREEN:** Implement pure functions/types only. No Phaser or DOM import.

## Task 2 — World adapter contract and Phaser scene

**Create:**
- `apps/client/src/game/KitchenWorld.ts`
- `apps/client/src/game/scenes/KitchenScene.ts`
- `apps/client/tests/kitchen-world.test.ts`

**Modify:**
- `apps/client/src/ui/Lobby.ts`

**RED:** Inject a fake world into `Lobby`; assert mount once, update from authoritative snapshots, preserve object identity across timer-only updates, and destroy cleanly. Assert no world before connected operation.

**GREEN:** Implement a production Phaser adapter with transparent canvas, resize handling, generated textures/graphics, isometric floor/stations/objects/monkeys, depth sorting, paused/terminal treatment, and reduced-motion support.

## Task 3 — Spatial hotspot and action model

**Modify/Create:**
- `apps/client/src/game/KitchenWorld.ts`
- `apps/client/src/game/KitchenWorldModel.ts`
- `apps/client/src/ui/Lobby.ts`
- `apps/client/src/styles.css`
- corresponding unit tests

**RED:** Assert each object/station has one spatial hotspot with finite aria-label and projected position; Enter/Space and click emit only existing bounded commands; non-Blind roles cannot receive pickup/drop/cook affordances; paused/terminal states disable all actions; out-of-bounds drop coordinates are never emitted.

**GREEN:** World click selects an object/station. Context actions appear adjacent to the selection as small world chips; non-Blind primary action points. Blind Cook gets only currently legal existing actions. Preserve stable data selectors on hotspots/actions for E2E.

## Task 4 — Compact role overlays

**Modify:**
- `apps/client/src/ui/Lobby.ts`
- `apps/client/src/ui/RoleBriefing.ts`
- `apps/client/src/ui/CommunicationPanel.ts`
- `apps/client/src/styles.css`
- tests

**RED:** Assert the running first viewport is world-first; old object list and equal-weight dashboard panels are not visible; Recipe Keeper-only recipe remains private; role tools are available from accessible drawers; status/debrief remain readable.

**GREEN:** Replace the scrolling operate composition with stage + top HUD + role tool drawers. Keep hidden semantic live regions and all privacy policies.

## Task 5 — Real multiplayer and responsive E2E

**Modify:**
- `tests/e2e/lobby.spec.ts`
- `tests/e2e/mobile-layout.spec.ts`

**RED/GREEN acceptance:**
1. Three contexts render one stage each and all three assigned monkey roles.
2. Recipe is visible only to Recipe Keeper.
3. Blind Cook selects a world ingredient, picks it up, chops it, drops it, later adds it to the pot, and server progress updates for all clients.
4. Recipe Keeper/Guide click world targets to point but never receive ingredient-manipulation affordances.
5. Communication recipient tests remain unchanged.
6. Pause/reconnect and terminal/debrief remain authoritative.
7. Desktop and mobile landscape have no horizontal overflow; stage and primary role action fit in the first viewport; active hotspots are at least 44×44 CSS pixels.
8. Chromium/Firefox/WebKit/mobile projects load fresh production assets without page or console errors.

## Task 6 — Visual QA, documentation, and release gates

**Modify:**
- `docs/game-design.md`
- `docs/architecture.md`
- `docs/testing.md`
- `docs/project-status.md`
- `.hermes/phase7-red-green.md`

**Verify:**
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run test:e2e`
- `npm audit --audit-level=low`
- `npm audit --omit=dev --audit-level=low`
- `git diff --check`
- secret/debug/dynamic-code scan
- clean migrated production restart
- three-context desktop screenshot plus mobile landscape screenshot
- visual review for depth, clipping, readability, private overlays, and interaction clarity

## Task 7 — Human acceptance

Run several real three-person sessions with role rotation using `docs/playtest-session-template.md`. Record misunderstandings, participation, completion, frustration, round length, and replay intent. Retest any resulting balance/UI changes. Until this occurs, report: **2.5D implementation and automated verification complete; human playtest gate pending.**
