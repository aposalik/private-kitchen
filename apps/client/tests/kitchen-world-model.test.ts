import { describe, expect, test } from "vitest";

import type { LobbySnapshot } from "../src/network/RoomClient.js";
import {
  KITCHEN_STATIONS,
  kitchenObjectAppearance,
  projectKitchenWorld,
  projectWorldPoint,
} from "../src/game/KitchenWorldModel.js";

describe("KitchenWorldModel", () => {
  test("projects authoritative kitchen state into a deterministic bounded isometric world", () => {
    const snapshot: LobbySnapshot = {
      connectionStatus: "CONNECTED",
      roomId: "PRIVATE-ROOM",
      sessionId: "blind-session",
      role: "BLIND_COOK",
      connectedCount: 3,
      roomStatus: "READY",
      roundStatus: "RUNNING",
      remainingMs: 45_000,
      completedStepCount: 2,
      totalStepCount: 10,
      players: [
        { id: "blind-session", role: "BLIND_COOK" },
        { id: "keeper-session", role: "RECIPE_KEEPER" },
        { id: "guide-session", role: "DEAF_KITCHEN_GUIDE" },
      ],
      objects: [
        {
          id: "tomato-1",
          kind: "TOMATO",
          label: "Tomato",
          x: 20,
          y: 10,
          preparation: "RAW",
          location: "COUNTER",
        },
        {
          id: "onion-1",
          kind: "ONION",
          label: "Onion",
          x: 80,
          y: 50,
          heldBy: "blind-session",
          heldByMe: true,
          preparation: "CHOPPED",
          location: "COUNTER",
        },
        {
          id: "carrot-1",
          kind: "CARROT",
          label: "Carrot",
          x: 50,
          y: 30,
          preparation: "RUINED",
          location: "POT",
        },
      ],
    };

    expect(projectWorldPoint(0, 0)).toEqual({ left: 50, top: 13 });
    expect(projectWorldPoint(100, 60)).toEqual({ left: 50, top: 87 });

    const first = projectKitchenWorld(snapshot);
    expect(projectKitchenWorld({ ...snapshot, remainingMs: 44_000 })).toEqual(first);
    expect(first.stations).toEqual(KITCHEN_STATIONS);
    expect(first.avatars.map(({ role, stationId }) => ({ role, stationId }))).toEqual([
      { role: "RECIPE_KEEPER", stationId: "LECTERN" },
      { role: "BLIND_COOK", stationId: "PREP" },
      { role: "DEAF_KITCHEN_GUIDE", stationId: "SIGN_BOARD" },
    ]);
    expect(first.objects.map(({ id, visualState }) => ({ id, visualState }))).toEqual([
      { id: "tomato-1", visualState: "RAW" },
      { id: "carrot-1", visualState: "RUINED_IN_POT" },
      { id: "onion-1", visualState: "HELD_CHOPPED" },
    ]);
    expect(first.objects.map(({ id, ariaLabel }) => ({ id, ariaLabel }))).toEqual([
      { id: "tomato-1", ariaLabel: "Tomato, raw, on counter, available" },
      { id: "carrot-1", ariaLabel: "Carrot, ruined, in pot, available" },
      { id: "onion-1", ariaLabel: "Onion, chopped, on counter, held by you" },
    ]);
    expect(first.objects.find(({ id }) => id === "onion-1")?.anchorStationId)
      .toBe("PREP");
    expect(first.objects.find(({ id }) => id === "carrot-1")?.anchorStationId)
      .toBe("STOVE");

    const hotspots = [
      ...first.objects.map((object) => object.hotspot),
      ...first.stations.map((station) => station.hotspot),
    ];
    expect(hotspots.every(({ left, top }) =>
      Number.isFinite(left)
      && Number.isFinite(top)
      && left >= 0
      && left <= 100
      && top >= 0
      && top <= 100)).toBe(true);
    expect(first.objects.map((object) => object.depth)).toEqual(
      [...first.objects].map((object) => object.depth).sort((a, b) => a - b),
    );
  });

  test("does not expose private recipe content through labels for another role", () => {
    const world = projectKitchenWorld({
      connectionStatus: "CONNECTED",
      role: "DEAF_KITCHEN_GUIDE",
      privateRecipe: {
        id: "secret-soup",
        title: "Secret Soup",
        ingredients: [{ kind: "TOMATO", count: 1 }],
        steps: [{ action: "CHOP", ingredientKind: "TOMATO" }],
      },
      objects: [],
    });

    expect(JSON.stringify(world)).not.toContain("Secret Soup");
    expect(JSON.stringify(world)).not.toContain("secret-soup");
  });

  test("renders only occupied role stations instead of phantom monkey players", () => {
    const world = projectKitchenWorld({
      connectionStatus: "CONNECTED",
      role: "BLIND_COOK",
      players: [{ id: "blind-session", role: "BLIND_COOK" }],
      objects: [],
    });

    expect(world.avatars.map(({ role }) => role)).toEqual(["BLIND_COOK"]);
  });

  test("provides distinct visual treatments for preparation, pot, and held states", () => {
    expect(kitchenObjectAppearance("RAW")).toMatchObject({ detail: "HIGHLIGHT", scale: 1 });
    expect(kitchenObjectAppearance("CHOPPED")).toMatchObject({ detail: "CHOP_MARKS", scale: 1 });
    expect(kitchenObjectAppearance("RUINED")).toMatchObject({ detail: "SMOKE", alpha: 0.58 });
    expect(kitchenObjectAppearance("IN_POT")).toMatchObject({ detail: "BUBBLES" });
    expect(kitchenObjectAppearance("HELD_CHOPPED")).toMatchObject({
      detail: "CHOP_MARKS",
      scale: 1.14,
    });
  });
});
