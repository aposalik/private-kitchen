# Architecture

## Boundaries

- Client renders and sends intentions; it never decides authoritative outcomes.
- Server owns rooms, roles, randomization, timers, objects, cooking, recipes, and completion.
- Shared package owns wire contracts without browser or server side effects.
- Recipe schema is versioned and validates built-in and user-created recipes.
- Voice permissions are issued server-side and enforced by the media service.

## First vertical slice

Three isolated clients join one private Colyseus room. The room rejects player four, starts only with exactly three players, assigns each role once, and supports reconnect.
