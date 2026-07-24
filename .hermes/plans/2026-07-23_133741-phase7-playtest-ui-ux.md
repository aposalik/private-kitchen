# Phase 7 Playtest and Game UI/UX Implementation Plan

> **For Hermes:** Execute with Planner → Codex → Tester, strict RED-GREEN-REFACTOR, and fail closed on human enjoyment claims.

**Goal:** Turn the existing all-in-one lobby dashboard into a role-first, phase-aware game operation surface and add privacy-minimal playtest evidence collection so several real three-person sessions can measure whether every role is active, understandable, and fun.

**Architecture:** Keep Colyseus authority, communication policy, recipes, accounts, and persistence unchanged. Add client-only presentation/view-state components plus a structured post-round debrief whose records stay in browser local storage until the player explicitly exports or clears them. Human playtest results live in an auditable facilitator worksheet; no result is fabricated or inferred from automation.

**Primary surface:** Operate, with a secondary Monitor rail. Actions, objective, role constraints, timer, and progress dominate; setup/account content disappears after connection.

**Tech Stack:** TypeScript, DOM APIs, CSS Grid, Vitest/jsdom, Playwright, localStorage with injected storage for tests.

---

## Constraints and accepted boundary

- Phase 6 was accepted by the user and its verified but uncommitted worktree is carried onto `feat/phase7-playtest-ui-ux`; do not commit, reset, clean, or push without explicit permission.
- No new server message, database table, API, unrestricted in-round text, role permission, recipe step, timer rule, or matchmaking behavior.
- Never expose the Recipe Keeper's private recipe to another role.
- Feedback must not contain display names, account IDs, room IDs, session IDs, IPs, audio, drawing payloads, or free text.
- Automated tests can prove mechanics and collection behavior, not fun, frustration, replay intent, or physical communication quality.

## Task 1 — Role-first briefing and objective model

**Files:**
- Create: `apps/client/src/ui/RoleBriefing.ts`
- Create: `apps/client/tests/role-briefing.test.ts`

**RED:** For each role and each phase (`WAITING`, `RUNNING`, `PAUSED`, `WON`, `LOST`), assert accessible role title, one concise objective, allowed/blocked communication guidance, and no Recipe Keeper-only recipe content in non-Keeper briefings. Observe expected missing-module failure.

**GREEN:** Implement immutable role metadata and a semantic briefing component. Use neutral Guide wording that does not introduce or alter voice mechanics. Keep copy short enough for mobile landscape.

**REFACTOR:** Centralize phase/objective mapping; avoid role logic duplicated in `Lobby`.

## Task 2 — Phase-aware Operate surface

**Files:**
- Modify: `apps/client/src/ui/Lobby.ts`
- Modify: `apps/client/src/styles.css`
- Modify: `apps/client/tests/lobby.test.ts`

**RED:** Assert the root exposes stable `data-connection-state`, `data-round-phase`, and `data-player-role`; setup/auth remains visible when disconnected; connected players get a compact role/round HUD; operational workspace is hidden before connection and setup is hidden after connection; paused and terminal states remain readable; current authority/privacy controls remain unchanged.

**GREEN:** Integrate `RoleBriefing`; classify existing markup into setup, status rail, game HUD, role workspace, kitchen actions, and communication. Drive presentation with data attributes from snapshots. Preserve all existing selectors and behavior used by tests and Playwright.

**CSS composition:**
- Disconnected: compact two-column setup, no empty round/object telemetry.
- Connected waiting: invite/seat status plus role briefing.
- Running: sticky/glanceable timer-progress-role rail; primary role workspace and actions above secondary room metadata.
- Paused: prominent reconnect banner without enabling actions.
- Terminal: result and debrief before disabled kitchen details.
- Mobile landscape: operational controls in the first viewport; 44px targets; no horizontal overflow; safe areas; reduced motion.

**Visual language:** Keep the warm dark kitchen palette; reduce equal-weight cards; use typography/spacing before adding decoration; no generic gradients, glassmorphism, emoji grids, fake metrics, or oversized marketing hero during gameplay.

## Task 3 — Privacy-minimal playtest record model

**Files:**
- Create: `apps/client/src/playtest/PlaytestFeedback.ts`
- Create: `apps/client/tests/playtest-feedback.test.ts`

**Record fields only:** schema version, role, round outcome, completed/total steps, locally observed duration seconds, participation rating 1–5, communication clarity 1–5, frustration 1–5, replay intent (`YES|MAYBE|NO`), and bounded misunderstood-signal categories (`POINT|GESTURE|EMOTE|RECIPE_CARD|DRAWING|VOICE|NONE`). A generated timestamp may be included for ordering.

**RED:** Reject malformed/out-of-range records; prove serialized/exported data omits identifiers and free text; cap storage at 30 records; survive malformed existing storage without crashing; explicit clear removes only the Phase 7 key.

**GREEN:** Implement strict runtime validation, injected `Storage`, namespaced local key, bounded append/read/clear, and deterministic JSON export content. Do not send network requests.

## Task 4 — Post-round debrief UI

**Files:**
- Create: `apps/client/src/ui/PlaytestDebrief.ts`
- Create: `apps/client/tests/playtest-debrief.test.ts`
- Modify: `apps/client/src/ui/Lobby.ts`
- Modify: `apps/client/src/styles.css`

**RED:** Debrief is absent before terminal state and visible for `WON`/`LOST`; required structured controls are keyboard/screen-reader accessible; invalid/incomplete submit is rejected; valid submit stores one sanitized record and shows confirmation; export produces JSON; clear requires an explicit button; no free-text input exists.

**GREEN:** Track locally observed running duration with a monotonic clock injected for tests. Render debrief after authoritative terminal result. Use fieldsets/legends, live confirmation, and stable selectors. Prevent duplicate submission for the same observed terminal state in one page lifecycle.

## Task 5 — Real multiplayer UX regression

**Files:**
- Modify: `tests/e2e/lobby.spec.ts`
- Modify if necessary: `tests/e2e/mobile-layout.spec.ts`

**RED/GREEN:** Extend the existing real three-context tomato-soup flow to prove:
1. each client receives its authoritative role briefing;
2. setup content is no longer the active gameplay surface after join;
3. all three clients retain their permitted actions/signals and recipe privacy;
4. terminal result exposes a debrief for every role;
5. one structured submission creates only the namespaced local record;
6. mobile landscape keeps role/objective/timer/action controls in a usable, overflow-free composition.

Do not multiply the full multiplayer scenario across engines; preserve the scoped Phase 6 matrix.

## Task 6 — Playtest protocol and evidence

**Files:**
- Create: `docs/playtesting.md`
- Create: `docs/playtest-session-template.md`
- Modify: `docs/game-design.md`
- Modify: `docs/architecture.md`
- Modify: `docs/testing.md`
- Modify: `docs/project-status.md`
- Create/update: `.hermes/phase7-red-green.md`

Document:
- three friends, three isolated devices/headsets, role rotation across sessions;
- facilitator script that does not coach during a round;
- participation, misunderstood signals, completion, frustration, observed length, and replay intent;
- export collection and deletion procedure;
- privacy boundary and no fabricated responses;
- balance decision log with hypothesis → change → retest;
- explicit automated-complete versus human-gate-pending status.

## Task 7 — Review and automated release gates

Run and record:

```bash
npm run test --workspace @cooking-game/client
npm test
npm run typecheck
npm run build
npm run test:e2e
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
git diff --check
```

Review for role privacy, server authority, local-storage bounds, accessibility, responsive layout, listener lifecycle, no secret/debug artifacts, and no accidental Phase 8 moderation/publishing work. Cleanly restart the live migrated server/client, exercise three real browser contexts, inspect desktop and mobile screenshots, and report exact evidence.

## Task 8 — Human acceptance gate

Run several real three-person sessions using `docs/playtest-session-template.md`, rotating roles. Aggregate only the structured exports. Phase 7 is complete only when:
- several sessions finish;
- every role has observable participation;
- no role is consistently idle or dominant;
- misunderstood signals and frustration are documented;
- completion rate and observed round length are recorded;
- replay intent is recorded;
- any balance/UI change is retested.

If humans have not run these sessions, report **automated implementation complete; human playtest gate pending**.
