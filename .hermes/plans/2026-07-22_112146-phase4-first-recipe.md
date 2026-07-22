# Phase 4 First Recipe Vertical Slice Implementation Plan

> **For Hermes:** Implement task-by-task with Codex as primary coder, strict RED→GREEN evidence, then independent authority/privacy/lifecycle review.

**Goal:** Three players can win or lose one server-authoritative Tomato Soup round without debug controls.

**Architecture:** A strict versioned recipe package loads trusted JSON. `KitchenRoom` composes recipe, cooking, and timer systems; all client commands are finite, strictly validated, session-derived, and Blind-Cook-only. Public round state is synchronized through Colyseus, while full recipe instructions are sent privately and idempotently only to the Recipe Keeper. A server clock owns the five-minute countdown, pauses during reconnect, resumes when all seats return, ends immediately on timeout, and clears on disposal.

**Tech stack:** TypeScript 7, Zod 4, Colyseus 0.17, Vitest 4, Vite 8, Playwright Chromium.

---

## Fixed product decisions

- Recipe: Tomato Soup requiring two tomatoes and one onion.
- Ordered flow: chop each ingredient; add each chopped ingredient to pot; season; boil; mix; plate.
- Round starts automatically when the third connected player makes the room READY.
- Default duration: 300,000 ms; tests inject shorter durations.
- Disconnect policy: authoritative timer pauses while room is WAITING and resumes from the same remaining time after reconnect/replacement.
- Expiration policy: immediate server-authored loss with reason `TIME_EXPIRED`.
- Ruin/replacement policy: a second valid CHOP of an already chopped required ingredient marks that instance ruined and creates one fresh raw replacement of the same kind at a bounded deterministic position. Replayed/stale command sequences are rejected and cannot ruin twice.
- Only Blind Cook may send cooking actions. Client-supplied role, stage, progress, time, outcome, identity, recipe, or replacement data are never trusted.
- Recipe title, ingredients, and ordered instructions are delivered only to Recipe Keeper via a strict private server message, including reconnect/bootstrap delivery.
- Public state contains only round status, remaining time, coarse progress, object preparation/location, and final outcome.

## Task 1 — Versioned recipe contract

**Files:**
- Create `packages/recipe-schema/src/schema.ts`
- Create `packages/recipe-schema/src/validator.ts`
- Create `packages/recipe-schema/recipes/tomato-soup.json`
- Modify `packages/recipe-schema/src/index.ts`
- Create `packages/recipe-schema/tests/recipe.test.ts`

**RED:** Tests reject unknown fields, duplicate step IDs, unsupported actions, impossible ingredient references, non-positive duration/counts, unordered dependencies, and malformed bundled JSON.

**GREEN:** Export immutable parsed Tomato Soup definition and strict validator; no runtime client input loads recipe files.

## Task 2 — Shared finite round protocol

**Files:**
- Modify `packages/shared/src/actions.ts`
- Modify `packages/shared/src/game-state.ts`
- Modify `packages/shared/src/state.ts`
- Modify `packages/shared/src/index.ts`
- Add/update shared tests.

**RED:** Exact finite action/status/outcome/object-state contracts; strict unknown-field rejection and bounded IDs/sequences.

**GREEN:** Add `COOK_ACTION`, `ROUND_READY`, `PRIVATE_RECIPE`, and cooking errors with finite action IDs (`CHOP`, `ADD_TO_POT`, `SEASON`, `BOIL`, `MIX`, `PLATE`).

## Task 3 — Server-authoritative recipe/cooking/timer systems

**Files:**
- Create `apps/server/src/systems/recipe-system.ts`
- Create `apps/server/src/systems/cooking-system.ts`
- Create `apps/server/src/systems/timer-system.ts`
- Modify `apps/server/src/rooms/KitchenRoom.ts`
- Add `apps/server/tests/recipe.integration.test.ts`

**Vertical TDD slices:**
1. READY starts one round and only Recipe Keeper receives private recipe.
2. Non-Blind, malformed, stale, replayed, out-of-order, wrong-object, and post-result actions reject sender-only without mutation.
3. Correct two-tomato/one-onion flow advances exactly once and wins only after PLATE.
4. Repeated chop ruins one ingredient and creates exactly one deterministic bounded replacement.
5. Server time decreases; disconnect pauses; reconnect resumes; expiration loses; dispose clears timers.
6. Private recipe bootstrap is idempotent and reconnect-safe; replacement Recipe Keeper receives it, others never do.

## Task 4 — Client round UI

**Files:**
- Create `apps/client/src/ui/RoundTimer.ts`
- Create `apps/client/src/ui/RecipePanel.ts`
- Create `apps/client/src/ui/ResultScreen.ts`
- Modify `apps/client/src/network/RoomClient.ts`
- Modify `apps/client/src/ui/Lobby.ts`
- Modify `apps/client/src/styles.css`
- Update client tests.

**RED:** Strict private recipe parsing, Recipe-Keeper-only rendering, finite Blind-Cook cooking actions, timer states, result win/loss, reconnect pause, no post-result controls, and untrusted text rendered only with `textContent`.

**GREEN:** Accessible controls and status components integrated without exposing private recipe to Blind/Deaf snapshots or DOM.

## Task 5 — Production E2E

**Files:**
- Modify `tests/e2e/lobby.spec.ts`

**Acceptance:** Three isolated contexts prove private recipe visibility, server timer, role restrictions, complete Tomato Soup sequence, synchronized win result, retained Phase 2/3 communication/voice behavior, reconnect, and fourth-client rejection. Integration tests prove timeout loss and replacement branch.

## Task 6 — Independent review and full gates

- Review authority, privacy, timer races, reconnect, stale/replay handling, object replacement bounds, result terminality, cleanup, XSS, and Phase 2/3 regressions.
- Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`, both audits, `git diff --check`, source/secret scans, and `npm.cmd run test:e2e`.
- Update `docs/project-status.md`, `.hermes/phase4-red-green.md`, and workspace tracking.
- Do not commit or push unless explicitly requested.
