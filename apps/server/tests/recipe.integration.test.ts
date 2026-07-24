import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { afterEach, describe, expect, test } from "vitest";

import {
  COMMUNICATION_MESSAGES,
  KITCHEN_MESSAGES,
  KITCHEN_ROOM_NAME,
  MAX_OBJECT_ID_LENGTH,
  isWithinReach,
  type CookingErrorPayload,
  type CookAction,
  type InteractionErrorPayload,
  type KitchenRoomState,
} from "@cooking-game/shared";
import { startKitchenServer, type RunningKitchenServer } from "../src/index.js";

describe("Phase 4 authoritative Tomato Soup round", () => {
  let running: RunningKitchenServer | undefined;
  const rooms: ClientRoom<KitchenRoomState>[] = [];

  afterEach(async () => {
    await Promise.allSettled(
      rooms.splice(0).map((room) =>
        room.connection.isOpen ? room.leave() : Promise.resolve(),
      ),
    );
    await running?.shutdown();
    running = undefined;
  });

  test("the first READY transition starts one 10-step round with bounded authoritative inventory", async () => {
    const ready = await createReadyRoom({ roundDurationMs: 12_345 });

    await waitForState(ready.blindCook, (state) => state.roundStatus === "RUNNING");
    expect(ready.blindCook.state).toMatchObject({
      status: "READY",
      roundStatus: "RUNNING",
      completedStepCount: 0,
      totalStepCount: 10,
      outcomeReason: "NONE",
    });
    expect(ready.blindCook.state.remainingMs).toBeGreaterThan(0);
    expect(ready.blindCook.state.remainingMs).toBeLessThanOrEqual(12_345);

    const objects = Array.from(ready.blindCook.state.objects.values());
    expect(objects.filter(({ kind }) => kind === "TOMATO")).toHaveLength(2);
    expect(objects.filter(({ kind }) => kind === "ONION")).toHaveLength(1);
    expect(objects).toHaveLength(3);
    expect(objects.every(({ preparation, location }) =>
      preparation === "RAW" && location === "COUNTER"
    )).toBe(true);
  });

  test("only Recipe Keeper receives the strict private recipe on bootstrap and valid readiness", async () => {
    const privateMessages = new Map<string, unknown[]>();
    const ready = await createReadyRoom({}, privateMessages);
    await waitFor(() => (privateMessages.get(ready.recipeKeeper.sessionId)?.length ?? 0) === 1);

    expect(privateMessages.get(ready.blindCook.sessionId)).toEqual([]);
    expect(privateMessages.get(ready.deafGuide.sessionId)).toEqual([]);
    expect(privateMessages.get(ready.recipeKeeper.sessionId)).toEqual([{
      id: "tomato-soup",
      title: "Tomato Soup",
      ingredients: [
        { kind: "TOMATO", count: 2 },
        { kind: "ONION", count: 1 },
      ],
      steps: [
        { action: "CHOP", ingredientKind: "TOMATO" },
        { action: "CHOP", ingredientKind: "ONION" },
        { action: "ADD_TO_POT", ingredientKind: "TOMATO" },
        { action: "ADD_TO_POT", ingredientKind: "ONION" },
        { action: "SEASON" },
        { action: "BOIL" },
        { action: "MIX" },
        { action: "PLATE" },
      ],
    }]);

    ready.blindCook.send(KITCHEN_MESSAGES.roundReady, {});
    ready.deafGuide.send(KITCHEN_MESSAGES.roundReady, {});
    ready.recipeKeeper.send(KITCHEN_MESSAGES.roundReady, { ready: true });
    await delay(80);
    expect(privateMessages.get(ready.recipeKeeper.sessionId)).toHaveLength(1);

    ready.recipeKeeper.send(KITCHEN_MESSAGES.roundReady, {});
    await waitFor(() => privateMessages.get(ready.recipeKeeper.sessionId)?.length === 2);
    expect(privateMessages.get(ready.blindCook.sessionId)).toEqual([]);
    expect(privateMessages.get(ready.deafGuide.sessionId)).toEqual([]);
  });

  test("strict sender authority and monotonic sequences reject only the sender without mutation", async () => {
    const ready = await createReadyRoom();
    const blindErrors: CookingErrorPayload[] = [];
    const keeperErrors: CookingErrorPayload[] = [];
    const deafErrors: CookingErrorPayload[] = [];
    ready.blindCook.onMessage(KITCHEN_MESSAGES.cookingError, (error) =>
      blindErrors.push(error as CookingErrorPayload));
    ready.recipeKeeper.onMessage(KITCHEN_MESSAGES.cookingError, (error) =>
      keeperErrors.push(error as CookingErrorPayload));
    ready.deafGuide.onMessage(KITCHEN_MESSAGES.cookingError, (error) =>
      deafErrors.push(error as CookingErrorPayload));
    const initialProgress = ready.blindCook.state.completedStepCount;

    ready.recipeKeeper.send(KITCHEN_MESSAGES.cookAction, {
      action: "MIX",
      actionSequence: 1,
    });
    await waitFor(() => keeperErrors.length === 1);
    expect(keeperErrors[0]?.code).toBe("NOT_AUTHORIZED");
    expect(blindErrors).toEqual([]);
    expect(deafErrors).toEqual([]);

    ready.blindCook.send(KITCHEN_MESSAGES.cookAction, {
      action: "MIX",
      actionSequence: 1,
      role: "BLIND_COOK",
    });
    await waitFor(() => blindErrors.length === 1);
    expect(blindErrors[0]?.code).toBe("INVALID_COMMAND");

    ready.blindCook.send(KITCHEN_MESSAGES.cookAction, {
      action: "MIX",
      actionSequence: 1,
    });
    await waitFor(() => blindErrors.length === 2);
    expect(blindErrors[1]?.code).toBe("OUT_OF_ORDER");

    ready.blindCook.send(KITCHEN_MESSAGES.cookAction, {
      action: "CHOP",
      actionSequence: 2,
      objectId: "does-not-exist",
    });
    await waitFor(() => blindErrors.length === 3);
    expect(blindErrors[2]?.code).toBe("OBJECT_NOT_FOUND");

    ready.blindCook.send(KITCHEN_MESSAGES.cookAction, {
      action: "CHOP",
      actionSequence: 2,
      objectId: "does-not-exist",
    });
    ready.blindCook.send(KITCHEN_MESSAGES.cookAction, {
      action: "CHOP",
      actionSequence: 1,
      objectId: "does-not-exist",
    });
    await waitFor(() => blindErrors.length === 5);
    expect(blindErrors.slice(3).map(({ code }) => code)).toEqual([
      "REPLAYED_ACTION",
      "STALE_ACTION",
    ]);
    expect(ready.blindCook.state.completedStepCount).toBe(initialProgress);
    expect(keeperErrors).toHaveLength(1);
    expect(deafErrors).toEqual([]);
  });

  test("required held ingredients chop and enter the pot with real quantity progress", async () => {
    const ready = await createReadyRoom();
    const objects = Array.from(ready.blindCook.state.objects.values());
    const tomatoes = objects.filter(({ kind }) => kind === "TOMATO");
    const onion = objects.find(({ kind }) => kind === "ONION")!;
    let sequence = 0;

    await sendCookExpectError(ready.blindCook, {
      action: "CHOP", actionSequence: ++sequence, objectId: tomatoes[0]!.id,
    }, "OBJECT_NOT_OWNED");

    await pickUp(ready.blindCook, tomatoes[0]!.id);
    await sendCookUntilProgress(ready.blindCook, {
      action: "CHOP", actionSequence: ++sequence, objectId: tomatoes[0]!.id,
    }, 1);
    await sendCookExpectError(ready.blindCook, {
      action: "ADD_TO_POT", actionSequence: ++sequence, objectId: tomatoes[0]!.id,
    }, "OUT_OF_ORDER");
    await drop(ready.blindCook, tomatoes[0]!.id);

    await pickUp(ready.blindCook, onion.id);
    await sendCookExpectError(ready.blindCook, {
      action: "ADD_TO_POT", actionSequence: ++sequence, objectId: onion.id,
    }, "OUT_OF_ORDER");
    await sendCookUntilProgress(ready.blindCook, {
      action: "CHOP", actionSequence: ++sequence, objectId: onion.id,
    }, 2);
    await drop(ready.blindCook, onion.id);

    await pickUp(ready.blindCook, tomatoes[1]!.id);
    await sendCookUntilProgress(ready.blindCook, {
      action: "CHOP", actionSequence: ++sequence, objectId: tomatoes[1]!.id,
    }, 3);
    await sendCookUntilProgress(ready.blindCook, {
      action: "ADD_TO_POT", actionSequence: ++sequence, objectId: tomatoes[1]!.id,
    }, 4);
    expect(ready.blindCook.state.objects.get(tomatoes[1]!.id)).toMatchObject({
      preparation: "CHOPPED", location: "POT", heldBy: "",
    });

    await sendPickUpExpectError(ready.blindCook, tomatoes[1]!.id, "OBJECT_UNAVAILABLE");
    for (const objectId of [tomatoes[0]!.id, onion.id]) {
      await pickUp(ready.blindCook, objectId);
      await sendCookUntilProgress(ready.blindCook, {
        action: "ADD_TO_POT", actionSequence: ++sequence, objectId,
      }, ready.blindCook.state.completedStepCount + 1);
    }

    expect(ready.blindCook.state.completedStepCount).toBe(6);
    const inPot = Array.from(ready.blindCook.state.objects.values()).filter(
      ({ location }) => location === "POT",
    );
    expect(inPot.filter(({ kind }) => kind === "TOMATO")).toHaveLength(2);
    expect(inPot.filter(({ kind }) => kind === "ONION")).toHaveLength(1);
  });

  test("a legitimate second chop ruins, rolls back, and replaces without unbounded growth", async () => {
    const ready = await createReadyRoom();
    let targetId = Array.from(ready.blindCook.state.objects.values()).find(
      ({ kind }) => kind === "TOMATO",
    )!.id;
    let sequence = 0;

    for (let cycle = 0; cycle < 4; cycle += 1) {
      await pickUp(ready.blindCook, targetId);
      await sendCookUntilProgress(ready.blindCook, {
        action: "CHOP", actionSequence: ++sequence, objectId: targetId,
      }, 1);
      const idsBeforeRuin = new Set(
        Array.from(ready.blindCook.state.objects.values(), ({ id }) => id),
      );
      ready.blindCook.send(KITCHEN_MESSAGES.cookAction, {
        action: "CHOP", actionSequence: ++sequence, objectId: targetId,
      });
      await waitForState(ready.blindCook, (state) =>
        state.completedStepCount === 0
        && state.objects.get(targetId)?.preparation === "RUINED"
        && state.objects.get(targetId)?.heldBy === ""
      );

      const currentObjects = Array.from(ready.blindCook.state.objects.values());
      const ruinedTomatoes = currentObjects.filter(
        ({ kind, preparation }) => kind === "TOMATO" && preparation === "RUINED",
      );
      expect(ruinedTomatoes).toHaveLength(1);
      expect(currentObjects).toHaveLength(4);
      await sendPickUpExpectError(ready.blindCook, targetId, "OBJECT_UNAVAILABLE");

      const replacements = currentObjects.filter(
        ({ id, kind, preparation, location }) =>
          !idsBeforeRuin.has(id)
          && kind === "TOMATO"
          && preparation === "RAW"
          && location === "COUNTER",
      );
      expect(replacements).toHaveLength(1);
      expect(replacements[0]!.id.length).toBeLessThanOrEqual(MAX_OBJECT_ID_LENGTH);
      expect(isWithinReach(replacements[0]!.x, replacements[0]!.y)).toBe(true);
      targetId = replacements[0]!.id;
    }
  });

  test("terminal actions enforce exact order, win at 10, and freeze after completion", async () => {
    const ready = await createReadyRoom({ roundDurationMs: 12_345 });
    const keeperErrors: CookingErrorPayload[] = [];
    ready.recipeKeeper.onMessage(KITCHEN_MESSAGES.cookingError, (error) =>
      keeperErrors.push(error as CookingErrorPayload));
    const allObjects = Array.from(ready.blindCook.state.objects.values());
    const required = allObjects.filter(
      ({ kind }) => kind === "TOMATO" || kind === "ONION",
    );
    let sequence = 0;

    for (const object of required) {
      await pickUp(ready.blindCook, object.id);
      await sendCookUntilProgress(ready.blindCook, {
        action: "CHOP", actionSequence: ++sequence, objectId: object.id,
      }, sequence);
      await drop(ready.blindCook, object.id);
    }
    for (const object of required) {
      await pickUp(ready.blindCook, object.id);
      await sendCookUntilProgress(ready.blindCook, {
        action: "ADD_TO_POT", actionSequence: ++sequence, objectId: object.id,
      }, sequence);
    }
    expect(ready.blindCook.state.completedStepCount).toBe(6);

    await sendCookExpectError(ready.blindCook, {
      action: "BOIL", actionSequence: ++sequence,
    }, "OUT_OF_ORDER");
    expect(ready.blindCook.state.completedStepCount).toBe(6);
    await sendCookUntilProgress(ready.blindCook, {
      action: "SEASON", actionSequence: ++sequence,
    }, 7);
    await sendCookExpectError(ready.blindCook, {
      action: "MIX", actionSequence: ++sequence,
    }, "OUT_OF_ORDER");
    expect(ready.blindCook.state.completedStepCount).toBe(7);
    await sendCookUntilProgress(ready.blindCook, {
      action: "BOIL", actionSequence: ++sequence,
    }, 8);
    await sendCookExpectError(ready.blindCook, {
      action: "PLATE", actionSequence: ++sequence,
    }, "OUT_OF_ORDER");
    await sendCookUntilProgress(ready.blindCook, {
      action: "MIX", actionSequence: ++sequence,
    }, 9);

    ready.blindCook.send(KITCHEN_MESSAGES.cookAction, {
      action: "PLATE", actionSequence: ++sequence,
    });
    await waitForState(ready.blindCook, (state) => state.roundStatus === "WON");
    expect(ready.blindCook.state).toMatchObject({
      roundStatus: "WON",
      completedStepCount: 10,
      totalStepCount: 10,
      outcomeReason: "COMPLETED",
    });
    const terminalSnapshot = {
      roundStatus: ready.blindCook.state.roundStatus,
      remainingMs: ready.blindCook.state.remainingMs,
      completedStepCount: ready.blindCook.state.completedStepCount,
      outcomeReason: ready.blindCook.state.outcomeReason,
    };

    await sendCookExpectError(ready.blindCook, {
      action: "SEASON", actionSequence: ++sequence,
    }, "ROUND_TERMINAL");
    await sendPickUpExpectError(ready.blindCook, required[0]!.id, "NOT_READY");
    expect(ready.blindCook.state.objects.get(required[0]!.id)?.heldBy).toBe("");
    await delay(80);
    expect(ready.blindCook.state).toMatchObject(terminalSnapshot);
    expect(keeperErrors).toEqual([]);
  });

  test("authoritative monotonic time expires at zero and freezes the lost round", async () => {
    const ready = await createReadyRoom({ roundDurationMs: 180 });
    const blindErrors: CookingErrorPayload[] = [];
    const keeperErrors: CookingErrorPayload[] = [];
    ready.blindCook.onMessage(KITCHEN_MESSAGES.cookingError, (error) =>
      blindErrors.push(error as CookingErrorPayload));
    ready.recipeKeeper.onMessage(KITCHEN_MESSAGES.cookingError, (error) =>
      keeperErrors.push(error as CookingErrorPayload));

    await waitForState(ready.blindCook, (state) =>
      state.roundStatus === "RUNNING"
      && state.remainingMs > 0
      && state.remainingMs < 180
    );
    expect(ready.blindCook.state.completedStepCount).toBe(0);

    await waitForState(ready.blindCook, (state) =>
      state.roundStatus === "LOST" && state.remainingMs === 0
    );
    expect(ready.blindCook.state).toMatchObject({
      roundStatus: "LOST",
      remainingMs: 0,
      completedStepCount: 0,
      totalStepCount: 10,
      outcomeReason: "TIME_EXPIRED",
    });
    const terminalSnapshot = {
      roundStatus: ready.blindCook.state.roundStatus,
      remainingMs: ready.blindCook.state.remainingMs,
      completedStepCount: ready.blindCook.state.completedStepCount,
      totalStepCount: ready.blindCook.state.totalStepCount,
      outcomeReason: ready.blindCook.state.outcomeReason,
    };
    await delay(100);
    expect(ready.blindCook.state).toMatchObject(terminalSnapshot);

    const tomato = Array.from(ready.blindCook.state.objects.values()).find(
      ({ kind }) => kind === "TOMATO",
    )!;
    ready.blindCook.send(KITCHEN_MESSAGES.cookAction, {
      action: "CHOP",
      actionSequence: 1,
      objectId: tomato.id,
    });
    await waitFor(() => blindErrors.length === 1);
    expect(blindErrors[0]?.code).toBe("ROUND_TERMINAL");
    expect(keeperErrors).toEqual([]);
    expect(ready.blindCook.state).toMatchObject(terminalSnapshot);
  });

  test("disconnect pauses exactly and reconnect resumes identity, sequence, timer, and private recipe", async () => {
    const privateMessages = new Map<string, unknown[]>();
    const ready = await createReadyRoom({ roundDurationMs: 1_200 }, privateMessages);
    await waitForState(ready.blindCook, (state) => state.remainingMs < 1_150);

    await sendCookExpectError(ready.recipeKeeper, {
      action: "MIX", actionSequence: 4,
    }, "NOT_AUTHORIZED");
    const dropped = ready.recipeKeeper;
    const sessionId = dropped.sessionId;
    const role = dropped.state.players.get(sessionId)!.role;
    const reconnectionToken = dropped.reconnectionToken;
    dropped.reconnection.enabled = false;
    dropped.connection.close();

    await waitForState(ready.blindCook, (state) => state.roundStatus === "PAUSED");
    const pausedRemaining = ready.blindCook.state.remainingMs;
    const pausedProgress = ready.blindCook.state.completedStepCount;
    await delay(160);
    expect(ready.blindCook.state).toMatchObject({
      status: "WAITING",
      roundStatus: "PAUSED",
      remainingMs: pausedRemaining,
      completedStepCount: pausedProgress,
    });

    const reconnected = await new Client(running!.endpoint).reconnect<KitchenRoomState>(
      reconnectionToken,
    );
    const reconnectPrivateMessages = new Map<string, unknown[]>();
    capturePrivateMessages(reconnected, reconnectPrivateMessages);
    registerNoopHandlers(reconnected);
    rooms.push(reconnected);
    await waitForState(ready.blindCook, (state) => state.roundStatus === "RUNNING");
    expect(reconnected.sessionId).toBe(sessionId);
    expect(reconnected.state.players.get(sessionId)?.role).toBe(role);
    expect(ready.blindCook.state.remainingMs).toBeLessThanOrEqual(pausedRemaining);
    expect(ready.blindCook.state.remainingMs).toBeGreaterThan(0);
    expect(ready.blindCook.state.completedStepCount).toBe(pausedProgress);
    await waitForState(ready.blindCook, (state) =>
      state.roundStatus === "RUNNING" && state.remainingMs < pausedRemaining
    );

    const replay = nextMessage<CookingErrorPayload>(
      reconnected,
      KITCHEN_MESSAGES.cookingError,
    );
    reconnected.send(KITCHEN_MESSAGES.cookAction, {
      action: "MIX", actionSequence: 4,
    });
    await expect(replay).resolves.toMatchObject({ code: "REPLAYED_ACTION" });
    await waitFor(() =>
      (reconnectPrivateMessages.get(reconnected.sessionId)?.length ?? 0) === 1
    );
    expect(privateMessages.get(ready.blindCook.sessionId)).toEqual([]);
    expect(privateMessages.get(ready.deafGuide.sessionId)).toEqual([]);
  });

  test("grace expiry replacement resumes the same round without restart or recipe leakage", async () => {
    const ready = await createReadyRoom({
      roundDurationMs: 1_500,
      reconnectionGraceSeconds: 0.12,
    });
    const tomato = Array.from(ready.blindCook.state.objects.values()).find(
      ({ kind }) => kind === "TOMATO",
    )!;
    await pickUp(ready.blindCook, tomato.id);
    await sendCookUntilProgress(ready.blindCook, {
      action: "CHOP", actionSequence: 1, objectId: tomato.id,
    }, 1);
    await waitForState(ready.blindCook, (state) => state.remainingMs < 1_450);

    const dropped = ready.deafGuide;
    const releasedRole = dropped.state.players.get(dropped.sessionId)!.role;
    dropped.reconnection.enabled = false;
    dropped.connection.close();
    await waitForState(ready.blindCook, (state) => state.roundStatus === "PAUSED");
    const pausedRemaining = ready.blindCook.state.remainingMs;
    await waitForState(ready.blindCook, (state) => state.players.size === 2);
    await delay(100);
    expect(ready.blindCook.state).toMatchObject({
      status: "WAITING",
      roundStatus: "PAUSED",
      remainingMs: pausedRemaining,
      completedStepCount: 1,
      totalStepCount: 10,
    });

    const replacement = await new Client(running!.endpoint).joinById<KitchenRoomState>(
      ready.blindCook.roomId,
      { displayName: "Replacement" },
    );
    const replacementPrivateMessages = new Map<string, unknown[]>();
    capturePrivateMessages(replacement, replacementPrivateMessages);
    registerNoopHandlers(replacement);
    rooms.push(replacement);
    await waitForState(ready.blindCook, (state) => state.roundStatus === "RUNNING");
    expect(replacement.state.players.get(replacement.sessionId)?.role).toBe(releasedRole);
    expect(ready.blindCook.state).toMatchObject({
      status: "READY",
      roundStatus: "RUNNING",
      completedStepCount: 1,
      totalStepCount: 10,
    });
    expect(ready.blindCook.state.remainingMs).toBeLessThanOrEqual(pausedRemaining);
    expect(ready.blindCook.state.remainingMs).toBeGreaterThan(0);
    expect(ready.blindCook.state.objects.size).toBe(3);
    await waitForState(ready.blindCook, (state) => state.remainingMs < pausedRemaining);
    await delay(80);
    expect(replacementPrivateMessages.get(replacement.sessionId)).toEqual([]);
  });

  async function createReadyRoom(
    options: { roundDurationMs?: number; reconnectionGraceSeconds?: number } = {},
    privateMessages = new Map<string, unknown[]>(),
  ): Promise<{
    blindCook: ClientRoom<KitchenRoomState>;
    recipeKeeper: ClientRoom<KitchenRoomState>;
    deafGuide: ClientRoom<KitchenRoomState>;
  }> {
    running = await startKitchenServer({
      port: 0,
      placementSeed: "phase-4-seed",
      ...options,
    });
    const client = new Client(running.endpoint);
    const blindCook = await client.create<KitchenRoomState>(KITCHEN_ROOM_NAME, {
      displayName: "Blind Cook",
    });
    capturePrivateMessages(blindCook, privateMessages);
    const recipeKeeper = await client.joinById<KitchenRoomState>(blindCook.roomId, {
      displayName: "Recipe Keeper",
    });
    capturePrivateMessages(recipeKeeper, privateMessages);
    const deafGuide = await client.joinById<KitchenRoomState>(blindCook.roomId, {
      displayName: "Deaf Guide",
    });
    capturePrivateMessages(deafGuide, privateMessages);
    for (const room of [blindCook, recipeKeeper, deafGuide]) {
      registerNoopHandlers(room);
      rooms.push(room);
    }
    await waitForState(blindCook, (state) => state.status === "READY");
    return { blindCook, recipeKeeper, deafGuide };
  }
});

function registerNoopHandlers(room: ClientRoom<KitchenRoomState>): void {
  for (const type of [
    ...Object.values(COMMUNICATION_MESSAGES),
    KITCHEN_MESSAGES.interactionError,
    KITCHEN_MESSAGES.cookingError,
    KITCHEN_MESSAGES.privateRecipe,
  ]) room.onMessage(type, () => undefined);
}

function capturePrivateMessages(
  room: ClientRoom<KitchenRoomState>,
  messages: Map<string, unknown[]>,
): void {
  const received: unknown[] = [];
  messages.set(room.sessionId, received);
  room.onMessage(KITCHEN_MESSAGES.privateRecipe, (payload) => received.push(payload));
}

async function pickUp(room: ClientRoom<KitchenRoomState>, objectId: string): Promise<void> {
  room.send(KITCHEN_MESSAGES.pickUp, { objectId });
  await waitForState(room, (state) => state.objects.get(objectId)?.heldBy === room.sessionId);
}

async function drop(room: ClientRoom<KitchenRoomState>, objectId: string): Promise<void> {
  room.send(KITCHEN_MESSAGES.drop, { objectId, x: 50, y: 30 });
  await waitForState(room, (state) => state.objects.get(objectId)?.heldBy === "");
}

async function sendCookUntilProgress(
  room: ClientRoom<KitchenRoomState>,
  action: CookAction,
  progress: number,
): Promise<void> {
  room.send(KITCHEN_MESSAGES.cookAction, action);
  await waitForState(room, (state) => state.completedStepCount === progress);
}

async function sendCookExpectError(
  room: ClientRoom<KitchenRoomState>,
  action: CookAction,
  code: CookingErrorPayload["code"],
): Promise<void> {
  const error = nextMessage<CookingErrorPayload>(room, KITCHEN_MESSAGES.cookingError);
  room.send(KITCHEN_MESSAGES.cookAction, action);
  await expect(error).resolves.toMatchObject({ code });
}

async function sendPickUpExpectError(
  room: ClientRoom<KitchenRoomState>,
  objectId: string,
  code: InteractionErrorPayload["code"],
): Promise<void> {
  const error = nextMessage<InteractionErrorPayload>(room, KITCHEN_MESSAGES.interactionError);
  room.send(KITCHEN_MESSAGES.pickUp, { objectId });
  await expect(error).resolves.toMatchObject({ code });
}

function nextMessage<T>(
  room: ClientRoom<KitchenRoomState>,
  type: string,
  timeoutMs = 2_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
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
      if (predicate(state)) {
        clearTimeout(timeout);
        subscription.remove();
        resolve();
      }
    });
  });
}

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for condition"));
      }
    }, 10);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
