# Phase 3 RED/GREEN evidence

Commands use `npm.cmd` on Windows. Entries record observed output, not planned results.

## Shared constrained protocol

- RED: `npm.cmd test --workspace @cooking-game/shared -- --run tests/communication.test.ts`
  - Expected failure observed: `Cannot find module '../src/communication.js'`.
- Intermediate RED: same command reached the implementation and exposed a Zod composition error (`Invalid discriminated union option`); replaced discriminator composition with strict unions.
- GREEN: same command passed: 3 files, 11 tests (5 new communication boundary tests plus 6 existing shared tests).

## Authoritative server communication

- Harness correction: awaited each SDK client's authoritative self-player hydration before reading its role and registered voice-grant listeners immediately afterward.
- RED: `npm.cmd test --workspace @cooking-game/server -- --run tests/communication.integration.test.ts`
  - Observed 4/4 Phase 3 failures as behavioral timeouts (visual event, card/stroke, board flow, and voice grant/relay); the harness no longer threw during setup. Existing 25 server tests remained green in that run.
- Intermediate: after implementing server handlers, the same command passed 3/4 Phase 3 scenarios and all 25 existing tests. The oversized-SDP case hit Colyseus' default 4 KiB WebSocket ceiling before application validation (`Max payload size exceeded`). The transport ceiling was set to 24 KiB, still tightly bounded but above the strict 16 KiB SDP schema, so application validation can preserve sender-only sanitized rejection.

## Browser RoomClient communication

- RED: `npm.cmd test --workspace @cooking-game/client -- --run tests/room-client.test.ts`
  - Observed 2 failures: constrained action methods did not exist (`sendGesture is not a function`) and authoritative voice grants/events were not represented in snapshots. Existing client tests in the focused run remained green.
- GREEN: same command passed: 2 files, 20 tests.

## Browser voice lifecycle

- RED: `npm.cmd test --workspace @cooking-game/client -- --run tests/voice-session.test.ts`
  - Expected failure observed: `Cannot find module '../src/voice/VoiceSession.js'`.
- GREEN: same command passed: 3 files, 25 tests.

## Communication UI

- RED: `npm.cmd test --workspace @cooking-game/client -- --run tests/communication-panel.test.ts`
  - Expected failure observed: the `CommunicationPanel` module did not exist. The run retained 25 passing prior client tests.
- Intermediate RED: after implementation, the new suite exposed one presentation mismatch and six existing Lobby regressions caused by a single-listener test fake; the production connection supports multiple subscribers. The fake was corrected to a listener set and the finite card feed kept its enum token.
- GREEN: same command passed: 4 files, 33 tests.

## Independent review hardening

- RED: new VoiceSession lifecycle tests exposed six failures around READY ordering, room readiness, stale async work, and bounded ICE state.
- GREEN: generation-safe WebRTC operations, receiver-first READY caching, fixed peer/output caps, room-readiness teardown, and explicit sendonly/recvonly transceivers passed 19 focused voice tests.
- RED: server authority tests failed before READY authorization, strict SDP semantics, edge replacement/expiry, and separate ICE abuse limits existed.
- GREEN: the expanded server communication suite passed with directed role routing, bounded readiness/edges, strict sender-only errors, and cleanup.
- RED: post-review DISABLE/bootstrap tests exposed a missing `DISABLE` schema branch and eight deterministic bootstrap timeouts after the old 50 ms timer was removed.
- GREEN: exact `COMMUNICATION_READY` bootstrap, idempotent/rate-bounded grants, explicit DISABLE revocation, reconnect suspension, and strict relay parsing passed.
- RED: final review tests rejected previously accepted inline ICE, unsupported SDP transport/ports/formats, and required bilateral teardown on pending/established/readiness expiry.
- GREEN: final server suite passed 36 tests; final client suite passed 57 tests.

## Final Phase 3 verification

- `npm.cmd test`: 105 passed (1 structure, 57 client, 36 server, 11 shared).
- `npm.cmd run typecheck`: five workspaces passed.
- `npm.cmd run test:e2e`: production build and Chromium scenario passed; three isolated voice clients observed Recipe=2, Blind=1, Deaf=0 remote streams; a fourth client was rejected.
- Both dependency audits: zero vulnerabilities.
- `git diff --check`: exit 0; source safety scan clean.
