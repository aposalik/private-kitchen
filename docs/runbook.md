# Operations Runbook

## Quick reference

| Action | Command |
| --- | --- |
| Start dev server | `npm run dev:server` |
| Start dev client | `npm run dev:client` |
| Run all unit tests | `npm test` |
| Run E2E suite | `npm run test:e2e` |
| Type-check all workspaces | `npm run typecheck` |
| Production build | `npm run build` |
| Audit prod dependencies | `npm audit --omit=dev --audit-level=high` |
| Start container stack | `cd infra && docker compose up -d` |
| View server logs | `cd infra && docker compose logs -f server` |
| Stop container stack | `cd infra && docker compose down` |

---

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes (prod) | `file::memory:` (test), `file:./prisma/dev.db` (dev) | SQLite file path. Use an absolute path or `file:/data/kitchen.db` for Docker volumes. |
| `PORT` | No | `2567` | Colyseus/HTTP server port. |
| `HOST` | No | `127.0.0.1` | Bind address. Set to `0.0.0.0` in container deployments. |
| `NODE_ENV` | No | (unset) | Set to `production` to enable secure cookie flags and tighten origin enforcement. |
| `ALLOWED_ORIGINS` | No | (empty — same-host only) | Comma-separated client origins allowed for non-safe HTTP methods, e.g. `https://game.example.com`. |
| `MODERATOR_USERNAMES` | No | (empty — no moderators) | Comma-separated account usernames granted access to `/api/moderation/*`. |

---

## Startup

### Development (local)

```bash
npm install
npm run dev:server   # terminal 1 — Colyseus + HTTP on :2567
npm run dev:client   # terminal 2 — Vite dev client on :5173
```

`predev` automatically builds shared packages, generates the Prisma client, and
runs pending migrations before the dev server starts.

### Production (container)

```bash
cd infra
docker compose up -d
```

The server container runs `prisma migrate deploy` before starting. Migrations
are idempotent; restarting a container that is already up-to-date is safe.

### Production (bare Node.js)

```bash
npm install
npm run build
DATABASE_URL=file:/absolute/path/kitchen.db \
NODE_ENV=production \
MODERATOR_USERNAMES="admin" \
npm run start --workspace @cooking-game/server
```

`prestart` runs `prisma migrate deploy` automatically.

---

## Database migrations

Migrations are managed by Prisma. Migration files live in
`apps/server/prisma/migrations/`.

```bash
# Apply all pending migrations (production)
npm run prisma:migrate --workspace @cooking-game/server

# Create a new migration during development (do not run in production)
cd apps/server
npx prisma migrate dev --name describe_your_change --config prisma.config.ts
```

**Safety rules:**
- Never delete or edit an existing migration file after it has been applied to
  any database.
- Always test a new migration against a real database (not `:memory:`) before
  deploying.
- The `ensureDatabaseSchema` server startup check fails fast if the schema is
  out of date; the server will not start with an unmigrated database.

---

## Backup and restore (SQLite)

SQLite is a single file. The standard backup is a file copy while the server is
idle, or using the SQLite `.backup` command for a live consistent copy.

### File copy (safe while server is stopped)

```bash
docker compose stop server
cp /path/to/data/kitchen.db /path/to/backups/kitchen-$(date +%Y%m%d%H%M).db
docker compose start server
```

### Live backup with sqlite3 CLI

```bash
sqlite3 /path/to/data/kitchen.db ".backup /path/to/backups/kitchen-$(date +%Y%m%d%H%M).db"
```

### Restore

```bash
docker compose stop server
cp /path/to/backups/kitchen-YYYYMMDDHHMM.db /path/to/data/kitchen.db
docker compose start server
```

---

## Health check

The server exposes `GET /health` at the same port as the game server:

```bash
curl http://localhost:2567/health
# {"status":"ok","timestamp":"2026-08-11T10:00:00.000Z","uptime":42.3}
```

Container orchestrators (Docker Compose healthcheck, Kubernetes liveness probe)
can poll this endpoint. A non-200 response or connection refused means the
process has crashed or is not accepting connections.

---

## Moderation operations

### List open recipe reports

```bash
# From a browser session logged in as a moderator:
fetch('/api/moderation/recipe-reports', { credentials: 'include' })
  .then(r => r.json()).then(console.log)
```

### Remove a reported recipe

```bash
fetch('/api/moderation/recipes/RECIPE_ID/remove', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ reason: 'Reason for removal (3–500 chars)' }),
})
```

### Restore a removed recipe

```bash
fetch('/api/moderation/recipes/RECIPE_ID/restore', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
})
```

Moderator access requires the account's username to appear in the
`MODERATOR_USERNAMES` environment variable (comma-separated). The server
normalizes usernames to lowercase before checking.

---

## Incident response

### Server process crashed

1. Check logs: `docker compose logs --tail=50 server` (container) or the
   process supervisor output.
2. Look for database schema errors at startup (migration failure) or uncaught
   exceptions in the game loop.
3. Restart: `docker compose restart server` or `npm run start --workspace ...`.
4. If repeated crashes: check disk space (`df -h /data`) and available memory.

### Database corruption

1. Stop the server immediately to prevent further writes.
2. Restore from the most recent backup (see above).
3. If no backup is available, the server will start on a fresh empty database.
   Accounts and history will be lost.

### High latency / dropped WebSocket connections

- Check server CPU and memory usage.
- Colyseus logs room count and connection count at the transport level; no
  custom metrics are currently collected.
- Reduce concurrent rooms by restarting the server during an off-peak window
  (all active rooms will be lost; players reconnect to a new room).

---

## Human gate launchers

| Gate | Script | Guide |
| --- | --- | --- |
| Three-person playtest (Phase 7) | `bash scripts/start-playtest.sh` | `docs/playtesting.md` |
| Physical device test (iOS/Android) | `bash scripts/start-device-test.sh` | `docs/device-testing.md` |
| Moderator drill (Phase 8) | `bash scripts/start-moderator-drill.sh` | Printed by the script |
