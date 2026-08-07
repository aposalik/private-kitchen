// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import type { LobbySnapshot } from "../src/network/RoomClient.js";
import {
  createKitchenWorld,
  PhaserKitchenWorld,
  rendererSelection,
  type PhaserRuntime,
  type PhaserRuntimeFactory,
} from "../src/game/KitchenWorld.js";
import { PHASE_C_LIGHTING } from "../src/game3d/BabylonKitchenScene.js";
import {
  cameraGoal,
  dampCamera,
  occluderOpacity,
} from "../src/game3d/CameraController.js";
import {
  LocalPrediction,
  RemoteSnapshotInterpolator,
} from "../src/game3d/SnapshotMotion.js";
import {
  contextualPrompt,
  projectWorldToPresentation,
} from "../src/game3d/Presentation.js";
import {
  BLIND_COOK_VISION_RESTRICTION_ENABLED,
  createBlindCookVisionEffect,
} from "../src/game3d/BlindCookVisionEffect.js";
import { PROCEDURAL_ASSET_MANIFEST } from "../src/game3d/AssetCatalog.js";
import {
  BabylonKitchenWorld,
  type BabylonRuntimeFactory,
} from "../src/game3d/BabylonKitchenWorld.js";

describe("Phase 7 Babylon representative prototype", () => {
  test("selects Babylon by default and keeps explicit Phaser query rollback", () => {
    expect(rendererSelection("")).toBe("babylon");
    expect(rendererSelection("?renderer=babylon")).toBe("babylon");
    expect(rendererSelection("?renderer=phaser")).toBe("phaser");
    expect(rendererSelection("?renderer=unknown")).toBe("babylon");
    expect(createKitchenWorld("?renderer=phaser").constructor.name).toBe("PhaserKitchenWorld");
    expect(createKitchenWorld("").constructor.name).toBe("BabylonKitchenWorld");
    const rollback = createKitchenWorld("?renderer=phaser");
    const container = document.createElement("div");
    rollback.mount(container);
    expect(container.dataset.renderer).toBe("phaser");
    rollback.destroy();
  });

  test("does not bootstrap a real Babylon WebGL engine under jsdom", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const world = new BabylonKitchenWorld();
    const container = document.createElement("div");

    world.mount(container);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.dataset.rendererState).toBe("loading");
    expect(getContext).not.toHaveBeenCalled();
    world.destroy();
    getContext.mockRestore();
  });

  test("keeps the representative kitchen lighting restrained", () => {
    expect(PHASE_C_LIGHTING.warmFillIntensity).toBeLessThanOrEqual(0.5);
    expect(PHASE_C_LIGHTING.windowKeyIntensity).toBeLessThanOrEqual(0.9);
    expect(PHASE_C_LIGHTING.materialEmissiveContribution).toBeLessThanOrEqual(0.02);
  });

  test("reports Phaser loading, readiness, and bootstrap failure explicitly", async () => {
    const runtime: PhaserRuntime = {
      update: vi.fn(),
      resize: vi.fn(),
      destroy: vi.fn(),
    };
    let resolveRuntime!: (runtime: PhaserRuntime) => void;
    const factory: PhaserRuntimeFactory = vi.fn(() => new Promise((resolve) => {
      resolveRuntime = resolve;
    }));
    const container = document.createElement("div");
    const world = new PhaserKitchenWorld({ runtimeFactory: factory });
    const snapshot: LobbySnapshot = { connectionStatus: "CONNECTED" };

    world.update(snapshot);
    world.mount(container);
    expect(container.dataset.renderer).toBe("phaser");
    expect(container.dataset.rendererState).toBe("loading");
    resolveRuntime(runtime);
    await Promise.resolve();
    await Promise.resolve();
    expect(container.dataset.rendererState).toBe("ready");
    expect(runtime.update).toHaveBeenCalledWith(snapshot);
    world.destroy();
    expect(runtime.destroy).toHaveBeenCalledTimes(1);
    expect(container.dataset.rendererState).toBeUndefined();

    const failedContainer = document.createElement("div");
    const failed = vi.fn();
    failedContainer.addEventListener("kitchenrenderererror", failed);
    const unavailable = new PhaserKitchenWorld({
      runtimeFactory: vi.fn(async () => {
        throw new Error("Phaser canvas timeout");
      }),
    });
    unavailable.mount(failedContainer);
    await Promise.resolve();
    await Promise.resolve();
    expect(failedContainer.dataset.rendererState).toBe("unavailable");
    expect(failed).toHaveBeenCalledTimes(1);
    expect((failed.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      renderer: "phaser",
      category: "failure",
      reason: "Phaser canvas timeout",
    });
    unavailable.destroy();
  });

  test("mounts, queues update, resizes, restores context, and destroys once", async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const runtime = {
      whenReady: vi.fn(() => ready),
      update: vi.fn(),
      predictMovement: vi.fn(),
      resize: vi.fn(),
      render: vi.fn(),
      restoreContext: vi.fn(),
      destroy: vi.fn(),
    };
    let resolveRuntime!: (value: typeof runtime) => void;
    const factory: BabylonRuntimeFactory = vi.fn(() => new Promise((resolve) => {
      resolveRuntime = resolve;
    }));
    const world = new BabylonKitchenWorld({
      runtimeFactory: factory,
      reducedMotion: true,
    });
    const container = document.createElement("div");
    const snapshot: LobbySnapshot = { connectionStatus: "CONNECTED" };

    world.update(snapshot);
    world.predictMovement(1, 0, 7);
    world.mount(container);
    world.mount(container);
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(container.dataset.renderer).toBe("babylon");
    expect(container.dataset.rendererState).toBe("loading");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      { reducedMotion: true },
    );
    resolveRuntime(runtime);
    await Promise.resolve();
    await Promise.resolve();
    expect(container.dataset.rendererState).toBe("loading");
    expect(runtime.update).toHaveBeenCalledWith(snapshot);
    expect(runtime.predictMovement).toHaveBeenCalledWith(1, 0, 7);
    resolveReady();
    await Promise.resolve();
    await Promise.resolve();
    expect(container.dataset.rendererState).toBe("ready");

    window.dispatchEvent(new Event("resize"));
    container.querySelector("canvas")!.dispatchEvent(new Event("webglcontextrestored"));
    expect(runtime.resize).toHaveBeenCalled();
    expect(runtime.restoreContext).toHaveBeenCalled();

    world.destroy();
    world.destroy();
    expect(runtime.destroy).toHaveBeenCalledTimes(1);
    expect(container.querySelector("canvas")).toBeNull();
  });

  test("marks a bounded WebGL bootstrap failure without claiming readiness", async () => {
    const world = new BabylonKitchenWorld({
      runtimeFactory: vi.fn(async () => {
        throw new Error("WebGL unavailable");
      }),
    });
    const container = document.createElement("div");
    const failed = vi.fn();
    container.addEventListener("kitchenrenderererror", failed);
    world.mount(container);
    await Promise.resolve();
    await Promise.resolve();
    expect(container.dataset.renderer).toBe("babylon");
    expect(container.dataset.rendererState).toBe("unavailable");
    expect(failed).toHaveBeenCalledTimes(1);
    expect((failed.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
      renderer: "babylon",
      category: "failure",
      reason: "WebGL unavailable",
    });
    world.destroy();
  });

  test("ignores late Babylon readiness after adapter destruction", async () => {
    let resolveReady!: () => void;
    const runtime = {
      whenReady: vi.fn(() => new Promise<void>((resolve) => {
        resolveReady = resolve;
      })),
      update: vi.fn(),
      predictMovement: vi.fn(),
      resize: vi.fn(),
      render: vi.fn(),
      restoreContext: vi.fn(),
      destroy: vi.fn(),
    };
    const world = new BabylonKitchenWorld({
      runtimeFactory: vi.fn(async () => runtime),
    });
    const container = document.createElement("div");
    const failed = vi.fn();
    container.addEventListener("kitchenrenderererror", failed);

    world.mount(container);
    await Promise.resolve();
    await Promise.resolve();
    world.destroy();
    resolveReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.destroy).toHaveBeenCalledTimes(1);
    expect(container.dataset.rendererState).toBeUndefined();
    expect(failed).not.toHaveBeenCalled();
  });

  test("times out Babylon scene readiness with structured failure details", async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        whenReady: vi.fn(() => new Promise<void>(() => undefined)),
        update: vi.fn(),
        predictMovement: vi.fn(),
        resize: vi.fn(),
        render: vi.fn(),
        restoreContext: vi.fn(),
        destroy: vi.fn(),
      };
      const world = new BabylonKitchenWorld({
        runtimeFactory: vi.fn(async () => runtime),
        readinessTimeoutMs: 50,
      });
      const container = document.createElement("div");
      const failures: CustomEvent[] = [];
      container.addEventListener("kitchenrenderererror", (event) => {
        failures.push(event as CustomEvent);
      });

      world.mount(container);
      const canvas = container.querySelector("canvas")!;
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);

      expect(container.dataset.rendererState).toBe("unavailable");
      expect(runtime.destroy).toHaveBeenCalledTimes(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]!.detail).toMatchObject({
        renderer: "babylon",
        category: "timeout",
        reason: expect.stringContaining("50"),
      });
      canvas.dispatchEvent(new Event("webglcontextrestored"));
      expect(container.dataset.rendererState).toBe("unavailable");
      expect(runtime.restoreContext).not.toHaveBeenCalled();
      world.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  test("uses a bounded elevated camera with damped group framing and restored occluders", () => {
    const gathered = cameraGoal([
      { id: "self", x: 40, z: 25 },
      { id: "near", x: 44, z: 27 },
    ], "self");
    const separated = cameraGoal([
      { id: "self", x: 40, z: 25 },
      { id: "far", x: 95, z: 55 },
    ], "self");
    expect(gathered.pitchDegrees).toBeGreaterThanOrEqual(35);
    expect(gathered.pitchDegrees).toBeLessThanOrEqual(50);
    expect(separated.distance).toBeGreaterThan(gathered.distance);
    expect(separated.distance).toBeLessThanOrEqual(82);
    expect(separated.azimuthDegrees).toBe(gathered.azimuthDegrees);
    const damped = dampCamera(gathered, separated, 1 / 60, false);
    expect(damped.distance).toBeGreaterThan(gathered.distance);
    expect(damped.distance).toBeLessThan(separated.distance);
    expect(dampCamera(gathered, separated, 1 / 60, true)).toEqual(separated);
    expect(occluderOpacity(true, 1, 1 / 60)).toBeLessThan(1);
    expect(occluderOpacity(false, 0.25, 1)).toBe(1);

    const transientlyInvalid = cameraGoal([
      { id: "partial", x: Number.NaN, z: Number.NaN },
      { id: "valid", x: 50, z: 30 },
    ], "partial");
    expect(Object.values(cameraGoal([], undefined)).every(Number.isFinite)).toBe(true);
    expect(Object.values(transientlyInvalid).every(Number.isFinite)).toBe(true);
    const poisoned = { ...gathered, targetX: Number.NaN, targetZ: Number.NaN };
    expect(dampCamera(poisoned, separated, 1 / 60, false)).toEqual(separated);
  });

  test("frames the complete three-player group independently of the local role", () => {
    const players = [
      { id: "blind", x: 8, z: 8 },
      { id: "keeper", x: 50, z: 30 },
      { id: "guide", x: 92, z: 52 },
    ] as const;

    const goals = players.map(({ id }) => cameraGoal(players, id));

    expect(goals[1]).toEqual(goals[0]);
    expect(goals[2]).toEqual(goals[0]);
    expect(goals[0]).toMatchObject({ targetX: 50, targetZ: 30 });
  });

  test("interpolates remotes and reconciles local prediction only from transform plus ack", () => {
    const remote = new RemoteSnapshotInterpolator();
    remote.push("remote", { x: 0, z: 0, facingYaw: 0 }, 0);
    remote.push("remote", { x: 10, z: 4, facingYaw: Math.PI / 2 }, 100);
    expect(remote.sample("remote", 50)).toMatchObject({ x: 5, z: 2 });

    const local = new LocalPrediction({ x: 10, z: 10, facingYaw: 0 });
    local.applyInput({ sequence: 1, axisX: 1, axisZ: 0 }, 0.1);
    local.applyInput({ sequence: 2, axisX: 0, axisZ: 1 }, 0.1);
    local.advance(0.05);
    const before = local.presentation;
    local.reconcile({
      x: 10.6,
      z: 10,
      facingYaw: Math.PI / 2,
      lastProcessedMovementSequence: 1,
    });
    expect(local.pendingSequences).toEqual([2]);
    expect(local.presentation.x).toBe(10.6);
    expect(local.presentation.z).toBeGreaterThan(10);
    expect(local.presentation).not.toEqual(before);
  });

  test("replaces coalesced prediction axes that reuse a queued sequence", () => {
    const local = new LocalPrediction({ x: 10, z: 10, facingYaw: 0 });
    local.applyInput({ sequence: 1, axisX: 1, axisZ: 0 }, 0.05);
    local.applyInput({ sequence: 1, axisX: 0, axisZ: 0 }, 0.05);
    const stopped = local.presentation;

    local.advance(0.05);

    expect(local.pendingSequences).toEqual([1]);
    expect(local.presentation).toEqual(stopped);
  });

  test("projects world presentation and gives contextual server-checked prompts", () => {
    const projected = projectWorldToPresentation({ x: 50, z: 30 }, 1600, 900);
    expect(projected.left).toBeGreaterThan(0);
    expect(projected.left).toBeLessThan(1600);
    expect(projected.top).toBeGreaterThan(0);
    expect(projected.top).toBeLessThan(900);
    expect(contextualPrompt({
      role: "BLIND_COOK",
      x: 32,
      z: 44,
      roundStatus: "RUNNING",
      hasHeldIngredient: true,
      completedStepCount: 0,
      totalStepCount: 6,
    })).toMatchObject({ action: "CHOP", key: "E" });
    expect(contextualPrompt({
      role: "RECIPE_KEEPER",
      x: 32,
      z: 44,
      roundStatus: "RUNNING",
      hasHeldIngredient: false,
      completedStepCount: 0,
      totalStepCount: 6,
    })).toBeUndefined();
  });

  test("enables the Blind Cook restriction and keeps procedural assets project-owned", () => {
    expect(BLIND_COOK_VISION_RESTRICTION_ENABLED).toBe(true);
    expect(createBlindCookVisionEffect("BLIND_COOK").enabled).toBe(true);
    expect(createBlindCookVisionEffect("DEAF_KITCHEN_GUIDE").enabled).toBe(false);
    expect(PROCEDURAL_ASSET_MANIFEST.every((asset) =>
      asset.provenance === "PROJECT_PROCEDURAL"
      && asset.license === "PROJECT_OWNED")).toBe(true);
  });
});
