# End-to-end tests

Playwright launches the production server and Vite preview, then creates isolated
browser contexts for the multiplayer flow. Run it with `npm run test:e2e`; the
script builds all production artifacts before starting either process.

The Phase 2 scenario brings three isolated Chromium players to READY, identifies
the Blind Cook by the server role, and confirms pickup ownership on every client.
It verifies a non-Blind role has read-only guidance and no action controls, then
drops the object to a new valid position and observes release everywhere. The
original fourth-player rejection remains in the same flow. Playwright owns and
stops the production server, preview server, contexts, and listeners.

On Windows use `npm.cmd run test:e2e` if `npm` is not resolved by the shell.
