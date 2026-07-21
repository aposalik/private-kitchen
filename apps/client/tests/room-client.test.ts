// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import type {
  InteractionErrorPayload,
  KitchenRoomState,
} from "@cooking-game/shared";
import {
  RoomClient,
  type RoomClientRoom,
  type RoomClientStorage,
  type RoomClientTransport,
  type LobbySnapshot,
} from "../src/network/RoomClient.js";

describe("RoomClient lifecycle", () => {
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
  constructor(public token?: string) {}

  getItem(_key: string): string | null {
    return this.token ?? null;
  }

  setItem(_key: string, value: string): void {
    this.token = value;
  }

  removeItem(_key: string): void {
    this.token = undefined;
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

  constructor(
    readonly sessionId: string,
    public reconnectionToken: string,
  ) {}

  onStateChange(listener: () => void): void {
    this.stateListeners.push(listener);
  }

  onMessage(
    _type: string,
    _listener: (payload: InteractionErrorPayload) => void,
  ): () => void {
    return () => undefined;
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

  send(_type: string, _payload: unknown): void {}

  leave(): Promise<number> {
    return Promise.resolve(1000);
  }

  setAuthoritativePlayer(): void {
    this.state = {
      ...stateWithoutPlayers(),
      players: new Map([
        [
          this.sessionId,
          {
            id: this.sessionId,
            displayName: "Player",
            role: "BLIND_COOK",
            connected: true,
          },
        ],
      ]),
      connectedCount: 1,
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
}

function stateWithoutPlayers(): KitchenRoomState {
  return {
    players: new Map(),
    objects: new Map(),
    placementSeed: "test-seed",
    connectedCount: 0,
    status: "WAITING",
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
