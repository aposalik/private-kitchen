# Architecture

## Boundaries

- Client renders and sends intentions; it never decides authoritative outcomes.
- Server owns rooms, roles, randomization, timers, objects, cooking, recipes, and completion.
- Shared package owns wire contracts without browser or server side effects.
- Recipe schema is versioned and validates built-in and user-created recipes.
- Voice permissions are issued server-side and enforced by the media service.

## First vertical slice

Three isolated clients join one private Colyseus room. The room rejects player four, starts only with exactly three players, assigns each role once, and supports reconnect.

## Phase 1 room authority

- `apps/server/src/index.ts` starts `@colyseus/core` with
  `@colyseus/ws-transport`; the broad `colyseus` package is not used.
- `KitchenRoom` is private and has three authoritative seats. Join payloads are
  strict, bounded `{ displayName }` values. Clients cannot submit a role or
  mutate readiness.
- Roles are assigned deterministically in connection order: first
  `BLIND_COOK`, then `RECIPE_KEEPER`, then `DEAF_KITCHEN_GUIDE`. A role stays
  reserved with its player throughout the reconnection grace period.
- State is `WAITING` unless exactly three players are currently connected. It
  becomes `READY` at three; Phase 1 does not start cooking gameplay.
- An unexpected disconnect reserves the identity and role for 10 seconds by
  default. Reconnection restores the same Colyseus session. Expiry removes the
  player, releases the role, and recalculates readiness.
- Shared role, state, and join contracts live under `packages/shared/src`.
  Colyseus schema instances are server-owned wire representations of those
  contracts.

## Phase 2 interaction authority

- `KitchenState` exposes a server-generated placement seed and a schema map of
  objects. Each object has a stable ID, kind, label, finite position, and an
  empty or owning `heldBy` session ID. Clients render snapshots and send intent;
  they never write schema state.
- Seeded placement uses a deterministic shared generator, never `Math.random`.
  An explicit seed reproduces IDs, kinds, labels, and unique non-overlapping
  positions. Production rooms generate a fresh seed with the platform
  cryptographic UUID source.
- Kitchen bounds are `x=0..100`, `y=0..60`. The fixed Blind Cook interaction
  origin is `(50, 30)` with radius `42`. Initial placement is restricted to
  `x=20..80`, `y=10..50`, inside both the kitchen and reachable area.
- Message names are `PICK_UP`, `DROP`, and server-to-sender
  `INTERACTION_ERROR`. Zod validates strict payloads: pickup is exactly
  `{ objectId }`; drop is exactly `{ objectId, x, y }`, with bounded object IDs,
  finite numbers, and no unknown fields.
- The server gates interaction on READY status and the `BLIND_COOK` role, then
  checks existence, reach, kitchen bounds, holder, and at most one held object
  per player. Invalid commands return a sanitized code/message only to the
  sender and do not mutate or terminate the room.
- `onDrop` keeps held ownership during reconnection grace. Reconnect restores
  the same session and hold. Confirmed voluntary leave or grace expiry runs
  `onLeave`, releases held objects at their last valid coordinates, then removes
  the player.

The browser panel lists synchronized objects and holder status. The Blind Cook
gets READY-gated Pick up / Drop controls; other roles get read-only guidance and
no interaction buttons. Dynamic state and errors are assigned with `textContent`.
