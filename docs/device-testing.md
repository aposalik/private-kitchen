# Physical Device Testing Guide

## Status

The physical device gate is pending. Automated Playwright tests cover emulated
Pixel Chrome and iPhone WebKit viewports, but cannot prove real hardware
touch behavior, safe-area rendering, hardware audio, or OS permission flows.
Real results must be recorded before the gate is considered complete.

## What must pass

Each of the following must be verified on a current-major-release iOS Safari and
on a current-major-release Android Chrome. Record versions and evidence in the
table in `docs/browser-support.md`.

| Check | Must pass |
| --- | --- |
| Portrait prompt and landscape recovery | Yes |
| Optional fullscreen / orientation lock | Acceptable if missing — manual rotation must remain playable |
| Lobby and gameplay touch controls | Yes — failed touch is blocking |
| Drawing, cancellation, scroll, and pinch-zoom | Yes |
| Notch / safe-area clearance | Yes — no clipped controls |
| Reload / reconnect identity | Yes — role and room must survive reload |
| Microphone permission prompt | Yes |
| Role-filtered audio | Yes — Keeper hears both streams, Blind Cook hears one, Deaf Guide hears none |
| Speaker output | Yes |
| Three-device target-LAN round (Win or Loss) | Yes |

## Quick start

```bash
bash scripts/start-device-test.sh
```

The script requires `openssl` (pre-installed on Linux, macOS, Git Bash on
Windows). It generates a 24-hour self-signed certificate for your machine's
LAN IP, starts the Colyseus game server on port 2567, starts the Vite HTTPS
client on port 5173, and prints the URL and checklist.

Connect each test device to the same LAN as the host machine, open the printed
URL in the target mobile browser, and accept the self-signed certificate warning
(see browser-specific notes below).

## Why HTTPS is required

Mobile browsers block `getUserMedia` (microphone capture) on non-`localhost`
plain-HTTP origins. The HTTP server (`http://LAN_IP:5173`) is sufficient to
verify layout, touch, room creation, reconnect, and drawing, but microphone
access, role-filtered audio, and the audio path require HTTPS.

The self-signed certificate is generated fresh by the script on each run. It is
not stored in the repository and is removed when the script exits.

## iOS Safari

### Certificate acceptance

1. Open `https://LAN_IP:5173` in Safari.
2. Safari shows a certificate warning. Tap **Advanced** → **Continue to site**
   (label varies by iOS version).
3. If Safari blocks the warning, first install the certificate profile:
   - Open `https://LAN_IP:5173/` in the host machine's browser and export the
     cert as a `.cer` file.
   - AirDrop or email it to the iPhone and open it in Settings → General →
     VPN & Device Management → install the profile.
   - Go to Settings → General → About → Certificate Trust Settings and enable
     full trust for the certificate.

### Microphone permission

iOS Safari presents a permission dialog the first time `getUserMedia` is
requested. Accept it. If it does not appear, the HTTPS origin may not be
trusted — repeat the certificate step above.

### Known behaviors to verify

- The portrait gate modal (landscape-required prompt) appears in portrait and
  the game surface is not accessible until the device is rotated.
- After rotating to landscape, the modal dismisses and the game renders
  correctly, with all controls within the viewport and no horizontal overflow.
- Safe-area insets (`env(safe-area-inset-*)`) clear the notch and home
  indicator — no button clips behind either element.
- Touch targets respond without dead zones; 44×44 px minimum size passes the
  visual check.
- Reloading the page re-connects to the same room with the same role identity.

## Android Chrome

### Certificate acceptance

1. Open `https://LAN_IP:5173` in Chrome.
2. Chrome shows **Your connection is not private**. Tap **Advanced** →
   **Proceed to LAN_IP (unsafe)**.
3. Grant the microphone permission when the game requests it.

### Known behaviors to verify

- The portrait gate modal appears in portrait orientation.
- Landscape recovery dismisses the modal and shows the full game surface.
- The optional fullscreen button (if implemented) works or is absent without
  breaking gameplay.
- Touch events on the drawing canvas produce visible marks; cancellation
  (multi-touch or two-finger) stops the stroke.
- The address bar hides during play (Chrome's auto-hiding URL bar); dynamic
  viewport units (`dvh`) prevent content from jumping.
- Reload re-establishes the WebSocket connection and restores the seat.

## Audio path verification

After entering the game as three players (Blind Cook, Recipe Keeper, Deaf
Kitchen Guide), ask each player to speak:

1. **Recipe Keeper** should hear both Blind Cook and Deaf Guide speaking.
2. **Blind Cook** should hear Recipe Keeper only, not Deaf Guide.
3. **Deaf Kitchen Guide** should not hear any other player.

The server enforces this topology; client-side `sendonly`/`recvonly`
transceiver directions implement it. The automated Playwright test verifies the
track matrix with fake media — real hardware is required to confirm room
acoustics, device mixing, and output.

## Three-device LAN round

Run a complete round with three physical devices:

1. Device A creates the room (`/` → Create game).
2. Device B and Device C join via `/?room=ROOM_ID`.
3. All three confirm **3 / 3** and their assigned roles.
4. The Blind Cook completes the recipe (or the timer expires).
5. All three see the authoritative Win or Loss screen.

This verifies network routing, WebSocket stability across the LAN, and the
complete game flow on real hardware.

## Recording evidence

After each platform, fill in the corresponding rows in `docs/browser-support.md`
under the physical-device completion table. Note:

- Device model, OS version, and browser version.
- Pass or fail for each check.
- Any screenshot or screen recording reference.
- Any failing check must be fixed before the gate is complete; the failed touch,
  reconnect, privacy, and audio checks are blocking.

Do not mark a check as passed from Playwright emulation or desktop browser
testing. Only results from a real physical device at the stated OS/browser
version are accepted.

## Troubleshooting

### Microphone not requested

- Confirm the URL is HTTPS, not HTTP. The browser address bar must show a lock
  icon (or shield).
- Confirm the self-signed cert is trusted by the OS/browser (see above).
- Confirm the user has not previously denied the permission for this origin in
  the device's Settings → Privacy.

### WebSocket connection fails

- Confirm the Colyseus server is running (port 2567 must be open).
- Confirm the host firewall allows inbound connections on port 5173 and 2567
  from LAN devices.
- On Windows: `netsh advfirewall firewall add rule name="Private Kitchen Dev" ...`
  or temporarily disable Windows Defender Firewall for the private network.

### Safari shows blank page after certificate accept

- Wait for the Vite HMR handshake (about 2 s) and hard-refresh the page.
- Confirm the script printed "Waiting for services to start..." and the full
  checklist before you opened the URL.

### Portrait prompt does not dismiss after rotation

- Confirm the device is in landscape; some cases require a 90° then back rotation
  for the browser to fire the `orientationchange` event.
- If the device is locked to portrait in OS Settings, landscape rotation will
  not work — unlock device orientation first.
