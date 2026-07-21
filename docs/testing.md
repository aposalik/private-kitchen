# Testing Strategy

## TDD

Every behavior follows RED → GREEN → REFACTOR. Configuration/scaffold integrity is covered by `tests/structure.test.mjs`.

## Multiplayer

Playwright creates three isolated browser contexts. Server tests verify capacity, role permissions, authoritative actions, deterministic randomization, timer behavior, reconnect, and completion.

## Manual matrix

One PC can use three browser profiles for state testing. Real voice usability requires three people/devices. Mobile emulation covers layout; real iOS Safari and Android Chrome verify microphone, touch, orientation, and reconnect.
