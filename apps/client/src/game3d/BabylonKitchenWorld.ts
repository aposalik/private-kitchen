import type {
  KitchenRendererErrorDetail,
  KitchenWorldAdapter,
} from "../game/KitchenWorld.js";
import type { LobbySnapshot } from "../network/RoomClient.js";

export interface BabylonRuntime {
  whenReady(): Promise<void>;
  update(snapshot: LobbySnapshot): void;
  predictMovement(axisX: number, axisZ: number, sequence: number): void;
  resize(): void;
  render(): void;
  restoreContext(): void;
  destroy(): void;
}

export type BabylonRuntimeFactory = (
  canvas: HTMLCanvasElement,
  options: { readonly reducedMotion: boolean },
) => Promise<BabylonRuntime>;

export interface BabylonKitchenWorldOptions {
  readonly runtimeFactory?: BabylonRuntimeFactory;
  readonly reducedMotion?: boolean;
  readonly readinessTimeoutMs?: number;
}

const DEFAULT_READINESS_TIMEOUT_MS = 45_000;

export class BabylonKitchenWorld implements KitchenWorldAdapter {
  private container: HTMLElement | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private runtime: BabylonRuntime | undefined;
  private latestSnapshot: LobbySnapshot | undefined;
  private readonly queuedPrediction: Array<{
    readonly axisX: number;
    readonly axisZ: number;
    readonly sequence: number;
  }> = [];
  private readonly runtimeFactory: BabylonRuntimeFactory;
  private readonly reducedMotion: boolean;
  private readonly readinessTimeoutMs: number;
  private readonly skipDefaultRuntimeInJsdom: boolean;
  private generation = 0;
  private destroyed = false;

  constructor(options: BabylonKitchenWorldOptions = {}) {
    this.runtimeFactory = options.runtimeFactory ?? defaultRuntimeFactory;
    this.reducedMotion = options.reducedMotion
      ?? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ?? false;
    this.readinessTimeoutMs = Number.isFinite(options.readinessTimeoutMs)
      && (options.readinessTimeoutMs ?? 0) > 0
      ? options.readinessTimeoutMs!
      : DEFAULT_READINESS_TIMEOUT_MS;
    this.skipDefaultRuntimeInJsdom = options.runtimeFactory === undefined
      && navigator.userAgent.includes("jsdom");
  }

  mount(container: HTMLElement): void {
    if (this.container || this.destroyed) return;
    this.container = container;
    container.dataset.renderer = "babylon";
    container.dataset.rendererState = "loading";
    const canvas = document.createElement("canvas");
    canvas.className = "babylon-kitchen-canvas";
    canvas.dataset.renderer = "babylon";
    canvas.setAttribute("aria-hidden", "true");
    canvas.tabIndex = -1;
    container.replaceChildren(canvas);
    this.canvas = canvas;
    if (this.skipDefaultRuntimeInJsdom) return;
    const generation = ++this.generation;
    window.addEventListener("resize", this.onResize);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    void this.start(canvas, generation);
  }

  update(snapshot: LobbySnapshot): void {
    this.latestSnapshot = snapshot;
    this.runtime?.update(snapshot);
  }

  predictMovement(axisX: number, axisZ: number, sequence: number): void {
    if (this.runtime) {
      this.runtime.predictMovement(axisX, axisZ, sequence);
      return;
    }
    this.queuedPrediction.push({ axisX, axisZ, sequence });
    if (this.queuedPrediction.length > 32) this.queuedPrediction.shift();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    window.removeEventListener("resize", this.onResize);
    this.canvas?.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas?.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.runtime?.destroy();
    this.runtime = undefined;
    this.canvas?.remove();
    this.canvas = undefined;
    if (this.container) {
      delete this.container.dataset.renderer;
      delete this.container.dataset.rendererState;
    }
    this.container = undefined;
  }

  private async start(
    canvas: HTMLCanvasElement,
    generation: number,
  ): Promise<void> {
    let startedRuntime: BabylonRuntime | undefined;
    try {
      const runtime = await this.runtimeFactory(canvas, {
        reducedMotion: this.reducedMotion,
      });
      if (this.destroyed || generation !== this.generation) {
        runtime.destroy();
        return;
      }
      startedRuntime = runtime;
      this.runtime = runtime;
      if (this.latestSnapshot) runtime.update(this.latestSnapshot);
      for (const prediction of this.queuedPrediction) {
        runtime.predictMovement(
          prediction.axisX,
          prediction.axisZ,
          prediction.sequence,
        );
      }
      this.queuedPrediction.length = 0;
      runtime.resize();
      runtime.render();
      await withTimeout(runtime.whenReady(), this.readinessTimeoutMs);
      if (this.destroyed || generation !== this.generation) return;
      if (this.container) this.container.dataset.rendererState = "ready";
    } catch (error) {
      if (this.destroyed || generation !== this.generation) return;
      if (startedRuntime && this.runtime === startedRuntime) {
        this.runtime = undefined;
        startedRuntime.destroy();
      }
      if (this.container) this.container.dataset.rendererState = "unavailable";
      const detail: KitchenRendererErrorDetail = {
        renderer: "babylon",
        category: error instanceof RendererReadinessTimeoutError ? "timeout" : "failure",
        reason: error instanceof Error ? error.message : "Unknown Babylon renderer failure",
      };
      canvas.dispatchEvent(new CustomEvent<KitchenRendererErrorDetail>(
        "kitchenrenderererror",
        { bubbles: true, detail },
      ));
    }
  }

  private readonly onResize = (): void => {
    this.runtime?.resize();
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.container) this.container.dataset.rendererState = "context-lost";
  };

  private readonly onContextRestored = (): void => {
    if (!this.runtime || !this.container || this.destroyed) return;
    this.runtime.restoreContext();
    this.container.dataset.rendererState = "ready";
  };
}

class RendererReadinessTimeoutError extends Error {}

function withTimeout(readiness: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new RendererReadinessTimeoutError(
        `Babylon scene did not render within ${timeoutMs} ms`,
      ));
    }, timeoutMs);
    readiness.then(
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function defaultRuntimeFactory(
  canvas: HTMLCanvasElement,
  options: { readonly reducedMotion: boolean },
): Promise<BabylonRuntime> {
  const { createBabylonKitchenRuntime } = await import("./BabylonKitchenScene.js");
  return createBabylonKitchenRuntime(canvas, options);
}
