import { defineConfig, devices } from "@playwright/test";
import { createE2eDatabase, removeE2eDatabase } from "./tests/e2e/database-lifecycle.mjs";

const e2eDatabase = createE2eDatabase();
process.once("exit", () => removeE2eDatabase(e2eDatabase.directory));

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    },
  }],
  webServer: [
    {
      command: "npm run start --workspace @cooking-game/server",
      port: 2567,
      env: {
        NODE_ENV: "e2e",
        DATABASE_URL: e2eDatabase.databaseUrl,
      },
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run preview --workspace @cooking-game/client",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
