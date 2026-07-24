export interface OrientationEnvironment {
  readonly touchQuery: MediaQueryList;
  readonly portraitQuery: MediaQueryList;
  readonly requestFullscreen?: () => Promise<void>;
  readonly lockLandscape?: () => Promise<void>;
}

export class OrientationGate {
  private gate: HTMLElement | undefined;
  private previousFocus: HTMLElement | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly environment: OrientationEnvironment = browserEnvironment(),
  ) {}

  mount(): void {
    this.environment.touchQuery.addEventListener("change", this.update);
    this.environment.portraitQuery.addEventListener("change", this.update);
    this.update();
  }

  destroy(): void {
    this.environment.touchQuery.removeEventListener("change", this.update);
    this.environment.portraitQuery.removeEventListener("change", this.update);
    this.hide();
  }

  private readonly update = (): void => {
    if (!this.environment.touchQuery.matches || !this.environment.portraitQuery.matches) {
      this.hide();
      return;
    }
    if (this.gate) return;
    const gate = document.createElement("section");
    gate.dataset.orientationGate = "";
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-labelledby", "orientation-gate-title");

    const title = document.createElement("h1");
    title.id = "orientation-gate-title";
    title.textContent = "Rotate your device";
    const guidance = document.createElement("p");
    guidance.textContent = "This kitchen is designed for landscape play.";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Use landscape";
    button.addEventListener("click", () => void this.requestLandscape());
    const status = document.createElement("p");
    status.dataset.orientationStatus = "";
    status.setAttribute("role", "status");
    gate.append(title, guidance, button, status);

    const active = document.activeElement;
    this.previousFocus = active instanceof HTMLElement && this.root.contains(active)
      ? active
      : undefined;
    this.root.setAttribute("inert", "");
    document.body.append(gate);
    this.gate = gate;
    button.focus();
  };

  private hide(): void {
    if (!this.gate) return;
    this.gate.remove();
    this.gate = undefined;
    this.root.removeAttribute("inert");
    const previousFocus = this.previousFocus;
    this.previousFocus = undefined;
    if (previousFocus?.isConnected) previousFocus.focus();
  }

  private async requestLandscape(): Promise<void> {
    try {
      if (!this.environment.requestFullscreen) throw new Error("unsupported");
      await this.environment.requestFullscreen();
      await this.environment.lockLandscape?.();
    } catch {
      const status = this.gate?.querySelector<HTMLElement>("[data-orientation-status]");
      if (status) status.textContent = "Rotate manually to continue; fullscreen is optional.";
    }
  }
}

function browserEnvironment(): OrientationEnvironment {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: "landscape") => Promise<void>;
  };
  return {
    touchQuery: window.matchMedia("(any-pointer: coarse)"),
    portraitQuery: window.matchMedia("(orientation: portrait)"),
    ...(document.documentElement.requestFullscreen
      ? { requestFullscreen: () => document.documentElement.requestFullscreen().then(() => undefined) }
      : {}),
    ...(orientation?.lock
      ? { lockLandscape: () => orientation.lock!("landscape") }
      : {}),
  };
}
