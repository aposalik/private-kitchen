import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer, type Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_RECONNECTION_GRACE_SECONDS,
  KITCHEN_ROOM_NAME,
} from "@cooking-game/shared";
import { KitchenRoom } from "./rooms/KitchenRoom.js";
import { createDatabaseClient, ensureDatabaseSchema } from "./db/client.js";
import { PrismaRepository } from "./db/repository.js";
import { createKitchenHttpApp } from "./http/app.js";
import { DEFAULT_SESSION_TTL_MS, readSessionToken, SessionService } from "./auth/session.js";

export interface StartKitchenServerOptions {
  port?: number;
  hostname?: string;
  reconnectionGraceSeconds?: number;
  placementSeed?: string;
  voicePendingEdgeTtlMs?: number;
  voiceEstablishedEdgeTtlMs?: number;
  voiceReadinessTtlMs?: number;
  roundDurationMs?: number;
  databaseUrl?: string;
  allowedOrigins?: readonly string[];
  sessionTtlMs?: number;
  now?: () => Date;
}

export interface RunningKitchenServer {
  endpoint: string;
  port: number;
  shutdown(): Promise<void>;
}

export function productionPort(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) {
    return 2567;
  }
  const port = Number(raw);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535
    ? port
    : 2567;
}

export async function startKitchenServer(
  options: StartKitchenServerOptions = {},
): Promise<RunningKitchenServer> {
  const hostname = options.hostname ?? "127.0.0.1";
  const database = createDatabaseClient(
    options.databaseUrl ?? (process.env.NODE_ENV === "test" ? "file::memory:" : undefined),
  );
  await ensureDatabaseSchema(database);
  const repository = new PrismaRepository(database);
  const now = options.now ?? (() => new Date());
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const roomSessions = new SessionService(repository, {
    now,
    ttlMs: sessionTtlMs,
    secure: process.env.NODE_ENV === "production",
  });
  const app = createKitchenHttpApp({
    repository,
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
    sessionTtlMs,
    now,
  });
  const httpServer: HttpServer = createServer(app);
  // This remains only slightly above the strict application SDP ceiling so
  // malformed signaling reaches validation and receives a sanitized error.
  const transport = new WebSocketTransport({
    server: httpServer,
    maxPayload: 24 * 1_024,
  });
  const gameServer = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
  });

  gameServer.define(KITCHEN_ROOM_NAME, KitchenRoom, {
    reconnectionGraceSeconds:
      options.reconnectionGraceSeconds ?? DEFAULT_RECONNECTION_GRACE_SECONDS,
    ...(options.placementSeed ? { placementSeed: options.placementSeed } : {}),
    ...(options.voicePendingEdgeTtlMs ? { voicePendingEdgeTtlMs: options.voicePendingEdgeTtlMs } : {}),
    ...(options.voiceEstablishedEdgeTtlMs ? { voiceEstablishedEdgeTtlMs: options.voiceEstablishedEdgeTtlMs } : {}),
    ...(options.voiceReadinessTtlMs ? { voiceReadinessTtlMs: options.voiceReadinessTtlMs } : {}),
    ...(options.roundDurationMs ? { roundDurationMs: options.roundDurationMs } : {}),
    now,
    resolveAuthCookie: async (cookieHeader: string | undefined) => {
      const session = await roomSessions.resolveToken(readSessionToken(cookieHeader));
      return session ? { accountId: session.accountId, expiresAt: session.expiresAt } : undefined;
    },
    recordGameHistory: (history) => repository.recordGameHistoryOnce(history),
  });
  try {
    await gameServer.listen(options.port ?? 2567, hostname);
  } catch (error) {
    await database.$disconnect();
    throw error;
  }

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    await gameServer.gracefullyShutdown(false);
    throw new Error("Kitchen server did not bind to a TCP port");
  }

  let stopped = false;
  return {
    endpoint: `ws://${hostname}:${address.port}`,
    port: address.port,
    async shutdown(): Promise<void> {
      if (!stopped) {
        stopped = true;
        await gameServer.gracefullyShutdown(false);
        await database.$disconnect();
      }
    },
  };
}

async function main(): Promise<void> {
  const running = await startKitchenServer({
    port: productionPort(process.env.PORT),
    hostname: process.env.HOST ?? "0.0.0.0",
    ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}),
  });
  console.log(`Kitchen server listening on port ${running.port}`);
}

const entryPath = process.argv[1];
if (entryPath && pathToFileURL(entryPath).href === import.meta.url) {
  void main().catch((error: unknown) => {
    console.error("Kitchen server failed to start", error);
    process.exitCode = 1;
  });
}
