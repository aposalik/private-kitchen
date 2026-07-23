import { readFile } from "node:fs/promises";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";

export type DatabaseClient = PrismaClient;

export function createDatabaseClient(
  databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db",
): DatabaseClient {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
}

/** Applies the checked-in initial schema to a new isolated database. */
export async function migrateDatabase(database: DatabaseClient): Promise<void> {
  const migrationUrl = new URL(
    "../../prisma/migrations/20260722170000_phase5_accounts/migration.sql",
    import.meta.url,
  );
  const sql = await readFile(migrationUrl, "utf8");
  for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
    await database.$executeRawUnsafe(statement);
  }
}

export async function ensureDatabaseSchema(
  database: DatabaseClient,
  options: { allowBootstrap?: boolean } = {},
): Promise<void> {
  const tables = await database.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('Account', '_prisma_migrations')",
  );
  const names = new Set(tables.map(({ name }) => name));
  if (options.allowBootstrap) {
    if (!names.has("Account")) await migrateDatabase(database);
    return;
  }
  if (names.has("Account") && names.has("_prisma_migrations")) {
    const applied = await database.$queryRawUnsafe<Array<{ migration_name: string }>>(
      "SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20260722170000_phase5_accounts' AND finished_at IS NOT NULL AND rolled_back_at IS NULL",
    );
    if (applied.length === 1) return;
  }
  throw new Error(
    "Database schema is not managed by the checked-in Prisma migration. Run `npm run prisma:migrate --workspace @cooking-game/server` before starting the server.",
  );
}
