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

## Phase 5 database and account coverage

Use an isolated SQLite path for local migrations:

```bash
DATABASE_URL=file:./prisma/dev.db npm run prisma:migrate --workspace @cooking-game/server
npm run prisma:generate --workspace @cooking-game/server
```

Repository and HTTP tests create temporary databases and disconnect before removal. They cover normalized uniqueness, sessions, preferences, one-time history, owner-scoped recipes, password policy, generic login failures, cookie flags, origin rejection, JSON bounds, rate limits, and authorization. Room integration tests use real cookie headers over Colyseus and verify terminal history without public identity leakage. Client DOM tests cover restoration, account actions, pending/error states, and saved-name precedence. `tests/e2e/auth.spec.ts` exercises cookie restoration, preferences, an authenticated win/history row, recipe ownership isolation, logout persistence, and guest joins in production Chromium.

The in-memory authentication limiter is deterministic and testable but is not shared between processes. Deployment behind multiple server instances needs a shared limiter before relying on it as the only brute-force control.

## Manual matrix

For Phase 2, start `npm run dev:server` and `npm run dev:client`. Create from
`http://localhost:5173/?player=One`, then open two isolated windows or profiles
with `?player=Two&room=ROOM_ID` and `?player=Three&room=ROOM_ID`. Query options
only prefill the client; all authorization remains on the server. Real voice
usability, gestures, and the communication matrix remain Phase 3 scope.
