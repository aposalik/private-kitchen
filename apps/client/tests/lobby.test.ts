// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  LobbyConnection,
  LobbySnapshot,
} from "../src/network/RoomClient.js";
import { Lobby } from "../src/ui/Lobby.js";

describe("Lobby", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  test("an explicit invite joins directly instead of resuming another room", async () => {
    window.history.replaceState({}, "", "/?room=INVITE123&player=Invited%20Player");
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);

    new Lobby(root, connection).mount();

    await vi.waitFor(() =>
      expect(connection.join).toHaveBeenCalledWith("INVITE123", "Invited Player"),
    );
    expect(connection.resume).not.toHaveBeenCalled();
  });

  test("an invite without a player name waits instead of resuming another room", () => {
    window.history.replaceState({}, "", "/?room=INVITE123");
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);

    new Lobby(root, connection).mount();

    expect(connection.resume).not.toHaveBeenCalled();
    expect(connection.join).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLInputElement>("[name=roomId]")!.value).toBe(
      "INVITE123",
    );
    expect(actionButtons(root).every((button) => button.disabled)).toBe(false);
  });

  test("disables create and join during initial resume", async () => {
    const resume = deferred<boolean>();
    const connection = new FakeConnection();
    connection.resume.mockImplementation(() => resume.promise);
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    expect(actionButtons(root).every((button) => button.disabled)).toBe(true);

    resume.resolve(false);
    await vi.waitFor(() =>
      expect(actionButtons(root).every((button) => button.disabled)).toBe(false),
    );
  });

  test.each(["CONNECTING", "RECONNECTING", "CONNECTED"] as const)(
    "keeps actions disabled while the connection is %s",
    async (connectionStatus) => {
      const attempt = deferred<void>();
      const connection = new FakeConnection();
      connection.create.mockImplementation(() => attempt.promise);
      const root = document.createElement("main");
      document.body.replaceChildren(root);
      new Lobby(root, connection).mount();
      await vi.waitFor(() => expect(connection.resume).toHaveBeenCalled());

      const name = root.querySelector<HTMLInputElement>("[name=displayName]")!;
      name.value = "Player One";
      root.querySelector<HTMLButtonElement>("[data-action=create]")!.click();
      connection.emit({ connectionStatus });
      attempt.resolve();

      await vi.waitFor(() => expect(connection.create).toHaveBeenCalled());
      expect(actionButtons(root).every((button) => button.disabled)).toBe(true);

      connection.emit({ connectionStatus: "DISCONNECTED" });
      expect(actionButtons(root).every((button) => button.disabled)).toBe(false);
    },
  );

  test("creates a room and renders authoritative connection state", async () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    await vi.waitFor(() =>
      expect(actionButtons(root).every((button) => button.disabled)).toBe(false),
    );

    const name = root.querySelector<HTMLInputElement>("[name=displayName]")!;
    name.value = "Player One";
    root.querySelector<HTMLButtonElement>("[data-action=create]")!.click();
    await vi.waitFor(() => expect(connection.create).toHaveBeenCalledWith("Player One"));

    connection.emit({
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      role: "BLIND_COOK",
      connectedCount: 3,
      roomStatus: "READY",
    });

    expect(root.textContent).toContain("ROOM123");
    expect(root.textContent).toContain("Blind Cook");
    expect(root.textContent).toContain("3 / 3");
    expect(root.textContent).toContain("Ready");
  });

  test("Blind Cook sees synchronized objects and usable pickup/drop controls", async () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    connection.emit({
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      role: "BLIND_COOK",
      connectedCount: 3,
      roomStatus: "READY",
      objects: [
        { id: "ingredient-1", kind: "TOMATO", label: "Tomato", x: 24, y: 18 },
      ],
    });

    expect(root.textContent).toContain("Tomato");
    expect(root.textContent).toContain("(24, 18)");
    root.querySelector<HTMLButtonElement>('[data-pick-up="ingredient-1"]')!.click();
    expect(connection.pickUp).toHaveBeenCalledWith("ingredient-1");

    connection.emit({
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      role: "BLIND_COOK",
      connectedCount: 3,
      roomStatus: "READY",
      objects: [
        {
          id: "ingredient-1",
          kind: "TOMATO",
          label: "Tomato",
          x: 24,
          y: 18,
          heldBy: "self",
          heldByMe: true,
        },
      ],
    });
    root.querySelector<HTMLButtonElement>('[data-drop="ingredient-1"]')!.click();
    expect(connection.drop).toHaveBeenCalledWith("ingredient-1", 50, 30);
  });

  test("other roles are read-only and sanitized interaction errors are displayed", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    connection.emit({
      connectionStatus: "CONNECTED",
      role: "RECIPE_KEEPER",
      connectedCount: 3,
      roomStatus: "READY",
      objects: [
        { id: "ingredient-1", kind: "TOMATO", label: "Tomato", x: 24, y: 18 },
      ],
      interactionError: "That interaction was rejected.",
    });

    expect(root.textContent).toContain("Only the Blind Cook can pick up and drop objects.");
    expect(root.querySelectorAll("[data-pick-up], [data-drop]")).toHaveLength(0);
    expect(root.getElementsByClassName("interaction-error")[0]?.textContent).toBe(
      "That interaction was rejected.",
    );
  });
});

class FakeConnection implements LobbyConnection {
  create = vi.fn(async (_displayName: string) => undefined);
  join = vi.fn(async (_roomId: string, _displayName: string) => undefined);
  resume = vi.fn(async () => false);
  pickUp = vi.fn((_objectId: string) => undefined);
  drop = vi.fn((_objectId: string, _x: number, _y: number) => undefined);
  private listener: ((snapshot: LobbySnapshot) => void) | undefined;

  subscribe(listener: (snapshot: LobbySnapshot) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(snapshot: LobbySnapshot): void {
    this.listener?.(snapshot);
  }
}

function actionButtons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("[data-action]"));
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
