# Cooperative Cooking Game

A comedy-first, exactly-three-player asymmetric cooperative browser cooking game.

## Repository status

Phase 8 is complete: owner-created custom recipes with a full publish, discover,
play, and moderation lifecycle. Automated E2E covers the complete recipe
lifecycle and a three-player custom recipe game. Human gates (moderator drill,
exactly-three-person custom recipe playtest, physical iOS/Android device test,
and Phase 7 role-rotated playtests) remain pending.

See `docs/project-status.md` for a full phase-by-phase record and
`docs/release-checklist.md` before any public deployment.

## Workspaces

- `apps/client` — Vite browser game and lobby UI
- `apps/server` — authoritative Colyseus room server
- `packages/shared` — shared protocol, role, and state contracts
- `packages/recipe-schema` — versioned recipe schema and validation
- `packages/test-utils` — multiplayer test helpers
- `tests/e2e` — Playwright three-client flows
- `infra` — Docker Compose for container deployment
- `docs` — architecture, game design, and operations documentation

## Commands

```bash
npm install
npm test                        # unit tests (server, client, recipe-schema, shared)
npm run typecheck               # all five workspace type-checks
npm run build                   # production build
npm run test:e2e                # full Playwright suite
npm audit --omit=dev            # production dependency audit
npm run dev:client              # Vite dev client on :5173
npm run dev:server              # Colyseus dev server on :2567
```

On Windows, use `npm.cmd` if `npm` is not resolved by a non-Windows shell.

## Development setup

Start the server and client in separate terminals:

```bash
npm run dev:server
npm run dev:client
```

Then open `http://localhost:5173` in three browser windows (or profiles) to
simulate three players.

- Window 1: create a private room and copy the room ID.
- Window 2 and 3: join via `http://localhost:5173/?room=ROOM_ID`.
- A fourth window using the same room ID is rejected by the server.

## Container deployment

```bash
cd infra
docker compose up -d
docker compose logs -f server
```

The server listens on port 2567. Set `ALLOWED_ORIGINS`, `MODERATOR_USERNAMES`,
and `DATABASE_URL` (pointing to a persistent volume path) in the environment or
a `.env` file beside `docker-compose.yml`. See `docs/runbook.md`.

## Health check

```bash
curl http://localhost:2567/health
# {"status":"ok","timestamp":"2026-08-11T10:00:00.000Z","uptime":42.3}
```

## Human gate launchers

```bash
bash scripts/start-playtest.sh         # Phase 7 three-person session
bash scripts/start-device-test.sh      # iOS/Android physical device test
bash scripts/start-moderator-drill.sh  # Phase 8 moderation drill
```

## Documentation

| File | Contents |
| --- | --- |
| `docs/project-status.md` | Phase-by-phase implementation and verification record |
| `docs/runbook.md` | Startup, migrations, backup, moderation operations, incident response |
| `docs/release-checklist.md` | Pre-deployment gates and post-deploy smoke checks |
| `docs/playtesting.md` | Phase 7 human playtest protocol |
| `docs/browser-support.md` | Browser matrix, physical device gate evidence table |
| `docs/device-testing.md` | iOS Safari and Android Chrome setup guide |
