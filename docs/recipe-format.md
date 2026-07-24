# Recipe Format

Recipes will be versioned data, not hard-coded scenes. A recipe defines metadata, time limit, ingredient inventory, randomized placement constraints, ordered/dependent steps, allowed tools, cooking windows, recovery rules, and completion conditions.

## Version 1 custom recipes

Recipe IDs are lowercase hyphenated slugs up to 64 characters. Documents are
strict: unknown fields and arbitrary instruction prose are rejected. Authors
choose only the supported tomato, onion, carrot, and potato kinds; the server
accepts only chop, add-to-pot, season, boil, mix, and plate actions.

A valid document contains at most 16 ingredient definitions, 16 total physical
ingredient objects, 64 steps, 16 dependencies per step, an 80-character title,
and a duration no longer than one hour. Every ingredient has one structural
chop step and one add-to-pot step; quantities are carried by `count`. All chop
steps come first, every matching add depends on its chop, season depends on all
adds, and boil, mix, and plate form the final chain. IDs and references must be
unique, known, earlier, and acyclic.

`diagnoseRecipe` returns only `{ valid, issues: [{ code, path, message }] }`.
The browser uses this for field guidance, but save, publish, and room resolution
always validate the stored document on the server.

Owned records move through `DRAFT`, `PUBLISHED`, and `REMOVED`. Publishing
requires an explicit CC0 1.0 or CC BY 4.0 license. Published documents cannot be
edited until explicitly unpublished. Public discovery returns title, time,
license, version, and ingredient summary—never the ordered steps.

Publication pins an immutable published document. Issuing a private-test token
pins a separate immutable single-use snapshot, and completed history stores the
actual room snapshot. Later draft edits, unpublishing, deletion, removal, or
restoration cannot mutate active rounds or historical evidence.
