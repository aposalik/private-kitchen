# Project Status

## Current phase

Phase 8 — User-created recipes: implementation and automated verification
complete; human moderation, physical-device, and exactly-three-person playtest
gates pending. Phase 7's human playtest gate also remains pending.

## Phase 7 automated infrastructure verification — 2026-08-11

Automated verification of the complete Phase 7 playtest infrastructure:

- `PlaytestFeedbackStore`: append, read, clear, exportJson, 30-record cap,
  expiry-aware schema validation; 7 unit tests passed
- `PlaytestDebrief` UI: absent without a terminal context, renders for WON/LOST,
  5 structured fieldsets with 4 required selects and 7 signal checkboxes, no
  free-text input, rejects incomplete submission, stores one sanitized record
  per page lifecycle, export triggers JSON download, clear empties the store and
  updates the live confirmation region; 4 unit tests passed
- Full three-player Chromium E2E: complete game WON, on-device debrief visible,
  submit saves to localStorage with all 12 documented fields, export downloads
  `cooperative-cooking-playtest-feedback.json` containing the correct record,
  clear empties localStorage and updates the confirmation region
- `scripts/start-playtest.sh`: LAN launcher that starts the Colyseus server and
  Vite client, detects the machine's LAN IP, and prints the facilitator checklist
  with rotation order, per-round steps, and the protocol reference

Total: 356 tests passed (server 89, client 238, recipe-schema 11, shared 18);
all five workspace typechecks and builds passed; Playwright full-round Chromium
scenario passed including export download and clear assertions.

Human gate remains pending: several real three-person role-rotated sessions are
required. Run `bash scripts/start-playtest.sh` and follow `docs/playtesting.md`.

## Physical device gate infrastructure — 2026-08-11

Infrastructure for the pending physical iOS Safari and Android Chrome gate:

- `apps/client/vite.device-test.ts`: HTTPS overlay Vite config that reads
  `DEVICE_TEST_CERT` and `DEVICE_TEST_KEY` env vars (cert/key PEM paths) and
  merges them onto the base config; fails clearly at startup if the env vars are
  absent so it is never used accidentally outside the device-test script
- `scripts/start-device-test.sh`: generates a 24-hour self-signed TLS cert via
  `openssl` for the machine's LAN IP (SAN includes the IP and localhost), starts
  the Colyseus server and the Vite HTTPS client, exports the cert/key paths, and
  prints the device testing checklist; removes the cert directory on exit
- `docs/device-testing.md`: comprehensive guide covering the full test matrix,
  iOS Safari and Android Chrome certificate acceptance steps, microphone
  permission flow, role-filtered audio verification protocol, three-device LAN
  round procedure, and troubleshooting (cert trust, firewall, WebSocket, portrait
  lock)
- `docs/browser-support.md`: physical-device gate section updated to reference
  `bash scripts/start-device-test.sh` as the authoritative entry point and
  `docs/device-testing.md` for platform-specific details; superseded inline
  `@vitejs/plugin-basic-ssl` manual steps removed

Total unit tests remain 356; no new automated tests (the gate is inherently
manual). The automated Playwright matrix (5 projects, 9 cases) continues to
cover emulated Pixel Chrome and iPhone WebKit for layout and touch regressions.

Physical gate remains pending: a real iOS Safari device and a real Android
Chrome device must each pass the full matrix in `docs/browser-support.md` and
results recorded there before the gate is closed. Run
`bash scripts/start-device-test.sh` and follow `docs/device-testing.md`.

## Phase 8 human gate infrastructure verification — 2026-08-11

Automated verification of the Phase 8 human gate drill infrastructure:

- `playwright.config.ts`: added `MODERATOR_USERNAMES: "e2e-moderator"` to the
  E2E server environment so the designated account can exercise the moderation
  endpoints (`GET /api/moderation/recipe-reports`,
  `POST /api/moderation/recipes/:id/remove`,
  `POST /api/moderation/recipes/:id/restore`) during Playwright runs
- Moderator drill E2E (`tests/e2e/moderation.spec.ts`): registers three isolated
  accounts (moderator, recipe owner, reporter); owner creates a 1-carrot recipe,
  validates, and publishes under CC0; reporter searches, opens the report form,
  and submits a reason and detail; moderator verifies the report appears in the
  moderation list, removes the recipe (204; discovery returns 0 results), then
  restores it (204; discovery returns 1 result again)
- Custom recipe 3-player E2E (`tests/e2e/custom-recipe-playtest.spec.ts`): owner
  creates and publishes a 1-carrot recipe, discovers it in the studio, clicks
  Launch, creates a room, two guests join, Blind Cook completes all 6 steps
  (chop, add-to-pot, season, boil, mix, plate with 6 / 6 progress), and all
  three players reach the WON terminal screen
- `scripts/start-moderator-drill.sh`: LAN launcher that starts the full dev
  stack with a configurable `MODERATOR_USERNAMES` env and prints a step-by-step
  drill guide with in-browser fetch snippets for each moderator API call

Total unit tests remain 356 (server 89, client 238, recipe-schema 11, shared 18);
two new Playwright E2E scenarios added to `tests/e2e/`.

Human gates remain pending: a real moderator must execute the report→review→
remove→restore drill from a live browser session, and a real three-person team
must complete a game with a custom recipe. Run
`bash scripts/start-moderator-drill.sh` for the moderation drill and
`bash scripts/start-playtest.sh` for the custom recipe playtest.

## Phase 8 final automated verification — 2026-07-24

- immutable publication, private-test, active-room, and historical recipe
  snapshots, with Recipe Keeper-only ordered instructions
- owner-scoped drafts; licensed publication; privacy-safe discovery; bounded
  reporting; server-allowlisted moderation remove/restore
- server-resolved room selections, recipe-only inventory, dependency-driven
  legal actions/progress, exactly-three-player roles, and a 16-object cap
- four cumulative Prisma migrations passed on fresh and simulated existing
  Phase 5 databases; the live three-migration database upgraded incrementally
  with only `20260724114500_fail_closed_test_snapshots`
- 274/274 tests passed; all five workspace typechecks and ordered production
  build passed; `git diff --check` passed
- 9/9 production Playwright cases passed across Chromium, Firefox, WebKit,
  emulated mobile Chrome, and emulated mobile Safari
- clean production-like restart at `http://127.0.0.1:4173`; server listening on
  port 2567; browser console and JavaScript error lists were empty
- production-only audit reports three high advisories through Prisma's
  development-tooling dependency on `find-my-way`; no reachable game-server
  runtime path was established, and the offered fix is a forced breaking Prisma
  downgrade
- no human moderation, physical iOS/Android, LAN/audio, or real three-person
  result is claimed

## Phase 7 automated implementation — 2026-07-23

- role-first, phase-aware Operate surface with setup hidden after connection
  and secondary room metadata below objectives, HUD, actions, and signals
- private Recipe Keeper rows expose repeated action quantity (`× 2`) so the
  finite recipe list reconciles with the authoritative 10-step progress HUD
- neutral Deaf Kitchen Guide briefing copy with the existing voice policy,
  server authority, stable selectors, and Recipe Keeper privacy unchanged
- browser-local, strict structured feedback with a 30-record cap,
  deterministic JSON export, key-scoped clear, and no feedback network path
- accessible terminal debrief with pause-excluded monotonic observed duration
  and one submission per observed terminal round in a page lifecycle
- account controls remain hidden during active play but return below the
  terminal debrief, preserving history and sign-out without reopening setup
- existing full Chromium round and existing mobile Chrome/WebKit scenarios
  extended without expanding the Phase 6 browser matrix
- automated verification: 167 client tests and 256 root tests passed; all five
  workspace typechecks/builds passed; the rebuilt 9-case Playwright matrix
  passed across Chromium, Firefox, WebKit, emulated mobile Chrome, and emulated
  mobile Safari, with no leaked temporary database directories
- both full and production-only dependency audits report zero vulnerabilities;
  `git diff --check`, Phase 7 secret/debug scans, and live browser console checks
  pass
- fresh detached production restart at `http://127.0.0.1:4173`: client HTTP 200,
  unauthenticated account API 401 as designed, real room created at 1 / 3 with
  the role-first Operate surface, and zero browser console/page errors
- automated tests do not claim fun, participation quality, frustration,
  physical communication quality, or replay intent; several real
  three-person role-rotated sessions remain required

## Phase 6 implementation — 2026-07-23

- accessible touch-portrait gate with landscape recovery, optional
  user-initiated fullscreen/orientation lock, fallback guidance, and teardown
- touch/pen/mouse/keyboard annotation without user-agent parsing, blanket
  default prevention, or zoom suppression
- safe-area/dynamic-viewport layout, 44px targets, visible focus, reduced
  motion, and robust editable-canvas pointer cancellation
- Chromium-only full regression, narrow Firefox/WebKit smoke, and narrow
  emulated Chrome/Safari mobile touch/layout projects
- `npm.cmd test`: 209 tests passed (structure 2, client 120, server 61,
  recipe schema 9, shared 17); all five workspace type checks/builds passed
- portrait modal focus enters the gate and restores the prior in-app control
  after landscape recovery
- client tests, typecheck, build, and the 9-case Playwright matrix verified on
  Chromium, Firefox, WebKit, emulated Pixel Chrome, and emulated iPhone WebKit
- CI now has separate `validate` and scoped multi-browser `e2e` jobs; the YAML
  parses locally, while the remote Actions run remains pending commit/push
- no physical iOS or Android testing is claimed. Touch, safe areas, fullscreen,
  reconnect, microphone/speaker, and a three-device LAN round remain blocking
  manual checks in `docs/browser-support.md`

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

Phase 7 human gate — run several real three-person, role-rotated sessions using
`docs/playtesting.md`; record structured evidence, make only evidence-backed
UI/balance changes, and retest every accepted change.

## Phase 8 delivered

- bounded strict custom recipe schema with structured diagnostics
- migrated lifecycle/license/report/test-token persistence and generated Prisma client
- owner, discovery, report, and allowlisted moderation HTTP surfaces
- one immutable server-resolved recipe across provisioning, progress, timer,
  Recipe Keeper privacy, outcome, and history
- accessible structured Recipe Studio, lifecycle controls, discovery/report UI,
  and public/private room-selection handoff

Pending human gates: a real moderator drill and a real exactly-three-person
custom-recipe playtest. No human result is claimed.

## Earlier phase evidence

- Phase 2 trusted commit `ed98e5c`: 49 tests, five type-checks/builds, production Chromium E2E, and zero audit findings.
- Phase 3 working tree: 105 tests, five type-checks/builds, production four-context Chromium, directed fake-media WebRTC (Recipe 2 streams, Blind 1, Deaf 0), and zero audit findings.
- Detailed Phase 4 RED/GREEN history: `.hermes/phase4-red-green.md`.
