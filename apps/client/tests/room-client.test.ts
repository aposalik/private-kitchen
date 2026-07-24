// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import type {
  CommunicationEvent,
  DrawingSnapshot,
  DrawingStroke,
  InteractionErrorPayload,
  KitchenRoomState,
  PrivateRecipePayload,
  VoiceRelayEnvelope,
} from "@cooking-game/shared";
import { MAX_ACTION_SEQUENCE, MAX_COOKING_ERROR_MESSAGE_LENGTH } from "@cooking-game/shared";
import { SENDONLY_AUDIO_OFFER_SDP } from "../../../tests/fixtures/voice-sdp.js";
import {
  RoomClient,
  type RoomClientRoom,
  type RoomClientStorage,
  type RoomClientTransport,
  type LobbySnapshot,
} from "../src/network/RoomClient.js";

describe("RoomClient lifecycle", () => {
  test("replicates authoritative round progress and object preparation/location without deriving state", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("round-session", "token");
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const snapshots = observe(client);

    const connecting = client.create("Round Player");
    await Promise.resolve();
    room.setAuthoritativePlayer("BLIND_COOK", {
      roundStatus: "PAUSED",
      remainingMs: 123_456,
      completedStepCount: 4,
      totalStepCount: 9,
      outcomeReason: "NONE",
      objects: new Map([
        [
          "tomato-1",
          {
            id: "tomato-1",
            kind: "TOMATO",
            label: "Tomato",
            x: 12,
            y: 34,
            preparation: "CHOPPED",
            location: "POT",
          },
        ],
      ]),
    });
    await connecting;

    expect(snapshots.at(-1)).toMatchObject({
      roundStatus: "PAUSED",
      remainingMs: 123_456,
      completedStepCount: 4,
      totalStepCount: 9,
      outcomeReason: "NONE",
      objects: [
        expect.objectContaining({
          id: "tomato-1",
          preparation: "CHOPPED",
          location: "POT",
        }),
      ],
    });

    room.state = { ...room.state, roundStatus: "LOST", remainingMs: 777, outcomeReason: "TIME_EXPIRED" };
    room.emitState();
    expect(snapshots.at(-1)).toMatchObject({
      roundStatus: "LOST",
      remainingMs: 777,
      outcomeReason: "TIME_EXPIRED",
    });
  });

  test("a matchmaking failure before receiving a room preserves the existing token", async () => {
    const transport = new FakeTransport();
    transport.joinById.mockRejectedValue(new Error("Matchmaking failed"));
    const storage = new FakeStorage("pre-existing-token");
    const client = new RoomClient({ transport, storage });
    const snapshots = observe(client);

    await expect(client.join("ROOM", "Joining Player")).rejects.toThrow(
      "Matchmaking failed",
    );

    expect(storage.token).toBe("pre-existing-token");
    expect(snapshots.at(-1)).toEqual({ connectionStatus: "DISCONNECTED" });
  });

  test("a manual operation cannot race an in-flight resume", async () => {
    const reconnect = deferred<RoomClientRoom>();
    const transport = new FakeTransport();
    transport.reconnect.mockImplementation(() => reconnect.promise);
    const storage = new FakeStorage("resume-token");
    const client = new RoomClient({ transport, storage });
    const snapshots = observe(client);

    const resuming = client.resume();
    await client.create("Manual Player");

    expect(transport.reconnect).toHaveBeenCalledTimes(1);
    expect(transport.create).not.toHaveBeenCalled();
    expect(storage.token).toBe("resume-token");
    expect(snapshots.at(-1)?.connectionStatus).toBe("RECONNECTING");

    const room = new FakeRoom("session-resume", "fresh-resume-token");
    reconnect.resolve(room);
    await Promise.resolve();
    expect(await promiseSettled(resuming)).toBe(false);

    room.setAuthoritativePlayer();
    await expect(resuming).resolves.toBe(true);
    expect(storage.token).toBe("fresh-resume-token");
    expect(snapshots.at(-1)?.connectionStatus).toBe("CONNECTED");
  });

  test("repeated operations while connected are no-ops and preserve ownership", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("session-one", "owned-token");
    transport.create.mockResolvedValue(room);
    const storage = new FakeStorage();
    const client = new RoomClient({ transport, storage });

    const connecting = client.create("Player One");
    await Promise.resolve();
    room.setAuthoritativePlayer();
    await connecting;

    await client.create("Player Two");
    await client.join("OTHER", "Player Two");
    await expect(client.resume()).resolves.toBe(false);

    expect(transport.create).toHaveBeenCalledTimes(1);
    expect(transport.joinById).not.toHaveBeenCalled();
    expect(transport.reconnect).not.toHaveBeenCalled();
    expect(storage.token).toBe("owned-token");
  });

  test("stale callbacks cannot clear or overwrite the current room and token", async () => {
    const transport = new FakeTransport();
    const oldRoom = new FakeRoom("old-session", "old-token");
    const currentRoom = new FakeRoom("current-session", "current-token");
    transport.create.mockResolvedValueOnce(oldRoom).mockResolvedValueOnce(currentRoom);
    const storage = new FakeStorage();
    const client = new RoomClient({ transport, storage });
    const snapshots = observe(client);

    const first = client.create("Old Player");
    await Promise.resolve();
    oldRoom.setAuthoritativePlayer();
    await first;
    oldRoom.emitLeave();

    const second = client.create("Current Player");
    await Promise.resolve();
    currentRoom.setAuthoritativePlayer();
    await second;
    oldRoom.emitState();
    oldRoom.emitDrop();
    oldRoom.emitReconnect();
    oldRoom.emitError();
    oldRoom.emitLeave();

    expect(storage.token).toBe("current-token");
    expect(snapshots.at(-1)).toMatchObject({
      connectionStatus: "CONNECTED",
      roomId: currentRoom.roomId,
    });
  });

  test("automatic reconnect persists the rotated reconnection token", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("session-one", "initial-token");
    transport.create.mockResolvedValue(room);
    const storage = new FakeStorage();
    const client = new RoomClient({ transport, storage });

    const connecting = client.create("Player One");
    await Promise.resolve();
    room.setAuthoritativePlayer();
    await connecting;

    room.reconnectionToken = "rotated-token";
    room.emitReconnect();

    expect(storage.token).toBe("rotated-token");
  });

  test("sends six exact finite cooking commands with a separately persisted monotonic sequence", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("cook-session", "token");
    const storage = new FakeStorage();
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage });
    const connecting = client.create("Cook");
    await Promise.resolve();
    room.setAuthoritativePlayer("BLIND_COOK");
    await connecting;

    room.sendObserver = (type, payload) => {
      if (type === "COOK_ACTION") {
        expect(storage.cookingSequence).toBe(String((payload as { actionSequence: number }).actionSequence));
      }
    };
    client.chop("tomato-1");
    client.addToPot("tomato-1");
    client.season();
    client.boil();
    client.mix();
    client.plate();

    expect(room.sent.filter(([type]) => type === "COOK_ACTION")).toEqual([
      ["COOK_ACTION", { action: "CHOP", actionSequence: 1, objectId: "tomato-1" }],
      ["COOK_ACTION", { action: "ADD_TO_POT", actionSequence: 2, objectId: "tomato-1" }],
      ["COOK_ACTION", { action: "SEASON", actionSequence: 3 }],
      ["COOK_ACTION", { action: "BOIL", actionSequence: 4 }],
      ["COOK_ACTION", { action: "MIX", actionSequence: 5 }],
      ["COOK_ACTION", { action: "PLATE", actionSequence: 6 }],
    ]);
    expect(storage.cookingSequence).toBe("6");

    room.emitDrop();
    room.emitReconnect();
    client.mix();
    expect(room.sent.filter(([type]) => type === "COOK_ACTION").at(-1)).toEqual([
      "COOK_ACTION",
      { action: "MIX", actionSequence: 7 },
    ]);
  });

  test.each(["create", "join"] as const)("fresh %s resets cooking and communication sequences", async (operation) => {
    const transport = new FakeTransport();
    const room = new FakeRoom(`fresh-${operation}`, "fresh-token");
    const storage = new FakeStorage("old-token", "41", "37");
    transport[operation === "create" ? "create" : "joinById"].mockResolvedValue(room);
    const client = new RoomClient({ transport, storage });

    const connecting = operation === "create" ? client.create("Fresh") : client.join("ROOM", "Fresh");
    expect(storage.cookingSequence).toBeUndefined();
    expect(storage.communicationSequence).toBeUndefined();
    await Promise.resolve();
    room.setAuthoritativePlayer();
    await connecting;
    client.season();
    client.sendGesture("NOD");

    expect(room.sent.filter(([type]) => type === "COOK_ACTION")).toEqual([
      ["COOK_ACTION", { action: "SEASON", actionSequence: 1 }],
    ]);
    expect(room.sent.filter(([type]) => type === "COMMUNICATION_SIGNAL")).toEqual([
      ["COMMUNICATION_SIGNAL", { clientSequence: 1, kind: "GESTURE", gesture: "NOD" }],
    ]);
  });

  test("explicit resume in a new client strictly loads and continues the persisted cooking sequence", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("resumed-cook", "rotated-token");
    const storage = new FakeStorage("resume-token", "7");
    transport.reconnect.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage });

    const resuming = client.resume();
    await Promise.resolve();
    room.setAuthoritativePlayer();
    await expect(resuming).resolves.toBe(true);
    client.chop("onion-1");

    expect(room.sent.filter(([type]) => type === "COOK_ACTION")).toEqual([
      ["COOK_ACTION", { action: "CHOP", actionSequence: 8, objectId: "onion-1" }],
    ]);
    expect(storage.cookingSequence).toBe("8");
  });

  test.each(["01", "-1", "1.5", String(MAX_ACTION_SEQUENCE + 1), "not-an-integer"])(
    "falls back to zero for invalid stored cooking sequence %s",
    async (storedSequence) => {
      const transport = new FakeTransport();
      const room = new FakeRoom("strict-sequence", "token");
      const storage = new FakeStorage("resume-token", storedSequence);
      transport.reconnect.mockResolvedValue(room);
      const client = new RoomClient({ transport, storage });
      const resuming = client.resume();
      await Promise.resolve();
      room.setAuthoritativePlayer();
      await resuming;
      client.boil();
      expect(room.sent.filter(([type]) => type === "COOK_ACTION").at(-1)).toEqual([
        "COOK_ACTION",
        { action: "BOIL", actionSequence: 1 },
      ]);
    },
  );

  test("failed explicit reconnect clears persisted reconnection and action sequences", async () => {
    const transport = new FakeTransport();
    const storage = new FakeStorage("resume-token", "9", "8");
    transport.reconnect.mockRejectedValue(new Error("expired"));
    const client = new RoomClient({ transport, storage });

    await expect(client.resume()).resolves.toBe(false);

    expect(storage.token).toBeUndefined();
    expect(storage.cookingSequence).toBeUndefined();
    expect(storage.communicationSequence).toBeUndefined();
  });

  test("explicit resume in a new client continues the persisted communication sequence", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("resumed-communication", "rotated-token");
    const storage = new FakeStorage("resume-token", undefined, "6");
    transport.reconnect.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage });

    const resuming = client.resume();
    await Promise.resolve();
    room.setAuthoritativePlayer("RECIPE_KEEPER");
    await expect(resuming).resolves.toBe(true);
    client.sendGesture("NOD");

    expect(room.sent.filter(([type]) => type === "COMMUNICATION_SIGNAL")).toEqual([
      ["COMMUNICATION_SIGNAL", { clientSequence: 7, kind: "GESTURE", gesture: "NOD" }],
    ]);
    expect(storage.communicationSequence).toBe("7");
  });

  test("accepts strict private recipe only for the current authoritative Recipe Keeper and deep-clones snapshots", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("recipe-private", "token");
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const snapshots = observe(client);
    const connecting = client.create("Keeper");
    await Promise.resolve();
    room.setAuthoritativePlayer("RECIPE_KEEPER");
    await connecting;

    const payload = privateRecipe();
    room.emitMessage("PRIVATE_RECIPE", payload);
    expect(snapshots.at(-1)?.privateRecipe).toEqual(payload);

    const exposed = snapshots.at(-1)?.privateRecipe;
    expect(exposed).toBeDefined();
    (exposed!.ingredients as Array<{ kind: "TOMATO"; count: number }>)[0]!.count = 99;
    (exposed!.steps as Array<{ action: string }>)[0]!.action = "PLATE";
    room.emitState();
    expect(snapshots.at(-1)?.privateRecipe).toEqual(payload);

    room.emitMessage("PRIVATE_RECIPE", {
      ...privateRecipe(),
      ingredients: [{ kind: "TOMATO", count: 9 }],
      extra: true,
    });
    room.emitMessage("PRIVATE_RECIPE", {
      ...privateRecipe(),
      ingredients: [{ kind: "TOMATO", count: 9, extra: true }],
    });
    expect(snapshots.at(-1)?.privateRecipe).toEqual(payload);

    room.setAuthoritativePlayer("BLIND_COOK");
    expect(snapshots.at(-1)?.privateRecipe).toBeUndefined();
    room.setAuthoritativePlayer("RECIPE_KEEPER");
    expect(snapshots.at(-1)?.privateRecipe).toBeUndefined();
  });

  test.each(["BLIND_COOK", "DEAF_KITCHEN_GUIDE"] as const)(
    "never accepts private recipe for %s",
    async (role) => {
      const transport = new FakeTransport();
      const room = new FakeRoom(`private-${role}`, "token");
      transport.create.mockResolvedValue(room);
      const client = new RoomClient({ transport, storage: new FakeStorage() });
      const snapshots = observe(client);
      const connecting = client.create("Not Keeper");
      await Promise.resolve();
      room.setAuthoritativePlayer(role);
      await connecting;
      room.emitMessage("PRIVATE_RECIPE", privateRecipe());
      expect(snapshots.at(-1)?.privateRecipe).toBeUndefined();
    },
  );

  test("does not retain a private recipe received before the authoritative local role exists", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("late-role", "token");
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const snapshots = observe(client);
    const connecting = client.create("Late Keeper");
    await Promise.resolve();
    room.emitMessage("PRIVATE_RECIPE", privateRecipe());
    room.setAuthoritativePlayer("RECIPE_KEEPER");
    await connecting;
    expect(snapshots.at(-1)?.privateRecipe).toBeUndefined();
  });

  test("exposes only the sanitized message from an exact valid cooking error and drops malformed payloads", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("cooking-error", "token");
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const snapshots = observe(client);
    const connecting = client.create("Cook");
    await Promise.resolve();
    room.setAuthoritativePlayer("BLIND_COOK");
    await connecting;

    room.emitMessage("COOKING_ERROR", { code: "OUT_OF_ORDER", message: "Chop the ingredient first" });
    expect(snapshots.at(-1)?.cookingError).toBe("Chop the ingredient first");

    for (const malformed of [
      { code: "OUT_OF_ORDER", message: "forged", extra: true },
      { code: "FREE_TEXT", message: "forged" },
      { code: "OUT_OF_ORDER", message: "" },
      { code: "OUT_OF_ORDER", message: "x".repeat(MAX_COOKING_ERROR_MESSAGE_LENGTH + 1) },
      Object.assign(Object.create({ code: "OUT_OF_ORDER" }), { message: "forged" }),
    ]) room.emitMessage("COOKING_ERROR", malformed);

    expect(snapshots.at(-1)?.cookingError).toBe("Chop the ingredient first");
    expect(snapshots.at(-1)).not.toHaveProperty("cookingErrorCode");
  });

  test("clears cooking error and persists sequence before sending the next cooking command", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("clear-error", "token");
    const storage = new FakeStorage();
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage });
    const snapshots = observe(client);
    const connecting = client.create("Cook");
    await Promise.resolve();
    room.setAuthoritativePlayer("BLIND_COOK");
    await connecting;
    room.emitMessage("COOKING_ERROR", { code: "OUT_OF_ORDER", message: "Wrong order" });

    room.sendObserver = (type) => {
      if (type !== "COOK_ACTION") return;
      expect(storage.cookingSequence).toBe("1");
      expect(snapshots.at(-1)?.cookingError).toBeUndefined();
    };
    client.season();
    expect(snapshots.at(-1)?.cookingError).toBeUndefined();
  });

  test("clears private recipe and cooking error across permanent disconnect/new attach and ignores stale callbacks", async () => {
    const transport = new FakeTransport();
    const oldRoom = new FakeRoom("old-private", "old-token");
    const currentRoom = new FakeRoom("current-private", "current-token");
    transport.create.mockResolvedValueOnce(oldRoom).mockResolvedValueOnce(currentRoom);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const snapshots = observe(client);

    const first = client.create("Old Keeper");
    await Promise.resolve();
    oldRoom.setAuthoritativePlayer("RECIPE_KEEPER");
    await first;
    oldRoom.emitMessage("PRIVATE_RECIPE", privateRecipe());
    oldRoom.emitMessage("COOKING_ERROR", { code: "OUT_OF_ORDER", message: "Old error" });
    expect(snapshots.at(-1)).toMatchObject({ privateRecipe: privateRecipe(), cookingError: "Old error" });
    oldRoom.emitLeave();
    expect(snapshots.at(-1)).toEqual({ connectionStatus: "DISCONNECTED" });

    const second = client.create("Current Keeper");
    await Promise.resolve();
    currentRoom.setAuthoritativePlayer("RECIPE_KEEPER");
    await second;
    expect(snapshots.at(-1)?.privateRecipe).toBeUndefined();
    expect(snapshots.at(-1)?.cookingError).toBeUndefined();

    oldRoom.emitMessage("PRIVATE_RECIPE", privateRecipe());
    oldRoom.emitMessage("COOKING_ERROR", { code: "OUT_OF_ORDER", message: "Stale error" });
    expect(snapshots.at(-1)?.roomId).toBe(currentRoom.roomId);
    expect(snapshots.at(-1)?.privateRecipe).toBeUndefined();
    expect(snapshots.at(-1)?.cookingError).toBeUndefined();
  });

  test("sends constrained communication actions with one monotonic client sequence", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("recipe-session", "token");
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const connecting = client.create("Recipe");
    await Promise.resolve();
    room.setAuthoritativePlayer("RECIPE_KEEPER");
    await connecting;

    client.sendGesture("NOD");
    client.sendEmote("READY");
    client.sendRecipeCard("CHOP");
    client.sendDrawingStroke("RED", "THIN", [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    client.clearDrawing();
    client.sendVoiceSignal({ kind: "OFFER", targetId: "receiver", sdp: SENDONLY_AUDIO_OFFER_SDP });

    expect(room.sent).toEqual([
      ["COMMUNICATION_READY", {}],
      ["ROUND_READY", {}],
      ["COMMUNICATION_SIGNAL", { clientSequence: 1, kind: "GESTURE", gesture: "NOD" }],
      ["COMMUNICATION_SIGNAL", { clientSequence: 2, kind: "EMOTE", emote: "READY" }],
      ["RECIPE_CARD", { clientSequence: 3, card: "CHOP" }],
      ["DRAWING_STROKE", { clientSequence: 4, color: "RED", width: "THIN", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      ["DRAWING_CLEAR", { clientSequence: 5 }],
      ["VOICE_SIGNAL", { clientSequence: 6, kind: "OFFER", targetId: "receiver", sdp: SENDONLY_AUDIO_OFFER_SDP }],
    ]);
  });

  test("sends exact finite pointing payloads and drops invalid coordinate/object targets", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("pointer-session", "token");
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const connecting = client.create("Pointer");
    await Promise.resolve();
    room.setAuthoritativePlayer("DEAF_KITCHEN_GUIDE");
    await connecting;

    client.pointAtObject("ingredient-1");
    client.pointAtLocation(50, 30);
    client.pointAtObject("");
    client.pointAtLocation(Number.NaN, 30);
    client.pointAtLocation(10_000, 30);

    expect(room.sent).toEqual([
      ["COMMUNICATION_READY", {}],
      ["ROUND_READY", {}],
      ["COMMUNICATION_SIGNAL", { clientSequence: 1, kind: "POINT", target: { kind: "OBJECT", objectId: "ingredient-1" } }],
      ["COMMUNICATION_SIGNAL", { clientSequence: 2, kind: "POINT", target: { kind: "COORDINATE", x: 50, y: 30 } }],
    ]);
  });

  test("accepts an exact READY relay and rejects unknown relay fields", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("deaf-session", "token");
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const connecting = client.create("Deaf");
    await Promise.resolve();
    room.setAuthoritativePlayer("DEAF_KITCHEN_GUIDE");
    await connecting;
    const relays: VoiceRelayEnvelope[] = [];
    client.subscribeVoice((relay) => relays.push(relay));
    const ready = { kind: "READY", senderId: "recipe", senderRole: "RECIPE_KEEPER", sequence: 1, timestamp: 10 } as const;
    room.emitMessage("VOICE_RELAY", ready);
    room.emitMessage("VOICE_RELAY", { ...ready, sequence: 2, offerId: "forged" });
    expect(relays).toEqual([ready]);
  });

  test("attaches private/error listeners before exact bootstraps and repeats them after reconnect", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("session", "token");
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const connecting = client.create("Player");
    await Promise.resolve();
    room.setAuthoritativePlayer();
    await connecting;

    const firstSend = room.timeline.indexOf("send:COMMUNICATION_READY");
    expect(room.timeline.indexOf("listen:PRIVATE_RECIPE")).toBeGreaterThanOrEqual(0);
    expect(room.timeline.indexOf("listen:COOKING_ERROR")).toBeGreaterThanOrEqual(0);
    expect(firstSend).toBeGreaterThan(room.timeline.lastIndexOf("listen:VOICE_RELAY"));
    expect(firstSend).toBeGreaterThan(room.timeline.indexOf("listen:PRIVATE_RECIPE"));
    expect(firstSend).toBeGreaterThan(room.timeline.indexOf("listen:COOKING_ERROR"));
    expect(room.sent.filter(([type]) => type === "COMMUNICATION_READY")).toEqual([["COMMUNICATION_READY", {}]]);
    expect(room.sent.filter(([type]) => type === "ROUND_READY")).toEqual([["ROUND_READY", {}]]);
    room.emitDrop();
    room.emitReconnect();
    expect(room.sent.filter(([type]) => type === "COMMUNICATION_READY")).toHaveLength(2);
    expect(room.sent.filter(([type]) => type === "ROUND_READY")).toEqual([
      ["ROUND_READY", {}],
      ["ROUND_READY", {}],
    ]);
  });

  test("strictly rejects malformed bounded voice relays and accepts exact DISABLED", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("session", "token");
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const connecting = client.create("Player");
    await Promise.resolve();
    room.setAuthoritativePlayer();
    await connecting;
    const relays: VoiceRelayEnvelope[] = [];
    client.subscribeVoice((relay) => relays.push(relay));
    const base = { senderId: "peer", senderRole: "RECIPE_KEEPER", sequence: 1, timestamp: 1 } as const;
    const disabled = { ...base, kind: "DISABLED" } as const;
    room.emitMessage("VOICE_RELAY", disabled);
    for (const malformed of [
      { ...disabled, extra: true },
      { ...base, kind: "OFFER", offerId: "offer", sdp: "" },
      { ...base, kind: "OFFER", offerId: "offer", sdp: "x".repeat(16_385) },
      { ...base, kind: "ICE", offerId: "offer", candidate: "x".repeat(2_049) },
      { ...base, kind: "ICE", offerId: "offer", candidate: "candidate", sdpMid: 3 },
      { ...base, kind: "ICE", offerId: "offer", candidate: "candidate", sdpMid: "x".repeat(65) },
      { ...base, kind: "ICE", offerId: "offer", candidate: "candidate", sdpMLineIndex: -1 },
      { ...base, kind: "ICE", offerId: "offer", candidate: "candidate", sdpMLineIndex: 65_536 },
      { ...base, kind: "ICE", offerId: "offer", candidate: "candidate", unknown: null },
      { ...base, kind: "READY", senderId: "" },
      { ...base, kind: "READY", sequence: Number.MAX_SAFE_INTEGER + 1 },
      { ...base, kind: "READY", timestamp: Number.NaN },
    ]) room.emitMessage("VOICE_RELAY", malformed);
    expect(relays).toEqual([disabled]);
  });

  test("accepts exact authoritative grants and visual payloads only for visual roles", async () => {
    const transport = new FakeTransport();
    const deafRoom = new FakeRoom("deaf-session", "token");
    transport.create.mockResolvedValue(deafRoom);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const snapshots = observe(client);
    const connecting = client.create("Deaf");
    await Promise.resolve();
    deafRoom.setAuthoritativePlayer("DEAF_KITCHEN_GUIDE");
    await connecting;

    deafRoom.emitMessage("VOICE_GRANT", { canPublish: false, canReceive: false });
    deafRoom.emitMessage("COMMUNICATION_EVENT", { kind: "RECIPE_CARD", card: "CHOP", senderId: "recipe", senderRole: "RECIPE_KEEPER", sequence: 1, timestamp: 10 } satisfies CommunicationEvent);
    deafRoom.emitMessage("DRAWING_SNAPSHOT", { strokes: [] } satisfies DrawingSnapshot);
    expect(snapshots.at(-1)).toMatchObject({ voiceGrant: { canPublish: false, canReceive: false } });
    expect(snapshots.at(-1)?.communicationFeed).toHaveLength(1);

    deafRoom.emitMessage("VOICE_GRANT", { canPublish: true, canReceive: false, forged: true });
    deafRoom.emitMessage("COMMUNICATION_EVENT", { kind: "RECIPE_CARD", card: "<img onerror=evil>", senderId: "evil", senderRole: "RECIPE_KEEPER", sequence: 2, timestamp: 11 });
    expect(snapshots.at(-1)?.voiceGrant).toEqual({ canPublish: false, canReceive: false });
    expect(snapshots.at(-1)?.communicationFeed).toHaveLength(1);
  });

  test("Blind Cook drops all visual event, stroke, and snapshot payloads", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("blind-session", "token");
    transport.create.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const snapshots = observe(client);
    const connecting = client.create("Blind");
    await Promise.resolve();
    room.setAuthoritativePlayer("BLIND_COOK");
    await connecting;
    room.emitMessage("COMMUNICATION_EVENT", { kind: "RECIPE_CARD", card: "CHOP", senderId: "recipe", senderRole: "RECIPE_KEEPER", sequence: 1, timestamp: 10 });
    room.emitMessage("DRAWING_STROKE", { id: "stroke", color: "RED", width: "THIN", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], senderId: "recipe", senderRole: "RECIPE_KEEPER", sequence: 2, timestamp: 11 } satisfies DrawingStroke);
    room.emitMessage("DRAWING_SNAPSHOT", { strokes: [] });
    expect(snapshots.at(-1)?.communicationFeed).toBeUndefined();
    expect(snapshots.at(-1)?.drawingStrokes).toBeUndefined();
  });

  test("does not resolve or report CONNECTED until state contains this session", async () => {
    const transport = new FakeTransport();
    const room = new FakeRoom("joining-session", "joining-token");
    transport.joinById.mockResolvedValue(room);
    const client = new RoomClient({ transport, storage: new FakeStorage() });
    const snapshots = observe(client);

    const joining = client.join("ROOM", "Joining Player");
    await Promise.resolve();
    room.emitState();

    expect(await promiseSettled(joining)).toBe(false);
    expect(snapshots.some(({ connectionStatus }) => connectionStatus === "CONNECTED")).toBe(false);

    room.setAuthoritativePlayer();
    await expect(joining).resolves.toBeUndefined();
    expect(snapshots.at(-1)).toMatchObject({
      connectionStatus: "CONNECTED",
      role: "BLIND_COOK",
    });
  });

  test.each(["leave", "error"] as const)(
    "%s before initial authoritative state rejects without hanging",
    async (event) => {
      const transport = new FakeTransport();
      const room = new FakeRoom("joining-session", "joining-token");
      transport.create.mockResolvedValue(room);
      const storage = new FakeStorage("previous-token");
      const client = new RoomClient({ transport, storage });
      const snapshots = observe(client);

      const connecting = client.create("Joining Player");
      await Promise.resolve();
      if (event === "leave") {
        room.emitLeave();
      } else {
        room.emitError();
      }

      await expect(connecting).rejects.toThrow();
      expect(storage.token).toBeUndefined();
      expect(snapshots.at(-1)?.connectionStatus).toBe("DISCONNECTED");
    },
  );
});

class FakeTransport implements RoomClientTransport {
  create = vi.fn((_roomName: string, _options: { displayName: string }) =>
    Promise.reject<RoomClientRoom>(new Error("Unexpected create")),
  );
  joinById = vi.fn((_roomId: string, _options: { displayName: string }) =>
    Promise.reject<RoomClientRoom>(new Error("Unexpected join")),
  );
  reconnect = vi.fn((_token: string) =>
    Promise.reject<RoomClientRoom>(new Error("Unexpected reconnect")),
  );
}

class FakeStorage implements RoomClientStorage {
  private readonly values = new Map<string, string>();

  constructor(token?: string, cookingSequence?: string, communicationSequence?: string) {
    if (token !== undefined) this.values.set("kitchen.reconnectionToken", token);
    if (cookingSequence !== undefined) this.values.set("kitchen.cookingActionSequence", cookingSequence);
    if (communicationSequence !== undefined) this.values.set("kitchen.communicationSequence", communicationSequence);
  }

  get token(): string | undefined { return this.values.get("kitchen.reconnectionToken"); }
  set token(value: string | undefined) {
    if (value === undefined) this.values.delete("kitchen.reconnectionToken");
    else this.values.set("kitchen.reconnectionToken", value);
  }

  get cookingSequence(): string | undefined { return this.values.get("kitchen.cookingActionSequence"); }
  get communicationSequence(): string | undefined { return this.values.get("kitchen.communicationSequence"); }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FakeRoom implements RoomClientRoom {
  readonly roomId = `room-${this.sessionId}`;
  readonly reconnection = { isReconnecting: false };
  state: KitchenRoomState = stateWithoutPlayers();
  private readonly stateListeners: Array<() => void> = [];
  private readonly dropListeners: Array<() => void> = [];
  private readonly reconnectListeners: Array<() => void> = [];
  private readonly leaveListeners: Array<() => void> = [];
  private readonly errorListeners: Array<() => void> = [];
  private readonly messageListeners = new Map<string, Array<(payload: unknown) => void>>();
  readonly sent: Array<[string, unknown]> = [];
  readonly timeline: string[] = [];
  sendObserver?: (type: string, payload: unknown) => void;

  constructor(
    readonly sessionId: string,
    public reconnectionToken: string,
  ) {}

  onStateChange(listener: () => void): void {
    this.stateListeners.push(listener);
  }

  onMessage(
    type: string,
    listener: (payload: InteractionErrorPayload) => void,
  ): () => void {
    this.timeline.push(`listen:${type}`);
    const listeners = this.messageListeners.get(type) ?? [];
    listeners.push(listener as (payload: unknown) => void);
    this.messageListeners.set(type, listeners);
    return () => this.messageListeners.set(type, listeners.filter((entry) => entry !== listener));
  }

  onDrop(listener: () => void): void {
    this.dropListeners.push(listener);
  }

  onReconnect(listener: () => void): void {
    this.reconnectListeners.push(listener);
  }

  onLeave(listener: () => void): void {
    this.leaveListeners.push(listener);
  }

  onError(listener: () => void): void {
    this.errorListeners.push(listener);
  }

  send(type: string, payload: unknown): void {
    this.sendObserver?.(type, payload);
    this.timeline.push(`send:${type}`);
    this.sent.push([type, payload]);
  }

  leave(): Promise<number> {
    return Promise.resolve(1000);
  }

  setAuthoritativePlayer(
    role: "BLIND_COOK" | "RECIPE_KEEPER" | "DEAF_KITCHEN_GUIDE" = "BLIND_COOK",
    state: Partial<KitchenRoomState> = {},
  ): void {
    this.state = {
      ...stateWithoutPlayers(),
      players: new Map([
        [
          this.sessionId,
          {
            id: this.sessionId,
            displayName: "Player",
            role,
            connected: true,
          },
        ],
      ]),
      connectedCount: 1,
      status: "READY",
      ...state,
    };
    this.emitState();
  }

  emitState(): void {
    this.stateListeners.forEach((listener) => listener());
  }

  emitDrop(): void {
    this.dropListeners.forEach((listener) => listener());
  }

  emitReconnect(): void {
    this.reconnectListeners.forEach((listener) => listener());
  }

  emitLeave(): void {
    this.leaveListeners.forEach((listener) => listener());
  }

  emitError(): void {
    this.errorListeners.forEach((listener) => listener());
  }

  emitMessage(type: string, payload: unknown): void {
    this.messageListeners.get(type)?.forEach((listener) => listener(payload));
  }
}

function stateWithoutPlayers(): KitchenRoomState {
  return {
    players: new Map(),
    objects: new Map(),
    placementSeed: "test-seed",
    connectedCount: 0,
    status: "WAITING",
    roundStatus: "NOT_STARTED",
    remainingMs: 0,
    completedStepCount: 0,
    totalStepCount: 0,
    outcomeReason: "NONE",
  };
}

function observe(client: RoomClient): LobbySnapshot[] {
  const snapshots: LobbySnapshot[] = [];
  client.subscribe((snapshot) => snapshots.push(snapshot));
  return snapshots;
}

async function promiseSettled(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol("pending");
  return Promise.race([promise.then(() => true, () => true), Promise.resolve(marker)]).then(
    (result) => result !== marker,
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function privateRecipe(): PrivateRecipePayload {
  return {
    id: "tomato-soup",
    title: "Tomato Soup",
    ingredients: [
      { kind: "TOMATO", count: 2 },
      { kind: "ONION", count: 1 },
    ],
    steps: [
      { action: "CHOP", ingredientKind: "TOMATO" },
      { action: "ADD_TO_POT", ingredientKind: "TOMATO" },
      { action: "SEASON" },
      { action: "BOIL" },
      { action: "MIX" },
      { action: "PLATE" },
    ],
  };
}
