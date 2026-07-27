import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { afterEach, describe, expect, test } from "vitest";

import {
  KITCHEN_LAYOUT,
  KITCHEN_MESSAGES,
  KITCHEN_ROOM_NAME,
  OBJECT_INTERACTION_RADIUS,
  type InteractionErrorPayload,
  type CookingErrorPayload,
  type KitchenRoomState,
} from "@cooking-game/shared";
import { startKitchenServer, type RunningKitchenServer } from "../src/index.js";
import { MovementRateBudget } from "../src/systems/movement-system.js";

describe("MovementRateBudget", () => {
  test("allows a release burst, rejects excess traffic, and recovers at the send interval", () => {
    const budget = new MovementRateBudget();

    expect(budget.consume("player", 0)).toBe(true);
    expect(budget.consume("player", 0)).toBe(true);
    expect(budget.consume("player", 0)).toBe(false);
    expect(budget.consume("player", 49)).toBe(false);
    expect(budget.consume("player", 50)).toBe(true);
    expect(budget.consume("player", 50)).toBe(false);
    budget.delete("player");
    expect(budget.consume("player", 50)).toBe(true);
  });
});

describe("KitchenRoom authoritative movement", () => {
  let running: RunningKitchenServer | undefined;
  const rooms: ClientRoom<KitchenRoomState>[] = [];

  afterEach(async () => {
    await Promise.allSettled(rooms.splice(0).map((room) =>
      room.connection.isOpen ? room.leave() : Promise.resolve()
    ));
    await running?.shutdown();
    running = undefined;
  });

  test("rejects queued movement before the round is authorized", async () => {
    running = await startKitchenServer({ port: 0 });
    const sdk = new Client(running.endpoint);
    const first = await sdk.create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "One" });
    rooms.push(first);
    const spawn = KITCHEN_LAYOUT.roleSpawns.BLIND_COOK;

    first.send(KITCHEN_MESSAGES.movementIntent, { sequence: 1, axisX: 1, axisZ: 0 });
    await new Promise((resolve) => setTimeout(resolve, 75));
    rooms.push(await sdk.joinById<KitchenRoomState>(first.roomId, { displayName: "Two" }));
    rooms.push(await sdk.joinById<KitchenRoomState>(first.roomId, { displayName: "Three" }));
    await waitForState(first, (state) => state.status === "READY");
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(first.state.players.get(first.sessionId)).toMatchObject({
      x: spawn.x,
      z: spawn.z,
      lastProcessedMovementSequence: 0,
      locomotion: "IDLE",
    });
  });

  test("moves every role on fixed ticks and rejects client transforms, invalid axes, and replay", async () => {
    running = await startKitchenServer({ port: 0 });
    const sdk = new Client(running.endpoint);
    const first = await sdk.create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "One" });
    rooms.push(first);
    rooms.push(await sdk.joinById<KitchenRoomState>(first.roomId, { displayName: "Two" }));
    rooms.push(await sdk.joinById<KitchenRoomState>(first.roomId, { displayName: "Three" }));
    await waitForState(first, (state) => state.status === "READY");

    for (const room of rooms) {
      const player = room.state.players.get(room.sessionId)!;
      expect({ x: player.x, z: player.z }).toEqual(KITCHEN_LAYOUT.roleSpawns[player.role]);
      room.send(KITCHEN_MESSAGES.movementIntent, { sequence: 1, axisX: 1, axisZ: 0 });
    }
    await waitForState(first, (state) =>
      Array.from(state.players.values()).every((player) =>
        player.lastProcessedMovementSequence === 1
        && player.x > KITCHEN_LAYOUT.roleSpawns[player.role].x
        && player.locomotion === "MOVE"
      )
    );

    const controlled = rooms[0]!;
    controlled.send(KITCHEN_MESSAGES.movementIntent, { sequence: 2, axisX: 0, axisZ: 0 });
    await waitForState(first, (state) =>
      state.players.get(controlled.sessionId)?.lastProcessedMovementSequence === 2
    );
    const before = first.state.players.get(controlled.sessionId)!;
    const authoritative = { x: before.x, z: before.z, sequence: before.lastProcessedMovementSequence };
    controlled.send(KITCHEN_MESSAGES.movementIntent, {
      sequence: 3,
      axisX: 0,
      axisZ: 0,
      x: 99,
      z: 57,
    });
    controlled.send(KITCHEN_MESSAGES.movementIntent, { sequence: 2, axisX: -1, axisZ: 0 });
    controlled.send(KITCHEN_MESSAGES.movementIntent, { sequence: 3, axisX: 1, axisZ: 1 });
    await new Promise((resolve) => setTimeout(resolve, 120));

    const after = first.state.players.get(controlled.sessionId)!;
    expect({
      x: after.x,
      z: after.z,
      sequence: after.lastProcessedMovementSequence,
    }).toEqual(authoritative);

    controlled.send(KITCHEN_MESSAGES.movementIntent, { sequence: 4, axisX: 0, axisZ: 0 });
    controlled.send(KITCHEN_MESSAGES.movementIntent, { sequence: 5, axisX: -1, axisZ: 0 });
    await waitForState(first, (state) =>
      state.players.get(controlled.sessionId)?.lastProcessedMovementSequence === 5
    );
    const afterFlood = first.state.players.get(controlled.sessionId)!;
    expect(afterFlood.lastProcessedMovementSequence).toBe(5);
    expect(afterFlood.x).toBeLessThan(authoritative.x);
    expect(afterFlood.z).toBe(authoritative.z);
  });

  test("collapses same-tick movement bursts to the latest valid intent so key release cannot be lost", async () => {
    running = await startKitchenServer({ port: 0 });
    const sdk = new Client(running.endpoint);
    const controlled = await sdk.create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "One" });
    rooms.push(controlled);
    rooms.push(await sdk.joinById<KitchenRoomState>(controlled.roomId, { displayName: "Two" }));
    rooms.push(await sdk.joinById<KitchenRoomState>(controlled.roomId, { displayName: "Three" }));
    await waitForState(controlled, (state) => state.status === "READY");

    const spawn = KITCHEN_LAYOUT.roleSpawns[controlled.state.players.get(controlled.sessionId)!.role];
    controlled.send(KITCHEN_MESSAGES.movementIntent, { sequence: 1, axisX: 1, axisZ: 0 });
    controlled.send(KITCHEN_MESSAGES.movementIntent, { sequence: 2, axisX: 0, axisZ: 0 });

    await waitForState(controlled, (state) =>
      state.players.get(controlled.sessionId)?.lastProcessedMovementSequence === 2
    );
    const stopped = controlled.state.players.get(controlled.sessionId)!;
    expect({ x: stopped.x, z: stopped.z, locomotion: stopped.locomotion }).toEqual({
      ...spawn,
      locomotion: "IDLE",
    });
  });

  test("uses the authoritative Blind Cook transform for object reach", async () => {
    running = await startKitchenServer({ port: 0, placementSeed: "movement-reach" });
    const sdk = new Client(running.endpoint);
    const blindCook = await sdk.create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "Blind" });
    rooms.push(blindCook);
    rooms.push(await sdk.joinById<KitchenRoomState>(blindCook.roomId, { displayName: "Keeper" }));
    rooms.push(await sdk.joinById<KitchenRoomState>(blindCook.roomId, { displayName: "Guide" }));
    await waitForState(blindCook, (state) => state.status === "READY");

    blindCook.send(KITCHEN_MESSAGES.movementIntent, { sequence: 1, axisX: -1, axisZ: 0 });
    await waitForState(
      blindCook,
      (state) => (state.players.get(blindCook.sessionId)?.x ?? 100) < 4,
      4_000,
    );
    blindCook.send(KITCHEN_MESSAGES.movementIntent, { sequence: 2, axisX: 0, axisZ: 0 });
    await waitForState(blindCook, (state) =>
      state.players.get(blindCook.sessionId)?.lastProcessedMovementSequence === 2
    );
    const player = blindCook.state.players.get(blindCook.sessionId)!;
    const object = Array.from(blindCook.state.objects.values()).sort(
      (first, second) => second.x - first.x,
    )[0]!;
    expect((object.x - player.x) ** 2 + (object.y - player.z) ** 2)
      .toBeGreaterThan(OBJECT_INTERACTION_RADIUS ** 2);
    const error = nextMessage<InteractionErrorPayload>(
      blindCook,
      KITCHEN_MESSAGES.interactionError,
    );

    blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: object.id });

    await expect(error).resolves.toMatchObject({ code: "OUT_OF_REACH" });
    expect(blindCook.state.objects.get(object.id)?.heldBy).toBe("");
  });

  test("carries and drops objects only at server-owned transforms", async () => {
    running = await startKitchenServer({ port: 0, placementSeed: "movement-carry" });
    const sdk = new Client(running.endpoint);
    const blindCook = await sdk.create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "Blind" });
    rooms.push(blindCook);
    rooms.push(await sdk.joinById<KitchenRoomState>(blindCook.roomId, { displayName: "Keeper" }));
    const observer = await sdk.joinById<KitchenRoomState>(blindCook.roomId, { displayName: "Guide" });
    rooms.push(observer);
    await waitForState(observer, (state) => state.status === "READY");

    const object = Array.from(observer.state.objects.values())[0]!;
    blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: object.id });
    await waitForState(observer, (state) =>
      state.objects.get(object.id)?.heldBy === blindCook.sessionId
    );
    blindCook.send(KITCHEN_MESSAGES.movementIntent, { sequence: 1, axisX: 1, axisZ: 0 });
    await waitForState(observer, (state) => {
      const player = state.players.get(blindCook.sessionId);
      const carried = state.objects.get(object.id);
      return player?.lastProcessedMovementSequence === 1
        && carried?.x === player.x
        && carried.y === player.z;
    });
    blindCook.send(KITCHEN_MESSAGES.movementIntent, { sequence: 2, axisX: 0, axisZ: 0 });
    await waitForState(observer, (state) =>
      state.players.get(blindCook.sessionId)?.lastProcessedMovementSequence === 2
    );

    const invalid = nextMessage<InteractionErrorPayload>(
      blindCook,
      KITCHEN_MESSAGES.interactionError,
    );
    blindCook.send(KITCHEN_MESSAGES.drop, { objectId: object.id, x: 99, y: 57 });
    await expect(invalid).resolves.toMatchObject({ code: "INVALID_COMMAND" });
    expect(observer.state.objects.get(object.id)?.heldBy).toBe(blindCook.sessionId);

    blindCook.send(KITCHEN_MESSAGES.drop, { objectId: object.id });
    await waitForState(observer, (state) => {
      const player = state.players.get(blindCook.sessionId);
      const dropped = state.objects.get(object.id);
      return dropped?.heldBy === "" && dropped.x === player?.x && dropped.y === player.z;
    });
  });

  test("requires the Blind Cook authoritative transform to reach cooking stations", async () => {
    running = await startKitchenServer({ port: 0, placementSeed: "movement-station" });
    const sdk = new Client(running.endpoint);
    const blindCook = await sdk.create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "Blind" });
    rooms.push(blindCook);
    rooms.push(await sdk.joinById<KitchenRoomState>(blindCook.roomId, { displayName: "Keeper" }));
    rooms.push(await sdk.joinById<KitchenRoomState>(blindCook.roomId, { displayName: "Guide" }));
    await waitForState(blindCook, (state) => state.status === "READY");

    const object = Array.from(blindCook.state.objects.values()).find(
      ({ kind }) => kind === "TOMATO",
    )!;
    blindCook.send(KITCHEN_MESSAGES.pickUp, { objectId: object.id });
    await waitForState(blindCook, (state) =>
      state.objects.get(object.id)?.heldBy === blindCook.sessionId
    );
    blindCook.send(KITCHEN_MESSAGES.movementIntent, { sequence: 1, axisX: -1, axisZ: 0 });
    await waitForState(
      blindCook,
      (state) => (state.players.get(blindCook.sessionId)?.x ?? 100) < 4,
      4_000,
    );
    blindCook.send(KITCHEN_MESSAGES.movementIntent, { sequence: 2, axisX: 0, axisZ: 0 });
    await waitForState(blindCook, (state) =>
      state.players.get(blindCook.sessionId)?.lastProcessedMovementSequence === 2
    );
    const error = nextMessage<CookingErrorPayload>(
      blindCook,
      KITCHEN_MESSAGES.cookingError,
    );

    blindCook.send(KITCHEN_MESSAGES.cookAction, {
      action: "CHOP",
      actionSequence: 1,
      objectId: object.id,
    });

    await expect(error).resolves.toMatchObject({ code: "OUT_OF_REACH" });
    expect(blindCook.state.completedStepCount).toBe(0);
    expect(blindCook.state.objects.get(object.id)?.preparation).toBe("RAW");
  }, 8_000);

  test("preserves reconnect transforms without resuming stale held input", async () => {
    running = await startKitchenServer({ port: 0, reconnectionGraceSeconds: 2 });
    const sdk = new Client(running.endpoint);
    const observer = await sdk.create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "One" });
    rooms.push(observer);
    const moving = await sdk.joinById<KitchenRoomState>(observer.roomId, { displayName: "Two" });
    rooms.push(moving);
    rooms.push(await sdk.joinById<KitchenRoomState>(observer.roomId, { displayName: "Three" }));
    await waitForState(observer, (state) => state.status === "READY");

    moving.send(KITCHEN_MESSAGES.movementIntent, { sequence: 1, axisX: 1, axisZ: 0 });
    await waitForState(observer, (state) =>
      (state.players.get(moving.sessionId)?.x ?? 0)
        > KITCHEN_LAYOUT.roleSpawns.RECIPE_KEEPER.x
    );
    const token = moving.reconnectionToken;
    const sessionId = moving.sessionId;
    const role = observer.state.players.get(sessionId)!.role;
    moving.reconnection.enabled = false;
    moving.connection.close();
    await waitForState(observer, (state) => state.connectedCount === 2);
    const reserved = observer.state.players.get(sessionId)!;
    const reservedTransform = {
      x: reserved.x,
      z: reserved.z,
      facingYaw: reserved.facingYaw,
      sequence: reserved.lastProcessedMovementSequence,
    };

    const reconnected = await new Client(running.endpoint).reconnect<KitchenRoomState>(token);
    rooms.splice(rooms.indexOf(moving), 1, reconnected);
    await waitForState(observer, (state) => state.connectedCount === 3);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const resumed = observer.state.players.get(sessionId)!;
    expect(resumed.role).toBe(role);
    expect({
      x: resumed.x,
      z: resumed.z,
      facingYaw: resumed.facingYaw,
      sequence: resumed.lastProcessedMovementSequence,
    }).toEqual(reservedTransform);
    expect(resumed.locomotion).toBe("IDLE");
  });

  test("stops before shared static colliders and reports blocked locomotion as idle", async () => {
    running = await startKitchenServer({ port: 0 });
    const sdk = new Client(running.endpoint);
    const blindCook = await sdk.create<KitchenRoomState>(KITCHEN_ROOM_NAME, { displayName: "Blind" });
    rooms.push(blindCook);
    rooms.push(await sdk.joinById<KitchenRoomState>(blindCook.roomId, { displayName: "Keeper" }));
    rooms.push(await sdk.joinById<KitchenRoomState>(blindCook.roomId, { displayName: "Guide" }));
    await waitForState(blindCook, (state) => state.status === "READY");

    blindCook.send(KITCHEN_MESSAGES.movementIntent, { sequence: 1, axisX: 0, axisZ: 1 });
    await waitForState(
      blindCook,
      (state) => (state.players.get(blindCook.sessionId)?.z ?? 0) > 47,
      3_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const blocked = blindCook.state.players.get(blindCook.sessionId)!;
    const collider = KITCHEN_LAYOUT.staticColliders.find(
      ({ minX, maxX }) => blocked.x > minX && blocked.x < maxX,
    )!;

    expect(blocked.z).toBeLessThanOrEqual(collider.minZ - 2);
    expect(blocked.locomotion).toBe("IDLE");

    blindCook.send(KITCHEN_MESSAGES.movementIntent, { sequence: 2, axisX: 0, axisZ: -1 });
    await waitForState(
      blindCook,
      (state) => (state.players.get(blindCook.sessionId)?.z ?? 100) < 3,
      4_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const bounded = blindCook.state.players.get(blindCook.sessionId)!;
    expect(bounded.z).toBeGreaterThanOrEqual(KITCHEN_LAYOUT.walkableBounds.minZ);
    expect(bounded.locomotion).toBe("IDLE");
  }, 8_000);
});

function nextMessage<T>(room: ClientRoom<KitchenRoomState>, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${type}`));
    }, 2_000);
    const unsubscribe = room.onMessage(type, (payload) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(payload as T);
    });
  });
}

function waitForState(
  room: ClientRoom<KitchenRoomState>,
  predicate: (state: KitchenRoomState) => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  if (predicate(room.state)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscription.remove();
      reject(new Error("Timed out waiting for room state"));
    }, timeoutMs);
    const subscription = room.onStateChange((state) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      subscription.remove();
      resolve();
    });
  });
}
