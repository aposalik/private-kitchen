import type { LobbySnapshot } from "../network/RoomClient.js";
import { BabylonKitchenWorld } from "../game3d/BabylonKitchenWorld.js";

export interface KitchenWorldAdapter {
  mount(container: HTMLElement): void;
  update(snapshot: LobbySnapshot): void;
  predictMovement?(axisX: number, axisZ: number, sequence: number): void;
  destroy(): void;
}

export type KitchenRenderer = "babylon" | "phaser";

export interface KitchenRendererErrorDetail {
  readonly renderer: KitchenRenderer;
  readonly category: "failure" | "timeout";
  readonly reason: string;
}

export function rendererSelection(search: string): KitchenRenderer {
  return new URLSearchParams(search).get("renderer") === "phaser"
    ? "phaser"
    : "babylon";
}

export function createKitchenWorld(
  search = typeof location === "undefined" ? "" : location.search,
): KitchenWorldAdapter {
  return rendererSelection(search) === "phaser"
    ? new PhaserKitchenWorld()
    : new BabylonKitchenWorld();
}

export interface PhaserRuntime {
  update(snapshot: LobbySnapshot): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

export type PhaserRuntimeFactory = (
  container: HTMLElement,
  options: {
    readonly reducedMotion: boolean;
    readonly readinessTimeoutMs: number;
  },
) => Promise<PhaserRuntime>;

export interface PhaserKitchenWorldOptions {
  readonly runtimeFactory?: PhaserRuntimeFactory;
  readonly reducedMotion?: boolean;
  readonly readinessTimeoutMs?: number;
}

export class PhaserKitchenWorld implements KitchenWorldAdapter {
  private container: HTMLElement | undefined;
  private latestSnapshot: LobbySnapshot | undefined;
  private runtime: PhaserRuntime | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private readonly runtimeFactory: PhaserRuntimeFactory;
  private readonly reducedMotion: boolean;
  private readonly readinessTimeoutMs: number;
  private readonly skipDefaultRuntimeInJsdom: boolean;
  private generation = 0;
  private destroyed = false;

  constructor(options: PhaserKitchenWorldOptions = {}) {
    this.runtimeFactory = options.runtimeFactory ?? defaultPhaserRuntimeFactory;
    this.reducedMotion = options.reducedMotion
      ?? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ?? false;
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? 45_000;
    this.skipDefaultRuntimeInJsdom = options.runtimeFactory === undefined
      && navigator.userAgent.includes("jsdom");
  }

  mount(container: HTMLElement): void {
    if (this.container || this.destroyed) return;
    this.container = container;
    container.dataset.renderer = "phaser";
    container.dataset.rendererState = "loading";
    if (this.skipDefaultRuntimeInJsdom) return;
    const generation = ++this.generation;
    void this.start(container, generation);
  }

  update(snapshot: LobbySnapshot): void {
    this.latestSnapshot = snapshot;
    this.runtime?.update(snapshot);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.runtime?.destroy();
    this.runtime = undefined;
    if (this.container) {
      delete this.container.dataset.renderer;
      delete this.container.dataset.rendererState;
    }
    this.container = undefined;
  }

  private async start(container: HTMLElement, generation: number): Promise<void> {
    try {
      const runtime = await this.runtimeFactory(container, {
        reducedMotion: this.reducedMotion,
        readinessTimeoutMs: this.readinessTimeoutMs,
      });
      if (this.destroyed || generation !== this.generation || this.container !== container) {
        runtime.destroy();
        return;
      }
      this.runtime = runtime;
      container.dataset.rendererState = "ready";
      if (this.latestSnapshot) runtime.update(this.latestSnapshot);
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => {
          if (!this.runtime || !this.container) return;
          this.runtime.resize(
            Math.max(this.container.clientWidth, 320),
            Math.max(this.container.clientHeight, 240),
          );
        });
        this.resizeObserver.observe(container);
      }
    } catch (error) {
      if (this.destroyed || generation !== this.generation || this.container !== container) return;
      container.dataset.rendererState = "unavailable";
      container.dispatchEvent(new CustomEvent("kitchenrenderererror", {
        bubbles: true,
        detail: {
          renderer: "phaser",
          category: "failure",
          reason: error instanceof Error ? error.message : "Phaser renderer unavailable",
        } satisfies KitchenRendererErrorDetail,
      }));
    }
  }
}

async function defaultPhaserRuntimeFactory(
  container: HTMLElement,
  options: {
    readonly reducedMotion: boolean;
    readonly readinessTimeoutMs: number;
  },
): Promise<PhaserRuntime> {
  const [{ default: Phaser }, { KitchenScene }] = await Promise.all([
    import("phaser"),
    import("./scenes/KitchenScene.js"),
  ]);
  const scene = new KitchenScene(options.reducedMotion);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: Math.max(container.clientWidth, 320),
    height: Math.max(container.clientHeight, 240),
    transparent: true,
    antialias: true,
    scene: [scene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: true,
    },
    banner: false,
  });
  try {
    await waitForPhaserCanvas(container, options.readinessTimeoutMs);
  } catch (error) {
    game.destroy(true);
    throw error;
  }
  return {
    update: (snapshot) => scene.setSnapshot(snapshot),
    resize: (width, height) => game.scale.resize(width, height),
    destroy: () => game.destroy(true),
  };
}

function waitForPhaserCanvas(
  container: HTMLElement,
  readinessTimeoutMs: number,
): Promise<void> {
  if (container.querySelector("canvas")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!container.querySelector("canvas")) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve();
    });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Phaser canvas did not initialize within ${readinessTimeoutMs}ms`));
    }, readinessTimeoutMs);
    observer.observe(container, { childList: true, subtree: true });
  });
}
