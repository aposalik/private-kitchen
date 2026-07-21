import { describe, expect, test } from "vitest";

import { productionPort } from "../src/index.js";

describe("productionPort", () => {
  test.each([
    [undefined, 2567],
    ["", 2567],
    ["2567junk", 2567],
    ["-1", 2567],
    ["0", 2567],
    ["65536", 2567],
    ["1.5", 2567],
    [" 2567 ", 2567],
    ["1", 1],
    ["65535", 65535],
  ])("maps %j to %i", (raw, expected) => {
    expect(productionPort(raw)).toBe(expected);
  });
});
