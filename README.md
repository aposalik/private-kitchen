# Cooperative Cooking Game

A comedy-first, exactly-three-player asymmetric cooperative browser cooking game.

## Repository status

Phase 2 is complete: the authoritative Colyseus room owns deterministic, seeded
kitchen objects and permits only the Blind Cook to pick up or drop one reachable
object while the three-player room is READY. All clients observe the same
positions and ownership. Recipes, timers, voice, accounts, and matchmaking
remain later phases. See `.hermes/plans/` for the roadmap.

## Workspaces

- `apps/client` — Phaser/Vite browser game and lobby UI
- `apps/server` — authoritative Colyseus room server
- `packages/shared` — shared protocol, role, and state contracts
- `packages/recipe-schema` — versioned recipe schema and validation
- `packages/test-utils` — multiplayer test helpers
- `tests/e2e` — Playwright three-client flows
- `infra` — local PostgreSQL and LiveKit configuration
- `docs` — architecture and game-design decisions

## Commands

```bash
npm install
npm test
npm run typecheck
npm run build
npm run test:e2e
npm audit
npm audit --omit=dev
npm run dev:client
npm run dev:server
```

On this Windows machine, use `npm.cmd` if `npm` is not resolved by a non-Windows shell.

## Test three isolated clients on one PC

Start the authoritative server and browser client in separate terminals:

```bash
npm run dev:server
npm run dev:client
```

1. Open `http://localhost:5173/?player=One`, then select **Create private room**.
2. Copy the displayed room ID.
3. Open two separate browser windows or profiles at
   `http://localhost:5173/?player=Two&room=ROOM_ID` and
   `http://localhost:5173/?player=Three&room=ROOM_ID`. Those URLs auto-join.
4. A fourth window using the same room ID is rejected by the server.

Separate windows provide isolated browser sessions; using separate browser
profiles or private windows is the clearest setup when testing reconnection.
The server, not the query parameters or lobby UI, owns capacity, readiness, and
role assignment. It also owns object placement and validates every `PICK_UP`
and `DROP` command. The Blind Cook receives Pick up / Drop controls after READY;
other roles see the synchronized kitchen read-only.

## Phase 2 interaction protocol

- `PICK_UP` accepts exactly `{ objectId }`.
- `DROP` accepts exactly `{ objectId, x, y }` with finite coordinates.
- Unknown fields, oversized IDs, unauthorized roles, non-READY rooms,
  unreachable objects/destinations, invalid bounds, and conflicting ownership
  are rejected without state mutation.
- Rejections are sanitized `INTERACTION_ERROR` messages sent only to the sender.
- The kitchen spans `x=0..100`, `y=0..60`; the fixed Blind Cook reaches from
  `(50, 30)` with radius `42`. Initial seeded placements use the reachable
  `x=20..80`, `y=10..50` region.

On Windows, every command above may be run as `npm.cmd ...`, including
`npm.cmd run test:e2e` and `npm.cmd audit --omit=dev`.
