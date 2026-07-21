# Cooperative Cooking Game Implementation Plan

> **For Hermes:** Implement each vertical feature with Planner → Developer → Tester review and strict RED-GREEN-REFACTOR.

**Goal:** Build a comedy-first, exactly-three-player, 2.5D/isometric browser cooking game with asymmetric communication roles, authoritative multiplayer, recipe timers, accounts, matchmaking, mobile landscape support, and player-created recipes.

**Architecture:** An npm-workspaces monorepo separates the Phaser client, authoritative Colyseus server, shared protocol/state types, and recipe schema. PostgreSQL stores users, rooms/history, and published recipes. LiveKit/WebRTC handles server-permitted role-restricted voice. The first milestone is one private room and one recipe; public matchmaking and recipe publishing follow only after the communication loop is proven fun.

**Tech Stack:** TypeScript, Vite, Phaser 3, Node.js, Colyseus, PostgreSQL, Prisma, LiveKit/WebRTC, Vitest, Playwright, Docker Compose, GitHub Actions.

---

## Product rules already decided

- Exactly three players.
- Roles: Blind Cook, Non-Speaking Recipe Keeper, Deaf Kitchen Guide.
- 2.5D/isometric fixed-station kitchen; no walking in the initial design.
- One global server-controlled timer per recipe.
- Ingredient placement randomized by the server every round.
- No unrestricted text during a round.
- Desktop and mobile browsers; mobile uses landscape orientation.
- Private invite codes and later public/random matchmaking.
- Accounts and persistent data.
- User-created recipes are a core differentiator.

## Target repository structure

```text
cooperative-cooking-game/
├── .github/workflows/ci.yml
├── .hermes/plans/
├── apps/
│   ├── client/
│   │   ├── public/
│   │   ├── src/game/scenes/
│   │   ├── src/game/entities/
│   │   ├── src/network/
│   │   ├── src/voice/
│   │   ├── src/ui/
│   │   └── tests/
│   └── server/
│       ├── src/rooms/
│       ├── src/systems/
│       ├── src/auth/
│       ├── src/db/
│       └── tests/
├── packages/
│   ├── shared/src/
│   ├── recipe-schema/src/
│   └── test-utils/src/
├── tests/e2e/
├── infra/
│   ├── docker-compose.yml
│   └── livekit.yaml
├── docs/
│   ├── architecture.md
│   ├── game-design.md
│   ├── communication-matrix.md
│   ├── recipe-format.md
│   └── testing.md
├── package.json
├── tsconfig.base.json
└── README.md
```

---

## Phase 0 — Foundation and decision control

**Planner:** Freeze the MVP rules and open questions in `docs/game-design.md` and architecture boundaries in `docs/architecture.md`.

**Developer:** Create the npm-workspaces monorepo, TypeScript configs, lint/test scripts, environment template, and package boundaries.

**Tester:** Add `tests/structure.test.mjs` first, run it while required files are missing to verify RED, then create the scaffold and verify GREEN. Run install, build, typecheck, and tests.

**Exit criteria:** Fresh clone can install dependencies and run all root validation commands.

## Phase 1 — Three-player room tracer bullet

**Goal:** Three isolated browser clients join one authoritative private room.

**Files likely to change:**
- `packages/shared/src/roles.ts`
- `packages/shared/src/protocol.ts`
- `apps/server/src/rooms/KitchenRoom.ts`
- `apps/client/src/network/RoomClient.ts`
- `apps/client/src/ui/Lobby.ts`
- `tests/e2e/three-player-room.spec.ts`

**TDD slices:**
1. Reject a fourth player.
2. Prevent round start with fewer than three players.
3. Assign each role exactly once.
4. Reconnect a dropped player to the same role.
5. Join three Playwright contexts to one room.

**Exit criteria:** Three local windows connect; server rejects player four; reconnect works.

## Phase 2 — Authoritative interaction loop

**Goal:** Blind Cook manipulates randomized ingredients while other roles remain unauthorized.

**Files likely to change:**
- `packages/shared/src/actions.ts`
- `packages/shared/src/game-state.ts`
- `apps/server/src/systems/interaction-system.ts`
- `apps/server/src/systems/randomization-system.ts`
- `apps/client/src/game/scenes/KitchenScene.ts`
- `apps/server/tests/interaction-system.test.ts`

**TDD slices:** role rejection, reach validation, exclusive object ownership, deterministic seeded random placement, drop synchronization.

**Exit criteria:** Only Blind Cook can pick up/drop; all three clients see the same server state.

## Phase 3 — Communication mechanics

**Goal:** Implement pointing, gestures, emotes, limited cards, head/facial animation signals, constrained drawing, and the role communication matrix.

**Files likely to change:**
- `packages/shared/src/communication.ts`
- `apps/server/src/systems/communication-system.ts`
- `apps/client/src/voice/VoiceSession.ts`
- `apps/client/src/ui/GestureWheel.ts`
- `apps/client/src/ui/DrawingBoard.ts`
- `docs/communication-matrix.md`

**Voice policy:** Blind publishes/receives; Recipe Keeper receives but cannot publish microphone audio; Deaf Guide publishes but cannot receive. Enforce with server-issued media permissions, not UI-only muting.

**Exit criteria:** Automated permission tests pass and a three-device manual voice test completes the communication chain.

## Phase 4 — First recipe vertical slice

**Goal:** Complete one simple recipe from selection to result screen.

**Suggested first recipe:** Tomato soup: identify two tomatoes and one onion, chop, pour into pot, season, boil, mix, plate.

**Files likely to change:**
- `packages/recipe-schema/src/schema.ts`
- `packages/recipe-schema/src/validator.ts`
- `packages/recipe-schema/recipes/tomato-soup.json`
- `apps/server/src/systems/recipe-system.ts`
- `apps/server/src/systems/cooking-system.ts`
- `apps/server/src/systems/timer-system.ts`
- `apps/client/src/ui/RoundTimer.ts`
- `apps/client/src/ui/ResultScreen.ts`

**TDD slices:** valid recipe schema, invalid step rejection, timer owned by server, pause/reconnect policy, correct completion, expiration loss, replacement of ruined ingredients.

**Exit criteria:** Three humans can finish or lose one timed recipe without debug controls.

## Phase 5 — Accounts and persistence

**Goal:** Persist identity, preferences, game history, and recipe ownership.

**Files likely to change:**
- `apps/server/prisma/schema.prisma`
- `apps/server/src/auth/`
- `apps/server/src/db/`
- `apps/client/src/ui/auth/`

**Security requirements:** Password hashing or trusted OAuth, secure cookies/tokens, rate limits, input validation, no secrets in the client, and minimal personal data.

**Exit criteria:** Account creation/sign-in/sign-out and reconnect across browser restart work; authorization tests pass.

## Phase 6 — Mobile and browser support

**Goal:** Playable landscape UI on supported desktop/mobile browsers.

**Target policy:** Current major Chrome, Edge, Firefox, desktop Safari, iOS Safari, and Android Chrome.

**Files likely to change:**
- `apps/client/src/ui/OrientationGate.ts`
- `apps/client/src/input/TouchControls.ts`
- `tests/e2e/mobile-layout.spec.ts`
- `docs/browser-support.md`

**Exit criteria:** Responsive/touch Playwright checks pass; real iOS and Android tests verify mic, touch, landscape prompt/fullscreen, and reconnect.

## Phase 7 — Playtest and game-balance gate

**Goal:** Prove three friends enjoy the communication loop.

**Measure:** role participation, misunderstood signals, round completion rate, frustration points, average round length, replay intent.

**Exit criteria:** At least several three-person sessions complete; no role is idle or dominant; documented changes are retested.

## Phase 8 — User-created recipe system

**Goal:** Users create, validate, privately test, publish, report, and discover recipes.

**Files likely to change:**
- `packages/recipe-schema/src/validator.ts`
- `apps/client/src/ui/recipe-editor/`
- `apps/server/src/recipes/`
- `apps/server/src/moderation/`
- `docs/recipe-format.md`

**Required safeguards:** impossible-recipe detection, schema/version validation, content moderation, rate limits, reports, ownership/license terms, and removal tools.

**Exit criteria:** A user can create and play a valid recipe; invalid/unwinnable recipes cannot be published.

## Phase 9 — Public matchmaking

**Goal:** Match exactly three compatible players by region and role preference.

**Requirements:** queue timeout, ready check, cancellation, disconnect penalties kept comedy-friendly, region/latency selection, abuse reporting.

**Exit criteria:** Automated queue tests and controlled load tests pass.

## Phase 10 — Production hardening and release

**Goal:** Secure, observable, deployable release candidate.

**Work:** CI/CD, container deployment, TLS, database backups/migrations, logs/metrics/traces, WebSocket load tests, WebRTC quality testing, privacy/terms, moderation operations, accessibility review, and original-IP review.

**Exit criteria:** Staging soak test, disaster-recovery check, cross-browser matrix, security review, and release checklist pass.

---

## Quality gates for every phase

1. Planner writes acceptance criteria and protocol changes.
2. Developer writes one failing behavior test and confirms the expected failure.
3. Developer implements only enough to pass.
4. Tester runs focused test, full suite, typecheck, build, and relevant manual test.
5. Planner records decisions and removes unnecessary scope.
6. Commit only a green, reviewable vertical slice.

## Main risks

- Browser microphone/autoplay/orientation differences, especially iOS Safari.
- Voice cheating through external tools cannot be technically prevented.
- Verbatim speech bubbles or unrestricted drawing can destroy the communication puzzle.
- User recipes require substantial validation and moderation.
- Isometric fixed stations must keep every required Blind Cook action reachable.
- “All browsers” must remain a formal supported-browser matrix, not a literal promise.

## Immediate execution scope

This scaffold task creates Phase 0 only. It must not prematurely implement game mechanics. After Phase 0, the next engineering task is Phase 1’s three-player room tracer bullet.
