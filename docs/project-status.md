# Project Status

## Current phase

Phase 5 — Accounts and persistence: implemented, independently reviewed, and verified.

## Phase 5 delivered

- Prisma 7 SQLite accounts, hashed sessions, preferences, authoritative game history, and owner-scoped validated recipes
- bounded scrypt password authentication and opaque HttpOnly strict same-site cookies with rotation, expiry, revocation, and production Secure behavior
- same-origin Express API with strict validation, origin defense, body limits, sanitized errors, and IP-plus-normalized-username rate limiting
- Colyseus cookie identity resolution with server-only account association and one-time terminal history writes
- optional account UI with browser-restart restoration, saved display-name fill, preferences, history, owned recipes, and persistent sign-out
- Vite API proxy, repository/API/room/client tests, and a production-browser auth scenario while preserving the unchanged three-player guest scenario

## Final Phase 5 verification — 2026-07-23

- `npm.cmd test`: 192 tests passed (structure 2, client 103, server 61, recipe schema 9, shared 17)
- `npm.cmd run typecheck` and `npm.cmd run build`: all five workspaces passed; compiled Prisma ESM startup verified
- both high-severity npm audits: 0 vulnerabilities across 464 dependencies
- production Chromium: fresh database migrated through server `prestart`, then authenticated persistence/ownership/history/browser-restart and unchanged three-player lobby scenarios both passed
- persistent migration safety verified for empty, legacy raw, and correctly migrated databases; correctly migrated startup remains idempotent
- repository restart test reopens SQLite and retains account, preferences, active session, history, and owned recipe data
- `git diff --check` and security scans passed; ignored persistent development database is live and no database artifact is tracked
- live Chromium at `http://localhost:5173`: HTTP 200, account/guest controls enabled, zero page or console errors, and clean visual smoke screenshot

## Reopened Phase 5 completion correction — 2026-07-23

- added a production `prestart` migration deployment and compiled `start` command; Playwright now verifies that exact lifecycle against a unique fresh SQLite database
- expanded restart persistence verification to include active session, game history, and owner-scoped recipe data in addition to account/preferences
- reran all gates from stopped processes: 192 tests, all typechecks/builds, zero audit vulnerabilities, two production Chromium scenarios, migration matrix, security/diff checks, and clean live Chromium

## Phase 4 delivered

- strict versioned Tomato Soup contract: two tomatoes and one onion, chop, add to pot, season, boil, mix, and plate
- server-authoritative five-minute countdown with immediate timeout loss, exact pause on disconnect, and resume after reconnect or seat replacement
- authoritative bounded ingredient preparation/location, ruin-and-replacement behavior, progress, terminal win/loss, and post-result interaction lockout
- recipient-private recipe payload delivered only to the authoritative Recipe Keeper; Blind Cook and Deaf Guide never receive it
- Blind Cook-only physical and cooking commands with strict payloads, role checks, ownership/reach checks, monotonic replay protection, and server-derived outcomes
- authoritative client HUD, private Recipe Keeper instructions, contextual Blind Cook controls, pause guidance, sanitized errors, and result screens
- preserved Phase 3 enum-only communication, bounded drawing/pointing, visual exclusion, and directed audio-only WebRTC
- isolated production Chromium flow completes the entire Tomato Soup recipe, verifies privacy/timer/reconnect/communication, wins, locks controls, and rejects a fourth player

## Independent review corrections

- persisted the Phase 3 communication/voice sequence across page-reload reconnects so valid post-resume signals are not rejected as stale
- blocked pickup/drop after terminal outcomes on the server, not only in the UI
- reapplied current object-point highlights after authoritative cooking updates replace object rows without restoring timer-driven DOM churn

## Final Phase 4 verification — 2026-07-22

- `npm.cmd run test`: 168 tests passed (structure 1, client 96, server 45, recipe schema 9, shared 17)
- `npm.cmd run typecheck`: all five workspaces passed
- `npm.cmd run build`: all five ordered production builds passed
- `npm.cmd audit --audit-level=low`: 0 vulnerabilities
- `npm.cmd audit --omit=dev --audit-level=low`: 0 vulnerabilities
- production Chromium E2E: 1 scenario passed in 10.9s (8.8s test body)
- `git diff --check`: passed; line-ending notices only
- 87-file safety scan: no high-confidence secrets, unsafe dynamic execution/debuggers, BOMBANANA markers, TODO/FIXME/HACK artifacts, or credential-like files
- final Git inspection: branch `main`, base HEAD `ed98e5c`; Phase 3 and Phase 4 remain intentionally uncommitted and were not reset, cleaned, stashed, or committed

## Live development handoff

- server: port `2567`, verified accepting TCP connections with log `Kitchen server listening on port 2567`
- client: `http://localhost:5173`, verified HTTP 200
- persistent-process Chromium smoke: created a real room and received `1 / 3`, `Waiting`, and `Blind Cook` with zero page errors

## Remaining manual deployment check

- Run an audible three-physical-device microphone/speaker test on the target LAN. Automated Chromium verifies the directed WebRTC track matrix with isolated contexts and fake microphones, but cannot prove room acoustics or physical-device quality.

## Next planned slice

Phase 6 — Mobile and browser support: responsive landscape and touch support across the roadmap browser matrix.

## Earlier phase evidence

- Phase 2 trusted commit `ed98e5c`: 49 tests, five type-checks/builds, production Chromium E2E, and zero audit findings.
- Phase 3 working tree: 105 tests, five type-checks/builds, production four-context Chromium, directed fake-media WebRTC (Recipe 2 streams, Blind 1, Deaf 0), and zero audit findings.
- Detailed Phase 4 RED/GREEN history: `.hermes/phase4-red-green.md`.
