# Cooperative Cooking Game

A comedy-first, exactly-three-player asymmetric cooperative browser cooking game.

## Repository status

Phase 0 scaffold only. Gameplay is intentionally not implemented yet. See `.hermes/plans/` for the roadmap.

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
npm run dev:client
npm run dev:server
```

On this Windows machine, use `npm.cmd` if `npm` is not resolved by a non-Windows shell.
