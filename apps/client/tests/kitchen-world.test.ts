// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import type {
  LobbyConnection,
  LobbySnapshot,
} from "../src/network/RoomClient.js";
import type { KitchenWorldAdapter } from "../src/game/KitchenWorld.js";
import { Lobby } from "../src/ui/Lobby.js";

describe("KitchenWorld adapter lifecycle", () => {
  test("Lobby mounts one world only while operating, updates it from snapshots, and destroys it", () => {
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    const connection = new FakeConnection();
    const world: KitchenWorldAdapter = {
      mount: vi.fn(),
      update: vi.fn(),
      destroy: vi.fn(),
    };
    const lobby = new Lobby(root, connection, {
      storage: memoryStorage(),
      world,
    });

    lobby.mount();
    expect(world.mount).not.toHaveBeenCalled();
    expect(world.update).not.toHaveBeenCalled();

    const running: LobbySnapshot = {
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      sessionId: "blind",
      role: "BLIND_COOK",
      connectedCount: 3,
      roomStatus: "READY",
      roundStatus: "RUNNING",
      remainingMs: 60_000,
      objects: [{
        id: "tomato-1",
        kind: "TOMATO",
        label: "Tomato",
        x: 25,
        y: 20,
        preparation: "RAW",
        location: "COUNTER",
      }],
    };
    connection.emit(running);
    const stage = root.querySelector<HTMLElement>("[data-kitchen-world]")!;
    expect(stage).not.toBeNull();
    expect(world.mount).toHaveBeenCalledTimes(1);
    expect(world.mount).toHaveBeenCalledWith(stage);
    expect(world.update).toHaveBeenLastCalledWith(running);
    const hotspot = root.querySelector('[data-point-object="tomato-1"]');

    const timerOnly = {
      ...running,
      remainingMs: 59_000,
      objects: running.objects?.map((object) => ({ ...object })),
    };
    connection.emit(timerOnly);
    expect(world.mount).toHaveBeenCalledTimes(1);
    expect(world.update).toHaveBeenLastCalledWith(timerOnly);
    expect(root.querySelector('[data-point-object="tomato-1"]')).toBe(hotspot);

    lobby.destroy();
    expect(world.destroy).toHaveBeenCalledTimes(1);
  });

  test("spatial hotspots expose only role-safe bounded existing commands", () => {
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    const connection = new FakeConnection();
    const lobby = new Lobby(root, connection, {
      storage: memoryStorage(),
      world: { mount: vi.fn(), update: vi.fn(), destroy: vi.fn() },
    });
    lobby.mount();

    const running: LobbySnapshot = {
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      sessionId: "blind",
      role: "BLIND_COOK",
      connectedCount: 3,
      roomStatus: "READY",
      roundStatus: "RUNNING",
      objects: [
        {
          id: "raw",
          kind: "TOMATO",
          label: "Tomato",
          x: 20,
          y: 10,
          preparation: "RAW",
          location: "COUNTER",
        },
        {
          id: "held",
          kind: "ONION",
          label: "Onion",
          x: 100,
          y: 60,
          heldBy: "blind",
          heldByMe: true,
          preparation: "CHOPPED",
          location: "COUNTER",
        },
      ],
    };
    connection.emit(running);

    const objectHotspots = Array.from(
      root.querySelectorAll<HTMLButtonElement>(
        "[data-kitchen-hotspot][data-point-object]",
      ),
    );
    const stationHotspots = Array.from(
      root.querySelectorAll<HTMLButtonElement>(
        "[data-kitchen-hotspot][data-station-id]",
      ),
    );
    expect(objectHotspots).toHaveLength(2);
    expect(stationHotspots).toHaveLength(5);
    expect(objectHotspots.map((hotspot) => hotspot.dataset.worldLabel)).toEqual([
      "Tomato",
      "Onion",
    ]);
    expect(stationHotspots.map((hotspot) => hotspot.dataset.worldLabel)).toEqual([
      "Recipe lectern",
      "Prep counter",
      "Copper stove",
      "Serving pass",
      "Gesture board",
    ]);
    expect([...objectHotspots, ...stationHotspots].every((hotspot) => {
      const left = Number.parseFloat(hotspot.style.left);
      const top = Number.parseFloat(hotspot.style.top);
      return hotspot.ariaLabel.length > 0
        && Number.isFinite(left)
        && Number.isFinite(top)
        && left >= 0
        && left <= 100
        && top >= 0
        && top <= 100;
    })).toBe(true);

    objectHotspots[0]!.click();
    expect(objectHotspots[0]!.parentElement?.classList.contains("is-selected"))
      .toBe(true);
    root.querySelector<HTMLButtonElement>('[data-pick-up="raw"]')!.click();
    expect(connection.pickUp).toHaveBeenCalledWith("raw");

    objectHotspots[1]!.dispatchEvent(new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
    }));
    root.querySelector<HTMLButtonElement>('[data-drop="held"]')!.click();
    expect(connection.drop).toHaveBeenCalledOnce();
    const [, x, y] = connection.drop.mock.calls[0]!;
    expect(Number.isFinite(x) && x >= 0 && x <= 100).toBe(true);
    expect(Number.isFinite(y) && y >= 0 && y <= 60).toBe(true);

    connection.emit({ ...running, role: "RECIPE_KEEPER" });
    expect(root.querySelectorAll(
      "[data-pick-up], [data-drop], [data-cook-action]",
    )).toHaveLength(0);
    root.querySelector<HTMLButtonElement>(
      '[data-kitchen-hotspot][data-point-object="raw"]',
    )!.click();
    expect(connection.pointAtObject).toHaveBeenCalledWith("raw");

    connection.emit({
      ...running,
      roundStatus: "PAUSED",
    });
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>(
      "[data-kitchen-hotspot], [data-world-action]",
    )).every((button) => button.disabled)).toBe(true);
  });

  test("running composition is world-first with private recipe and role tools in compact drawers", () => {
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    const connection = new FakeConnection();
    new Lobby(root, connection, {
      storage: memoryStorage(),
      world: { mount: vi.fn(), update: vi.fn(), destroy: vi.fn() },
    }).mount();

    connection.emit({
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      sessionId: "keeper",
      role: "RECIPE_KEEPER",
      connectedCount: 3,
      roomStatus: "READY",
      roundStatus: "RUNNING",
      privateRecipe: {
        id: "secret-soup",
        title: "Secret Soup",
        ingredients: [{ kind: "TOMATO", count: 1 }],
        steps: [{ action: "CHOP", ingredientKind: "TOMATO" }],
      },
      objects: [],
    });

    const operate = root.querySelector<HTMLElement>("[data-operate-surface]")!;
    const stage = operate.querySelector<HTMLElement>("[data-kitchen-stage]")!;
    expect(stage).not.toBeNull();
    expect(operate.querySelector(".objects-panel")).toBeNull();
    expect(stage.compareDocumentPosition(
      operate.querySelector("[data-role-tools-drawer]")!,
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const recipeDrawer = operate.querySelector<HTMLDetailsElement>(
      "[data-recipe-drawer]",
    )!;
    expect(recipeDrawer.hidden).toBe(false);
    expect(recipeDrawer.querySelector("[data-private-recipe]")?.textContent)
      .toContain("Secret Soup");
    const toolsDrawer = operate.querySelector<HTMLDetailsElement>(
      "[data-role-tools-drawer]",
    )!;
    expect(toolsDrawer.querySelector("summary")?.textContent).toContain(
      "Role tools",
    );

    connection.emit({
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      sessionId: "guide",
      role: "DEAF_KITCHEN_GUIDE",
      connectedCount: 3,
      roomStatus: "READY",
      roundStatus: "RUNNING",
      objects: [],
    });
    expect(recipeDrawer.hidden).toBe(true);
    expect(root.querySelector("[data-private-recipe]")).toBeNull();
  });
});

class FakeConnection implements LobbyConnection {
  create = vi.fn(async () => undefined);
  join = vi.fn(async () => undefined);
  resume = vi.fn(async () => false);
  pickUp = vi.fn();
  drop = vi.fn();
  chop = vi.fn();
  addToPot = vi.fn();
  season = vi.fn();
  boil = vi.fn();
  mix = vi.fn();
  plate = vi.fn();
  pointAtObject = vi.fn();
  pointAtLocation = vi.fn();
  sendGesture = vi.fn();
  sendEmote = vi.fn();
  sendRecipeCard = vi.fn();
  sendDrawingStroke = vi.fn();
  clearDrawing = vi.fn();
  sendVoiceSignal = vi.fn();
  private readonly listeners = new Set<(snapshot: LobbySnapshot) => void>();

  subscribe(listener: (snapshot: LobbySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener({ connectionStatus: "DISCONNECTED" });
    return () => this.listeners.delete(listener);
  }

  subscribeVoice(): () => void {
    return () => undefined;
  }

  emit(snapshot: LobbySnapshot): void {
    for (const listener of this.listeners) listener(snapshot);
  }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
