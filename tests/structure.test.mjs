import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "package.json",
  "tsconfig.base.json",
  ".env.example",
  ".github/workflows/ci.yml",
  "apps/client/package.json",
  "apps/client/src/main.ts",
  "apps/server/package.json",
  "apps/server/src/index.ts",
  "packages/shared/package.json",
  "packages/shared/src/index.ts",
  "packages/recipe-schema/package.json",
  "packages/recipe-schema/src/index.ts",
  "packages/test-utils/package.json",
  "packages/test-utils/src/index.ts",
  "infra/docker-compose.yml",
  "infra/livekit.yaml",
  "docs/architecture.md",
  "docs/game-design.md",
  "docs/communication-matrix.md",
  "docs/recipe-format.md",
  "docs/testing.md"
];

test("phase-zero monorepo structure is complete", () => {
  const missing = required.filter((path) => !existsSync(resolve(root, path)));
  assert.deepEqual(missing, [], `Missing scaffold files: ${missing.join(", ")}`);
});
