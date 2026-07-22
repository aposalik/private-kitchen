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

export async function ensureDatabaseSchema(database: DatabaseClient): Promise<void> {
  const rows = await database.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Account'",
  );
  if (rows.length === 0) await migrateDatabase(database);
}
