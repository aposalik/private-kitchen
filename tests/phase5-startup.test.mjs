import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createE2eDatabase, removeE2eDatabase } from "./e2e/database-lifecycle.mjs";

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

  const first = createE2eDatabase();
  const second = createE2eDatabase();
  try {
    assert.notEqual(first.directory, second.directory, "each E2E run needs an isolated directory");
    for (const suffix of ["", "-journal", "-shm", "-wal"]) {
      writeFileSync(`${first.databasePath}${suffix}`, "test artifact");
    }
    removeE2eDatabase(first.directory);
    assert.equal(existsSync(first.directory), false, "cleanup must remove the database and sidecars");
  } finally {
    removeE2eDatabase(first.directory);
    removeE2eDatabase(second.directory);
  }
});
