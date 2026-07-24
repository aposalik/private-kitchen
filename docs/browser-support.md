# Browser Support

## Policy

The target is the current major release of Chrome/Edge, Firefox, and Safari.
Browser projects and Playwright device descriptors are reviewed with dependency
updates and at least monthly while the game is active. Chromium is evidence for
Chrome/Edge engine behavior, not every vendor build. Playwright WebKit is a
compatibility proxy, not a test of shipping macOS or iOS Safari. Android Chrome
and iPhone Safari projects emulate viewport, touch, and engine behavior but not
physical browser chrome, hardware safe areas, audio routing, or OS permissions.

Keyboard and mouse remain supported. Only a touch-capable portrait environment
is gated; narrow or portrait desktop windows stay playable. Fullscreen and
orientation lock are optional, user-initiated enhancements. Missing or rejected
APIs show manual-rotation guidance, and landscape play does not require
fullscreen.

## Automated projects

Configured evidence as of 2026-07-23:

| Project | Engine/device proxy | Scope | Status |
| --- | --- | --- | --- |
| `chromium` | Desktop Chrome | Full suite plus engine smoke | PASS — account, browser, and three-player regression |
| `firefox` | Desktop Firefox | Browser smoke only | PASS — production create/reload reconnect |
| `webkit` | Desktop WebKit | Browser smoke only | PASS after SDK WebSocket fallback normalization; not Safari certification |
| `mobile-chrome` | Pixel 7 emulation | Mobile layout/touch only | PASS — touch/orientation/reconnect/authoritative pickup-drop |
| `mobile-safari` | iPhone 15 emulation | Mobile layout/touch only | PASS — touch/orientation/reconnect/authoritative pickup-drop |

Use `npx.cmd playwright test --project=<project>`. The smoke creates a real room
and reloads to verify authoritative identity without page or console errors. The
mobile scenario uses Playwright `tap()` on native controls, rotates the emulated
viewport, checks overflow and 44×44 targets, creates/reloads a room, joins two
helpers, and verifies an authoritative Blind Cook pickup/drop on all clients.
Unique temporary SQLite cleanup is preserved and explicit contexts close in
`finally`. The verified matrix completed 9/9 cases and left no E2E database directory.
The WebKit run also exercises the standards-compatible constructor guard required
for the Colyseus SDK browser fallback.

## Physical-device completion gate

Phase 6 is not complete until current iOS Safari and Android Chrome have recorded
results. Blank fields are intentional; no physical device was tested here.

On a trusted LAN, build and start the server, expose the Vite client, allow the
Node processes through the host firewall, and open `http://<HOST_LAN_IP>:5173`
on each phone:

```bash
npm run build
DATABASE_URL=file:./prisma/phase6-device.db npm run start --workspace @cooking-game/server
npm run dev:client -- --host 0.0.0.0 --port 5173 --strictPort
```

The HTTP LAN origin is sufficient for layout, touch, room, and reconnect checks.
Microphone capture on non-localhost mobile origins generally requires a trusted
HTTPS origin and a matching secure (`wss:`) room endpoint; do not report an HTTP
secure-context refusal as successful audio verification.

| Check | iOS Safari result / evidence | Android Chrome result / evidence |
| --- | --- | --- |
| Device, OS, browser versions | Pending — | Pending — |
| Portrait prompt and landscape recovery | Pending — | Pending — |
| Optional fullscreen/orientation behavior | Pending — | Pending — |
| Lobby/gameplay touch controls | Pending — | Pending — |
| Drawing, cancellation, scroll, pinch zoom | Pending — | Pending — |
| Notch/safe-area clearance | Pending — | Pending — |
| Reload/reconnect identity | Pending — | Pending — |
| Microphone permission and role-filtered audio | Pending — | Pending — |
| Speaker output | Pending — | Pending — |
| Three-device target-LAN round | Pending — | Pending — |

Record versions and screenshots/video. Unsupported fullscreen is acceptable when
manual rotation remains playable; failed touch, reconnect, privacy, or audio is
blocking.
