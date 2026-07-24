# Phase 8 — User-created recipes

## Goal
Authenticated users can author a bounded recipe with structured controls, receive actionable validation, save private drafts, launch a private exactly-three-player test room, publish under explicit terms, discover published recipes, report abuse, and have moderators remove content. During play, one server-resolved immutable recipe drives object provisioning, legal actions, progress, timer, private Recipe Keeper delivery, outcome, and history.

## Non-negotiable boundaries
- Preserve the dirty Phase 6/7 tree; no reset, clean, stash, commit, or push.
- Exactly three players and immutable private roles remain unchanged.
- The client proposes recipe documents and actions; the server validates, resolves, and executes them.
- Ordered recipe instructions are sent only via the existing private Recipe Keeper message.
- Blind Cook and Kitchen Guide snapshots/world labels never include ordered instructions.
- Only supported ingredient kinds and action/station vocabulary may be authored.
- Active play remains the 2.5D kitchen; Recipe Studio is an account/setup surface.
- Authentication establishes identity/ownership only, never cooking authority.
- Human moderation/playtest evidence is never fabricated.

## Architecture

### Shared recipe schema
1. Replace the bundled-only recipe ID literal with a bounded slug schema while preserving `tomato-soup` compatibility.
2. Keep arbitrary prose out of ordered gameplay steps; the UI derives readable labels from enums.
3. Keep strict unknown-field rejection, version 1 validation, deep bounds, duplicate/reference/cycle checks, and action-order feasibility.
4. Export a feasibility/diagnostics function suitable for API/UI feedback without trusting client-side validation.
5. Bound title, IDs, ingredient counts, dependency fan-out, total objects, total steps, and duration to physical kitchen and protocol limits.

### Persistence
Extend `OwnedRecipe` with lifecycle fields while retaining its stable database id:
- `status`: `DRAFT | PUBLISHED | REMOVED`
- `license`: nullable `CC0_1_0 | CC_BY_4_0`
- `publishedAt`, `removedAt`, `removalReason`
- `publicationVersion` integer
- published recipe discovery uses the validated stored document as the immutable current snapshot; editing a published recipe creates a new draft state or explicitly unpublishes before edits.

Add `RecipeReport`:
- id, recipeId, reporterAccountId, bounded reason enum/details, status, createdAt/resolvedAt
- unique reporter/recipe constraint and bounded list/query indexes.

Private test selection uses an opaque, short-lived, single-use token stored only as a hash with recipe id, owner id, expiry, and consumed timestamp. Public published selection uses the recipe record id. Removed/draft content is never public-resolvable.

### HTTP API
Owner endpoints:
- Existing GET/POST/PATCH/DELETE `/api/account/recipes` remain owner-scoped.
- POST `/:id/validate` returns sanitized structured diagnostics.
- POST `/:id/publish` requires explicit supported license and a currently valid document.
- POST `/:id/unpublish` returns to draft.
- POST `/:id/test-sessions` returns a one-time short-lived room recipe token.
- Editing/deleting published or removed content follows explicit lifecycle rules; ownership failures remain indistinguishable 404s.

Public endpoints:
- GET `/api/recipes?query=&cursor=` returns bounded published metadata, never draft documents/private instructions.
- GET `/api/recipes/:id` returns published metadata and ingredient summary but no ordered instruction payload.
- POST `/api/recipes/:id/reports` requires auth, validates bounded reason/details, rate-limits, and deduplicates.

Moderation:
- A configured moderator account allowlist enables bounded report listing and remove/restore actions.
- No client-supplied moderator flag is trusted.
- Removal immediately excludes discovery and new room resolution.

Rate limiting:
- Separate per-account/IP mutation, publish, test-session, report, and discovery buckets.
- Existing 16 KiB JSON ceiling remains and recipe-specific count/string limits apply.

### Authoritative room selection
- Room creation may include either a public published recipe id or one-time private test token.
- `startKitchenServer` injects a resolver into `KitchenRoom`; `onCreate` awaits resolution and falls back to bundled Tomato Soup only when no selection was requested.
- Invalid/expired/consumed/unpublished/removed selections reject room creation; never silently fall back.
- `KitchenRoom` stores only the resolved validated recipe.
- `CookingSystem` accepts the recipe and provisions each required object count.
- Progress/legal action ordering derives from recipe steps, not hard-coded Tomato Soup constants.
- `RecipeSystem` builds its private payload from that same recipe.
- Timer and history recipe id derive from that same recipe.
- No recipe document is added to public Colyseus state.

### Client UX
- Replace raw JSON as the primary path with a semantic Recipe Studio using title, duration, ingredient count controls, and ordered/dependency-aware action controls constrained to supported values.
- Inline validation summary uses `role=status`/`role=alert`, labels, fieldsets, and focusable error links.
- Draft list shows status, updated time, Edit, Validate, Private test, Publish/Unpublish, and Delete controls.
- Publish requires an explicit license choice and clear ownership/license terms.
- Discovery provides bounded search/results, status text, ingredient/time summary, launch option, and authenticated Report dialog.
- Touch targets, visible focus, no horizontal overflow, safe areas, reduced motion, and keyboard-only completion are required.
- Launching a selected recipe routes through the existing room creator; active play remains world-first.

## RED-GREEN order
1. Recipe-schema tests for custom slug acceptance, physical bounds, impossible graph/action rejection, and diagnostics.
2. Prisma migration/repository tests for lifecycle ownership, reports, test-token hashing/expiry/consumption, and public filtering.
3. HTTP tests for auth, ownership, validation, lifecycle, licenses, discovery privacy, reports, moderation, origin/payload/rate limits.
4. Cooking/recipe/room tests proving one injected custom recipe controls objects, progress, timer, private delivery, and history; invalid selection rejection.
5. Client AuthClient/RecipeStudio tests for structured authoring, errors, lifecycle controls, discovery/report, keyboard behavior, and launch handoff.
6. Playwright E2E for register → author → validate → save → private test; publish → second account discover/report; non-keeper recipe privacy.

## Verification gates
- All workspace tests pass with exact totals.
- Five workspace typechecks and ordered production builds pass.
- Prisma generation/migrate-deploy and migration lifecycle tests pass on a fresh database and upgrade fixture.
- Playwright Chromium, Firefox, WebKit, Pixel 7, and iPhone 15 projects pass.
- `npm audit`, `git diff --check`, secret/static checks, and changed-file review pass.
- Clean stop/rebuild/restart; live API and browser workflow verified with real screenshots and three automated browser clients.
- Independent authority/privacy/security/accessibility/mobile review completed.
- Real moderator drill and three-person custom-recipe playtest remain explicit human gates if not performed.
