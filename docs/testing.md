# Testing Strategy

## TDD

Every behavior follows RED → GREEN → REFACTOR. Configuration/scaffold integrity is covered by `tests/structure.test.mjs`.

## Multiplayer

Integration tests start the real server on an ephemeral TCP port and
connect real `@colyseus/sdk` clients over WebSockets. They verify fewer-than-three
waiting state, the three unique roles, the ready transition, fourth-client
rejection, strict join options, reconnection identity/role preservation, seat
reservation during grace, and cleanup after expiry. Every test closes client
rooms and gracefully shuts down its server so no handles remain.

Phase 2 transport coverage adds seeded object state, successful pickup/drop and
observer synchronization, WAITING and non-Blind rejection, reach rejection,
strict invalid payload rejection, exclusive ownership, reconnect hold
preservation, and release after grace expiry or voluntary leave. Rejections are
checked for no mutation and sender-only sanitized errors. Cleanup skips already
closed SDK transports before server shutdown so no leave promises hang.

Shared tests prove deterministic placement and initial reachability. Client DOM
tests cover rendering, actions, read-only roles, errors, overlapping-connection
protection, stale callback isolation, and explicit-invite precedence. Production
Playwright creates three isolated Chromium contexts, identifies the Blind Cook
by authoritative role, reloads that browser to prove identity-preserving resume,
verifies synchronized pickup/drop and non-Blind controls, then retains
fourth-player rejection.

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
npm audit
npm audit --omit=dev
git diff --check
```

Use `npm.cmd` in place of `npm` on Windows when required.

## Phase 6 browser and mobile coverage

Playwright avoids multiplying the expensive multiplayer regression: `chromium`
owns the full suite, Firefox and WebKit run only `browser-support.spec.ts`, and
emulated Pixel Chrome and iPhone WebKit run only `mobile-layout.spec.ts`.
`npm run test:e2e` rebuilds production assets automatically; direct `npx.cmd
playwright test ...` commands serve the existing `dist`, so run `npm run build`
first after source changes. CI installs Chromium, Firefox, and WebKit in a
separate `e2e` job and runs the same rebuilding root script.

```bash
npx.cmd playwright test --list
npx.cmd playwright test tests/e2e/browser-support.spec.ts --project=firefox
npx.cmd playwright test tests/e2e/browser-support.spec.ts --project=webkit
npx.cmd playwright test tests/e2e/mobile-layout.spec.ts --project=mobile-chrome
npx.cmd playwright test tests/e2e/mobile-layout.spec.ts --project=mobile-safari
```

The production servers retain the unique per-run SQLite directory and
process-exit cleanup. Explicit smoke/mobile contexts close after failure.
Device emulation and Playwright WebKit are compatibility evidence only. Real
iOS/Android touch, safe-area, fullscreen, reconnect, microphone, speaker, and
three-device LAN checks remain the pending completion gate in
`docs/browser-support.md`.

## Phase 5 database and account coverage

Use an isolated SQLite path for local migrations:

```bash
DATABASE_URL=file:./prisma/dev.db npm run prisma:migrate --workspace @cooking-game/server
npm run prisma:generate --workspace @cooking-game/server
```

`npm run dev:server` deploys checked-in Prisma migrations before starting its watcher. Production deployments must run the migration command before starting `apps/server/dist/index.js`; runtime SQL bootstrap is test-only.

Repository and HTTP tests create temporary databases and disconnect before removal. They cover normalized uniqueness, sessions, preferences, one-time history, owner-scoped recipes, password policy, generic login failures, cookie flags, origin rejection, JSON bounds, rate limits, and authorization. Room integration tests use real cookie headers over Colyseus and verify terminal history without public identity leakage. Client DOM tests cover restoration, account actions, pending/error states, and saved-name precedence. `tests/e2e/auth.spec.ts` exercises cookie restoration, preferences, an authenticated win/history row, recipe ownership isolation, logout persistence, and guest joins in production Chromium.

The in-memory authentication limiter is deterministic and testable but is not shared between processes. Deployment behind multiple server instances needs a shared limiter before relying on it as the only brute-force control.

## Manual matrix

For Phase 2, start `npm run dev:server` and `npm run dev:client`. Create from
`http://localhost:5173/?player=One`, then open two isolated windows or profiles
with `?player=Two&room=ROOM_ID` and `?player=Three&room=ROOM_ID`. Query options
only prefill the client; all authorization remains on the server. Real voice
usability, gestures, and the communication matrix remain Phase 3 scope.

For Phase 6, use current physical iOS Safari and Android Chrome in landscape;
responsive desktop mode and Playwright emulation do not satisfy this gate.
Record versions and evidence in `docs/browser-support.md`.

## Production migration lifecycle

`npm run start --workspace @cooking-game/server` runs `prisma migrate deploy` through `prestart` before launching `dist/index.js`. Production Chromium uses this same path with a unique temporary SQLite directory; after Playwright terminates its web servers, process-exit cleanup removes the database and every journal/WAL sidecar. It must not use the test-only in-memory bootstrap path.

## Phase 7 playtest UI and evidence coverage

Client DOM tests cover all role/phase briefings, semantic guidance, setup versus
Operate visibility, stable view-state attributes, terminal ordering, monotonic
running-duration observation, accessible structured controls, duplicate
submission prevention, strict runtime validation, malformed storage, the
30-record cap, deterministic export, and key-scoped clear.

The existing Chromium Tomato Soup scenario—not a new multiplayer scenario—also
checks role briefings, inactive setup, unchanged permissions/privacy, a
terminal debrief for all roles, and the single local feedback key. The existing
mobile Chrome/WebKit scenarios check that role, objective, timer, progress, and
an entire 44px action target fit inside the first landscape viewport with no
horizontal overflow. The Phase 6 matrix remains scoped as before.

Automation cannot establish enjoyment, participation quality, frustration,
physical communication quality, or replay intent. Follow
`docs/playtesting.md` and `docs/playtest-session-template.md`; until several
real three-person role-rotated sessions are complete, the human gate is
pending.

## Phase 8 recipe coverage

Focused suites cover custom slugs, deep physical/graph bounds and sanitized
diagnostics; migration-backed lifecycle, public filtering, reports, and hashed
single-use tokens; API ownership, licenses, privacy, moderation, origins,
payloads, and rate limits; and a real custom-recipe Colyseus room proving
inventory, timer, private delivery, public-state exclusion, history, and invalid
selection rejection. Client DOM tests cover structured generation, focusable
diagnostics, explicit licenses, discovery launch, and custom terminal progress.

The post-implementation authority regression uses a valid 16-object custom
recipe. It proves exact recipe-only provisioning, dependency-first rejection,
quantity-derived progress, and a ruin/replacement cycle that remains capped at
16 objects. Migration exercises cover fresh installation and an upgrade from a
Phase 5 database through all four migrations; the upgrade asserts preserved
records, safe draft defaults, and a required test snapshot with no default.

Final automated evidence on 2026-07-24: 274/274 repository tests, all five
workspace typechecks, ordered production build, `git diff --check`, and 9/9
Playwright cases across Chromium, Firefox, WebKit, emulated Pixel Chrome, and
emulated iPhone WebKit. `npm audit --omit=dev --audit-level=high` still reports
three high advisories in Prisma development tooling through `find-my-way`; the
offered fix is a forced breaking Prisma downgrade and no reachable production
game-server path was established. This is documented, not represented as a
clean audit.

Human moderation decisions and a real exactly-three-person custom-recipe
playtest remain manual gates. Do not fabricate either. Playtest feedback remains
browser-local under the Phase 7 bounded key and is never submitted by Phase 8.
