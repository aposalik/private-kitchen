export interface TouchEnvironment {
  readonly coarseQuery: MediaQueryList;
  readonly maxTouchPoints: number;
  readonly eventTarget: Pick<Window, "addEventListener" | "removeEventListener">;
}

export class TouchControls {
  constructor(
    private readonly root: HTMLElement,
    private readonly environment: TouchEnvironment = browserEnvironment(),
  ) {}

  mount(): void {
    this.environment.eventTarget.addEventListener("pointerdown", this.onPointerDown);
    this.environment.eventTarget.addEventListener("keydown", this.onKeyDown);
    this.environment.coarseQuery.addEventListener("change", this.updateCapability);
    this.updateCapability();
  }

  destroy(): void {
    this.environment.eventTarget.removeEventListener("pointerdown", this.onPointerDown);
    this.environment.eventTarget.removeEventListener("keydown", this.onKeyDown);
    this.environment.coarseQuery.removeEventListener("change", this.updateCapability);
    delete this.root.dataset.touchCapable;
    delete this.root.dataset.inputMode;
  }

  private readonly onPointerDown = (event: Event): void => {
    const pointerType = (event as PointerEvent).pointerType;
    if (pointerType === "touch" || pointerType === "pen" || pointerType === "mouse") {
      this.root.dataset.inputMode = pointerType;
    }
  };

  private readonly onKeyDown = (): void => {
    this.root.dataset.inputMode = "keyboard";
  };

  private readonly updateCapability = (): void => {
    this.root.dataset.touchCapable = String(
      this.environment.coarseQuery.matches || this.environment.maxTouchPoints > 0,
    );
  };
}

function browserEnvironment(): TouchEnvironment {
  return {
    coarseQuery: window.matchMedia("(any-pointer: coarse)"),
    maxTouchPoints: navigator.maxTouchPoints,
    eventTarget: window,
  };
}
