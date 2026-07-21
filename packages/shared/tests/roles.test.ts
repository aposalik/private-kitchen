import { describe, expect, test } from "vitest";

import { PLAYER_ROLES, REQUIRED_PLAYER_COUNT } from "../src/index.js";

describe("Phase 1 role contract", () => {
  test("defines exactly one role for each required player seat", () => {
    expect(PLAYER_ROLES).toHaveLength(REQUIRED_PLAYER_COUNT);
    expect(new Set(PLAYER_ROLES)).toHaveLength(REQUIRED_PLAYER_COUNT);
  });
});
