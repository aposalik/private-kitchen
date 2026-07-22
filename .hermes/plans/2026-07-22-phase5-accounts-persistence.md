# Phase 5 Accounts and Persistence Implementation Plan

> **For Hermes/Codex:** Implement task-by-task with strict RED → GREEN → REFACTOR evidence. Do not commit, reset, clean, stash, or modify unrelated Phase 3/4 work.

**Goal:** Persist optional player accounts, validated preferences, authoritative game history, and owned recipes with secure browser-restorable authentication.

**Architecture:** Keep guest play working. Mount an Express JSON API on the same Node HTTP server used by Colyseus. Use Prisma with SQLite and a repository/service boundary. Authentication uses normalized usernames plus Node `crypto.scrypt`, opaque random session tokens stored only as SHA-256 hashes, and an HttpOnly cookie. Colyseus `onAuth` resolves that cookie from `AuthContext.headers`; the room records terminal outcomes for authenticated players without trusting a client-supplied account ID. The Vite dev server proxies `/api` to port 2567 so cookies are same-origin.

**Tech stack:** TypeScript, Express 5, Zod 4, Prisma 7/SQLite, Node crypto, Vitest, Playwright.

## Non-negotiable security and compatibility requirements

- Preserve all existing guest, room, role, recipe, reconnect, communication, and voice behavior.
- No email or unnecessary PII. Username, display name, timestamps, preferences, history, and owned recipe documents only.
- Username: normalized/case-insensitive unique identity, strict 3–32 character validation. Display name remains strict 1–32 characters. Password: 12–128 characters.
- Passwords use per-user random salt and `scrypt` with explicit bounded parameters; verification uses `timingSafeEqual`. Never log or return password material.
- Session token: at least 256 random bits. Return only via `Set-Cookie`; database stores SHA-256 token hash, expiration, user, and timestamps. Cookie is `HttpOnly`, `SameSite=Strict` (or equivalently justified Lax plus origin defense), `Path=/`, finite `Max-Age`, and `Secure` in production.
- Rotate session on login/register, delete server session on sign-out, reject expired/revoked sessions, and clear invalid cookies.
- Bound JSON body size, validate strict schemas, sanitize errors, verify allowed Origin on mutating requests, and rate-limit register/login by IP plus normalized username. No user enumeration in login errors.
- Never put auth tokens in localStorage/sessionStorage, URLs, Colyseus join options, logs, API JSON, or room state.
- Authorization is mandatory for preferences/history/recipes. Recipe reads/writes must be owner-scoped and recipe documents must pass the existing versioned recipe validator. IDs are server generated.
- Record a game-history row at most once per authenticated participant when a round reaches WON or LOST. The result comes from server-owned room state, not a client endpoint.
- Database path is configurable for tests/deployments; tests use isolated temporary databases and clean shutdown.

## Task 1 — Establish Prisma persistence foundation

**Files:** create `apps/server/prisma/schema.prisma`, Prisma config/migration files required by Prisma 7, `apps/server/src/db/client.ts`, `apps/server/src/db/repository.ts`; modify package manifests/scripts.

1. RED: add persistence tests proving normalized username uniqueness, sessions, preferences, history, and owner-scoped recipes.
2. Run focused tests and record the expected missing-schema/repository failures in `.hermes/phase5-red-green.md`.
3. GREEN: implement the minimal Prisma schema and repository; generate client and create migration without committing a development database.
4. Re-run focused tests and type-check. Keep generated/runtime DB files ignored.

Suggested models: `Account`, `Session`, `GameHistory`, `OwnedRecipe`; use constrained text/integers and indexes/uniques. Store preferences and recipe documents as validated JSON text if SQLite/Prisma portability is clearer than provider JSON.

## Task 2 — Secure authentication service and HTTP API

**Files:** create modules under `apps/server/src/auth/`, API composition under `apps/server/src/http/`, server tests under `apps/server/tests/`; modify `apps/server/src/index.ts`.

1. RED: tests for register, duplicate normalized username, password policy, generic invalid login, session rotation/restoration/expiry/revocation, cookie flags, origin rejection, malformed payloads, body bounds, and bounded auth attempts.
2. GREEN: implement injected clock/randomness where needed, password hashing, opaque session service, cookie parser/serializer, rate limiter, strict Zod endpoints:
   - `POST /api/auth/register`
   - `POST /api/auth/login`
   - `POST /api/auth/logout`
   - `GET /api/auth/me`
3. Mount Express on the same `HttpServer` before Colyseus transport. Keep start/shutdown testable and close database resources.

## Task 3 — Authorized account data

**Files:** auth/account HTTP routes, repository, tests.

1. RED: unauthenticated requests receive 401; one account cannot access another account’s recipe; invalid preference/recipe bodies do not mutate storage.
2. GREEN endpoints:
   - `GET/PATCH /api/account/preferences`
   - `GET /api/account/history`
   - `GET/POST /api/account/recipes`
   - `GET/PATCH/DELETE /api/account/recipes/:id`
3. Preferences are a small strict accessibility/audio object with bounded values. Owned recipe payloads use the existing recipe-schema validator. Never accept an owner ID from the client.

## Task 4 — Authoritative room identity and history

**Files:** `apps/server/src/rooms/KitchenRoom.ts`, auth/session integration, server integration tests.

1. RED: authenticated cookie maps to `client.auth` while missing/invalid cookies remain guest; terminal WON/LOST records exactly one row per authenticated account despite duplicate ticks/disconnect callbacks; guests create no history; no account identifier leaks into public room state.
2. GREEN: resolve cookie from Colyseus `AuthContext.headers` in `onAuth`; associate only the server-resolved account ID. Inject a history recorder into rooms. Record terminal snapshots once per account/round.
3. Verify reconnect preserves the authenticated association only while the server session remains valid.

## Task 5 — Account UI and browser restoration

**Files:** create `apps/client/src/auth/AuthClient.ts`, `apps/client/src/ui/auth/AuthPanel.ts`; modify client entry/lobby/styles; add client tests and `apps/client/vite.config.ts` proxy.

1. RED: sign-up/sign-in validation, generic errors, authenticated rendering, sign-out, preferences, and initial `/api/auth/me` restoration. Assert no token is stored in Web Storage or rendered.
2. GREEN: an optional account panel that uses same-origin `fetch` with credentials. A restored account supplies its saved display name to an empty lobby name field but does not overwrite explicit invite/player values. Guest create/join remains available.
3. Add accessible labels, pending/disabled states, non-destructive errors, and no `innerHTML` insertion of user data.

## Task 6 — Browser E2E and documentation

**Files:** add `tests/e2e/auth.spec.ts`; modify Playwright config only as needed; update `docs/architecture.md`, `docs/testing.md`, `docs/project-status.md`, `.env.example` if it exists.

1. E2E: register; reload; still signed in; update preferences; create room as account; complete or deterministically force the existing server-owned test round through public controls; history appears; create an owned recipe; verify a second account cannot access its ID; sign out; reload remains signed out; guest flow still passes.
2. Verify cookies rather than localStorage hold the session; run the existing three-player E2E unchanged.
3. Document development database setup/migration, env variables, security decisions, and data-minimization policy.

## Final gates

- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm audit --audit-level=high`
- `npm audit --omit=dev --audit-level=high`
- `git diff --check`
- production Playwright E2E for existing lobby and new auth/persistence flow
- security scan of changed files for secrets, unsafe dynamic execution, token leakage, plaintext passwords, and accidental SQLite database artifacts
- persistent live server/client restart plus browser smoke at `http://localhost:5173`

## Risks and decisions

- Prisma 7 SQLite may require an explicit driver adapter/config; follow installed version APIs and test on Node 24 rather than assuming older Prisma initialization.
- Colyseus `AuthContext.headers` is the authoritative cookie bridge; do not replace it with a JavaScript-readable bearer token.
- In-memory rate limiting is acceptable for this single-process phase but must be isolated/testable and documented as not horizontally distributed.
- Do not make accounts mandatory for gameplay in Phase 5; preserving the validated guest flow avoids a scope-breaking migration.
- No commits or pushes unless the user explicitly asks.
