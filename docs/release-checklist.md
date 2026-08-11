# Release Checklist

Work through this list top-to-bottom before tagging a release or deploying to
any shared environment. Every item must be checked or explicitly waived with a
written reason. Skipping items without a waiver is not accepted.

---

## 1. Automated gates (must all pass)

- [ ] `npm test` — all unit tests pass (server, client, recipe-schema, shared)
- [ ] `npm run typecheck` — all five workspace type-checks pass with zero errors
- [ ] `npm run build` — production build completes without errors or warnings
- [ ] `npm audit --omit=dev --audit-level=high` — zero high/critical advisories
      (waiver required for any retained advisory; document in accepted-risk notes)
- [ ] `npm run test:e2e` — all Playwright cases pass on Chromium, Firefox,
      WebKit, emulated mobile Chrome, emulated mobile Safari

---

## 2. Code quality

- [ ] `git diff --check` — no trailing whitespace, no merge conflict markers
- [ ] No `TODO`, `FIXME`, `HACK`, `BOMBANANA`, or debug `console.log` left in
      shipped paths (unit tests and scripts may retain them)
- [ ] No hardcoded secrets, API keys, or credentials in any committed file
- [ ] No `debugger;` statements in client or server source

---

## 3. Human gates (all must have recorded evidence before first public deploy)

- [ ] Phase 7 — at least one real three-person, role-rotated session completed
      using `bash scripts/start-playtest.sh` and `docs/playtesting.md`;
      debrief exported and retained
- [ ] Physical device — iOS Safari and Android Chrome both passed the full
      matrix in `docs/browser-support.md` using `bash scripts/start-device-test.sh`;
      device, OS, browser versions recorded
- [ ] Phase 8 moderator drill — a real moderator completed the report → review
      → remove → restore flow using `bash scripts/start-moderator-drill.sh`
- [ ] Phase 8 custom recipe playtest — a real three-person team completed a
      game using a custom published recipe

---

## 4. Operations readiness

- [ ] `DATABASE_URL` is set to a persistent path (not `:memory:` or a temp dir)
- [ ] `NODE_ENV=production` is set in the deployment environment
- [ ] `ALLOWED_ORIGINS` is set to the exact client origin (no trailing slash)
- [ ] `MODERATOR_USERNAMES` is set; at least one moderator account exists and
      has been tested
- [ ] Database backup taken immediately before deployment
- [ ] `GET /health` returns `{"status":"ok"}` within 5 s after startup
- [ ] Migration applied to a staging environment before production; no errors
      in `prisma migrate deploy` output

---

## 5. Documentation

- [ ] `docs/project-status.md` updated to reflect what was shipped
- [ ] `README.md` commands and status section accurate
- [ ] `CHANGELOG.md` entry written (or waiver: project does not maintain one)

---

## 6. Post-deploy smoke

- [ ] Client HTTP `GET /` returns 200 from the production origin
- [ ] `GET /health` returns 200 with `status: "ok"` from the production server
- [ ] Unauthenticated `GET /api/auth/session` returns `{ account: null }` (not 500)
- [ ] A new room can be created; a second tab joins; both show `2 / 3`
- [ ] Browser console is clean: no errors, no warnings, no mixed-content alerts

---

## Accepted-risk notes

| Date | Item | Reason waived | Reviewer |
| --- | --- | --- | --- |
| 2026-07-24 | `npm audit --omit=dev` | Three high advisories through Prisma's dev-tooling `find-my-way`; no reachable production path; fixing requires a breaking Prisma downgrade | (original audit) |
