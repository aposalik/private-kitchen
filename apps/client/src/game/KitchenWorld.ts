import type { LobbySnapshot } from "../network/RoomClient.js";

export interface KitchenWorldAdapter {
  mount(container: HTMLElement): void;
  update(snapshot: LobbySnapshot): void;
  destroy(): void;
}

export class PhaserKitchenWorld implements KitchenWorldAdapter {
  private container: HTMLElement | undefined;
  private latestSnapshot: LobbySnapshot | undefined;
  private game: import("phaser").Game | undefined;
  private scene: import("./scenes/KitchenScene.js").KitchenScene | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private loading = false;
  private destroyed = false;

  mount(container: HTMLElement): void {
    if (this.container || this.destroyed) return;
    this.container = container;
    if (navigator.userAgent.includes("jsdom")) return;
    this.loading = true;
    void this.start();
  }

  update(snapshot: LobbySnapshot): void {
    this.latestSnapshot = snapshot;
    this.scene?.setSnapshot(snapshot);
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.game?.destroy(true);
    this.game = undefined;
    this.scene = undefined;
    this.container = undefined;
  }

  private async start(): Promise<void> {
    const container = this.container;
    if (!container || this.destroyed || !this.loading) return;
    const [{ default: Phaser }, { KitchenScene }] = await Promise.all([
      import("phaser"),
      import("./scenes/KitchenScene.js"),
    ]);
    if (this.destroyed || this.container !== container) return;

    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches ?? false;
    const scene = new KitchenScene(reducedMotion);
    this.scene = scene;
    this.game = new Phaser.Game({
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
    if (this.latestSnapshot) scene.setSnapshot(this.latestSnapshot);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.game || !this.container) return;
        this.game.scale.resize(
          Math.max(this.container.clientWidth, 320),
          Math.max(this.container.clientHeight, 240),
        );
      });
      this.resizeObserver.observe(container);
    }
    this.loading = false;
  }
}
