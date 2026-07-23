import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverPackage = JSON.parse(
  await readFile(new URL("../apps/server/package.json", import.meta.url), "utf8"),
);
const playwrightConfig = await readFile(
  new URL("../playwright.config.ts", import.meta.url),
  "utf8",
);

test("production startup deploys migrations before running the compiled server", () => {
  assert.equal(serverPackage.scripts.prestart, "npm run prisma:migrate");
  assert.equal(serverPackage.scripts.start, "node dist/index.js");
  assert.match(
    playwrightConfig,
    /npm run start --workspace @cooking-game\/server/,
    "Playwright must exercise the migration-owning production startup path",
  );
  assert.doesNotMatch(
    playwrightConfig,
    /DATABASE_URL:\s*"file::memory:"/,
    "Production E2E must use a migratable persistent SQLite database",
  );
});
