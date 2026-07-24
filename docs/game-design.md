# Game Design

## Vision

Comedy-first cooperative cooking for exactly three players. Difficulty is recipe-based and forgiving, while a server-controlled round timer creates urgency.

## Roles

- Blind Cook: speaks/hears, sees ambiguous objects, and alone manipulates food/tools.
- Non-Speaking Recipe Keeper: sees recipe and kitchen, hears, and communicates visually without speech or unrestricted text.
- Deaf Kitchen Guide: sees kitchen/gestures and speaks, but receives no voice or game audio.

## MVP

One private room, fixed stations, one tomato-soup recipe, randomized ingredients, essential gestures, role-filtered voice, timer, result screen, and reconnect.

## Phase 7 operation and playtest boundary

After connection, the primary surface is role-first: role, phase objective,
timer, progress, permitted actions, and signals precede secondary room
metadata. Setup and account controls are pre-connection only. The Recipe
Keeper’s recipe remains private, all actions and outcomes remain
server-authoritative, and the existing role voice policy is unchanged.

The terminal debrief is optional, structured, and local to the browser. It is
measurement support rather than a game mechanic: it grants no permission,
changes no result, and sends no network request. Automated results never stand
in for human participation, frustration, clarity, or replay intent.

## Phase 8 custom-recipe boundary

Authors compose bounded structured recipes rather than scripts or raw JSON.
Drafts are private; publication and private tests pin immutable snapshots.
Exactly three players use the existing 2.5D kitchen. The server provisions only
the selected recipe's ingredients and derives legal progress from its declared
step dependencies and quantities. Ordered instructions are visible only to the
Recipe Keeper and never appear in discovery, shared room state, Blind Cook UI,
or Deaf Kitchen Guide UI.
