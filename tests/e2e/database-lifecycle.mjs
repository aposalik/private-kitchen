import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createE2eDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "private-kitchen-e2e-"));
  const databasePath = join(directory, "phase5.db");

  return {
    directory,
    databasePath,
    databaseUrl: `file:${databasePath.replaceAll("\\", "/")}`,
  };
}

export function removeE2eDatabase(directory) {
  rmSync(directory, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 100,
  });
}
