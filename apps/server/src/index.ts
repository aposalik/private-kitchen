import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer, type Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_RECONNECTION_GRACE_SECONDS,
  KITCHEN_ROOM_NAME,
} from "@cooking-game/shared";
import { KitchenRoom } from "./rooms/KitchenRoom.js";

export interface StartKitchenServerOptions {
  port?: number;
  hostname?: string;
  reconnectionGraceSeconds?: number;
  placementSeed?: string;
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
  const httpServer: HttpServer = createServer();
  const transport = new WebSocketTransport({ server: httpServer });
  const gameServer = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
  });

  gameServer.define(KITCHEN_ROOM_NAME, KitchenRoom, {
    reconnectionGraceSeconds:
      options.reconnectionGraceSeconds ?? DEFAULT_RECONNECTION_GRACE_SECONDS,
    ...(options.placementSeed ? { placementSeed: options.placementSeed } : {}),
  });
  await gameServer.listen(options.port ?? 2567, hostname);

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
      }
    },
  };
}

async function main(): Promise<void> {
  const running = await startKitchenServer({
    port: productionPort(process.env.PORT),
    hostname: process.env.HOST ?? "0.0.0.0",
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
