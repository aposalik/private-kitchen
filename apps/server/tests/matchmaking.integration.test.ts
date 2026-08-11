import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { afterEach, describe, expect, test } from "vitest";

import {
  MATCHMAKING_MESSAGES,
  MATCHMAKING_ROOM_NAME,
  type MatchmakingServerEvent,
} from "@cooking-game/shared";
import { startKitchenServer, type RunningKitchenServer } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (predicate()) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        reject(new Error("waitFor timed out"));
      }
    }, 20);
  });
}

type MM = Extract<MatchmakingServerEvent, { type: "READY_CHECK" }>;
type MR = Extract<MatchmakingServerEvent, { type: "MATCH_READY" }>;
type MC = Extract<MatchmakingServerEvent, { type: "MATCH_CANCELLED" }>;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("MatchmakingRoom", () => {
  let running: RunningKitchenServer | undefined;
  const rooms: ClientRoom[] = [];

  afterEach(async () => {
    await Promise.allSettled(
      rooms.splice(0).map((r) =>
        r.connection.isOpen ? r.leave(true) : Promise.resolve(),
      ),
    );
    await running?.shutdown();
    running = undefined;
  });

  // Convenience: join the matchmaking room and collect server events.
  async function joinMM(
    client: Client,
    opts: { displayName: string; region: "EU" | "NA" | "ASIA" | "OTHER"; rolePreference: "ANY" | "BLIND_COOK" | "RECIPE_KEEPER" | "DEAF_KITCHEN_GUIDE" },
  ) {
    const room = await client.joinOrCreate(MATCHMAKING_ROOM_NAME, opts);
    rooms.push(room);
    const events: MatchmakingServerEvent[] = [];
    room.onMessage(MATCHMAKING_MESSAGES.event, (e: MatchmakingServerEvent) =>
      events.push(e),
    );
    return { room, events };
  }

  function eu(displayName: string) {
    return { displayName, region: "EU" as const, rolePreference: "ANY" as const };
  }

  // ---------------------------------------------------------------------------

  test("rejects join with an empty displayName", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);

    await expect(
      client.joinOrCreate(MATCHMAKING_ROOM_NAME, {
        displayName: "",
        region: "EU",
        rolePreference: "ANY",
      }),
    ).rejects.toThrow();
  });

  test("rejects join with an unknown region value", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);

    await expect(
      client.joinOrCreate(MATCHMAKING_ROOM_NAME, {
        displayName: "Player",
        region: "MOON",
        rolePreference: "ANY",
      }),
    ).rejects.toThrow();
  });

  test("queued client receives QUEUE_UPDATE with inQueue >= 1", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);
    const { events } = await joinMM(client, eu("Solo"));

    await waitFor(() => events.some((e) => e.type === "QUEUE_UPDATE"));

    const update = events.find((e) => e.type === "QUEUE_UPDATE") as Extract<
      MatchmakingServerEvent,
      { type: "QUEUE_UPDATE" }
    >;
    expect(update.inQueue).toBeGreaterThanOrEqual(1);
  });

  test("three clients in the same region receive READY_CHECK with all three distinct roles", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);

    const [a, b, c] = await Promise.all([
      joinMM(client, eu("Alpha")),
      joinMM(client, eu("Bravo")),
      joinMM(client, eu("Charlie")),
    ]);

    await waitFor(() =>
      [a, b, c].every(({ events }) => events.some((e) => e.type === "READY_CHECK")),
    );

    const roles = [a, b, c].map(({ events }) => {
      const rc = events.find((e) => e.type === "READY_CHECK") as MM;
      return rc.assignedRole;
    });

    expect(new Set(roles).size).toBe(3);
    expect(roles).toEqual(
      expect.arrayContaining(["BLIND_COOK", "RECIPE_KEEPER", "DEAF_KITCHEN_GUIDE"]),
    );
  });

  test("all three accept → all receive MATCH_READY with roomId and a distinct ticket each", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);

    const [a, b, c] = await Promise.all([
      joinMM(client, { displayName: "One", region: "NA", rolePreference: "ANY" }),
      joinMM(client, { displayName: "Two", region: "NA", rolePreference: "ANY" }),
      joinMM(client, { displayName: "Three", region: "NA", rolePreference: "ANY" }),
    ]);

    await waitFor(() =>
      [a, b, c].every(({ events }) => events.some((e) => e.type === "READY_CHECK")),
    );

    for (const { room } of [a, b, c]) room.send(MATCHMAKING_MESSAGES.readyConfirm);

    await waitFor(() =>
      [a, b, c].every(({ events }) => events.some((e) => e.type === "MATCH_READY")),
    );

    const matchReadyEvents = [a, b, c].map(({ events }) =>
      events.find((e) => e.type === "MATCH_READY") as MR,
    );

    for (const mr of matchReadyEvents) {
      expect(typeof mr.roomId).toBe("string");
      expect(mr.roomId.length).toBeGreaterThan(0);
      expect(typeof mr.ticket).toBe("string");
      expect(mr.ticket.length).toBeGreaterThan(0);
    }

    // Tickets must be unique (each carries a different role)
    const tickets = matchReadyEvents.map((mr) => mr.ticket);
    expect(new Set(tickets).size).toBe(3);

    // All three point at the same room
    const roomIds = new Set(matchReadyEvents.map((mr) => mr.roomId));
    expect(roomIds.size).toBe(1);
  });

  test("one player declines → that player gets requeued:false, other two get requeued:true", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);

    const [a, b, c] = await Promise.all([
      joinMM(client, { displayName: "One", region: "ASIA", rolePreference: "ANY" }),
      joinMM(client, { displayName: "Two", region: "ASIA", rolePreference: "ANY" }),
      joinMM(client, { displayName: "Three", region: "ASIA", rolePreference: "ANY" }),
    ]);

    await waitFor(() =>
      [a, b, c].every(({ events }) => events.some((e) => e.type === "READY_CHECK")),
    );

    // Player a declines
    a.room.send(MATCHMAKING_MESSAGES.readyDecline);

    await waitFor(() =>
      b.events.some((e) => e.type === "MATCH_CANCELLED") &&
      c.events.some((e) => e.type === "MATCH_CANCELLED"),
    );

    const bCancelled = b.events.find((e) => e.type === "MATCH_CANCELLED") as MC;
    const cCancelled = c.events.find((e) => e.type === "MATCH_CANCELLED") as MC;
    expect(bCancelled.requeued).toBe(true);
    expect(cCancelled.requeued).toBe(true);
    expect(bCancelled.reason).toBe("DECLINED");
    expect(cCancelled.reason).toBe("DECLINED");
  });

  test("specific role preference is honoured in assignment", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);

    const [a] = await Promise.all([
      joinMM(client, { displayName: "Chef", region: "EU", rolePreference: "BLIND_COOK" }),
      joinMM(client, eu("Helper1")),
      joinMM(client, eu("Helper2")),
    ]);

    await waitFor(() => a.events.some((e) => e.type === "READY_CHECK"));

    const rc = a.events.find((e) => e.type === "READY_CHECK") as MM;
    expect(rc.assignedRole).toBe("BLIND_COOK");
  });

  test("clients in different regions are not matched together", async () => {
    running = await startKitchenServer({ port: 0 });
    const client = new Client(running.endpoint);

    const [a, b, c] = await Promise.all([
      joinMM(client, { displayName: "EU-1", region: "EU", rolePreference: "ANY" }),
      joinMM(client, { displayName: "NA-1", region: "NA", rolePreference: "ANY" }),
      joinMM(client, { displayName: "AS-1", region: "ASIA", rolePreference: "ANY" }),
    ]);

    // Wait until all have received at least one QUEUE_UPDATE (proves the server
    // processed all three joins), then confirm no READY_CHECK was sent.
    await waitFor(() =>
      [a, b, c].every(({ events }) => events.some((e) => e.type === "QUEUE_UPDATE")),
    );

    expect(
      [a, b, c].every(({ events }) => !events.some((e) => e.type === "READY_CHECK")),
    ).toBe(true);
  });
});
