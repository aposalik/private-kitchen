import { GAMEPAD_DEAD_ZONE } from "@cooking-game/shared";

export interface PlayerInputSink {
  move(axisX: number, axisZ: number): void;
  interact(): void;
  pause(): void;
}

export interface PlayerInputEnvironment {
  readonly eventTarget: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly visibilityTarget: Pick<Document, "addEventListener" | "removeEventListener">;
  isHidden(): boolean;
  modalOwnsInput(): boolean;
  getGamepads(): readonly (Gamepad | null)[];
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

const MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

export class PlayerInputController {
  private readonly pressedKeys = new Set<string>();
  private frameHandle: number | undefined;
  private mounted = false;
  private activeGamepadIndex: number | undefined;
  private primaryPressed = false;
  private menuPressed = false;
  private lastAxisX = 0;
  private lastAxisZ = 0;

  constructor(
    private readonly sink: PlayerInputSink,
    private readonly environment: PlayerInputEnvironment = browserEnvironment(),
  ) {}

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.environment.eventTarget.addEventListener("keydown", this.onKeyDown);
    this.environment.eventTarget.addEventListener("keyup", this.onKeyUp);
    this.environment.eventTarget.addEventListener("blur", this.onBlur);
    this.environment.visibilityTarget.addEventListener("visibilitychange", this.onVisibilityChange);
    this.scheduleFrame();
  }

  destroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.environment.eventTarget.removeEventListener("keydown", this.onKeyDown);
    this.environment.eventTarget.removeEventListener("keyup", this.onKeyUp);
    this.environment.eventTarget.removeEventListener("blur", this.onBlur);
    this.environment.visibilityTarget.removeEventListener("visibilitychange", this.onVisibilityChange);
    if (this.frameHandle !== undefined) this.environment.cancelFrame(this.frameHandle);
    this.frameHandle = undefined;
    this.releaseMovement();
    this.activeGamepadIndex = undefined;
    this.primaryPressed = false;
    this.menuPressed = false;
  }

  private readonly onKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.code === "Escape" && !keyboardEvent.repeat) {
      this.sink.pause();
      return;
    }
    if (this.uiOwnsInput(keyboardEvent.target)) return;
    if (keyboardEvent.code === "KeyE") {
      if (!keyboardEvent.repeat) this.sink.interact();
      return;
    }
    if (!MOVEMENT_KEYS.has(keyboardEvent.code)) return;
    this.pressedKeys.add(keyboardEvent.code);
    this.publishKeyboardMovement();
  };

  private readonly onKeyUp = (event: Event): void => {
    const code = (event as KeyboardEvent).code;
    if (!MOVEMENT_KEYS.has(code)) return;
    this.pressedKeys.delete(code);
    this.publishKeyboardMovement();
  };

  private readonly onBlur = (): void => {
    this.releaseMovement();
  };

  private readonly onVisibilityChange = (): void => {
    if (this.environment.isHidden()) this.releaseMovement();
  };

  private readonly pollGamepads = (): void => {
    if (!this.mounted) return;
    const pads = this.environment.getGamepads();
    let gamepad = this.activeGamepadIndex === undefined
      ? undefined
      : pads[this.activeGamepadIndex] ?? undefined;
    if (!gamepad?.connected) {
      gamepad = pads.find((candidate): candidate is Gamepad => Boolean(candidate?.connected));
      this.activeGamepadIndex = gamepad?.index;
      this.primaryPressed = false;
      this.menuPressed = false;
      if (!gamepad) this.publishKeyboardMovement();
    }

    if (gamepad) {
      const blocked = this.uiOwnsInput();
      const primary = Boolean(gamepad.buttons[0]?.pressed);
      const menu = Boolean(gamepad.buttons[9]?.pressed);
      if (!blocked && primary && !this.primaryPressed) this.sink.interact();
      if (menu && !this.menuPressed) this.sink.pause();
      this.primaryPressed = primary;
      this.menuPressed = menu;
      if (blocked) {
        this.publishMovement(0, 0);
      } else if (this.pressedKeys.size > 0) {
        this.publishKeyboardMovement();
      } else {
        const axisX = applyDeadZone(gamepad.axes[0] ?? 0);
        const axisZ = applyDeadZone(gamepad.axes[1] ?? 0);
        const normalized = normalizeAxes(axisX, axisZ);
        this.publishMovement(normalized.axisX, normalized.axisZ);
      }
    }
    this.scheduleFrame();
  };

  private publishKeyboardMovement(): void {
    if (this.uiOwnsInput()) {
      this.releaseMovement();
      return;
    }
    const axisX = Number(this.pressedKeys.has("KeyD")) - Number(this.pressedKeys.has("KeyA"));
    const axisZ = Number(this.pressedKeys.has("KeyS")) - Number(this.pressedKeys.has("KeyW"));
    const normalized = normalizeAxes(axisX, axisZ);
    this.publishMovement(normalized.axisX, normalized.axisZ);
  }

  private publishMovement(axisX: number, axisZ: number): void {
    if (axisX === this.lastAxisX && axisZ === this.lastAxisZ) return;
    this.lastAxisX = axisX;
    this.lastAxisZ = axisZ;
    this.sink.move(axisX, axisZ);
  }

  private releaseMovement(): void {
    this.pressedKeys.clear();
    this.publishMovement(0, 0);
  }

  private uiOwnsInput(target?: EventTarget | null): boolean {
    if (this.environment.isHidden() || this.environment.modalOwnsInput()) return true;
    const element = target instanceof Element ? target : document.activeElement;
    return element instanceof HTMLElement && (
      element.isContentEditable
      || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
    );
  }

  private scheduleFrame(): void {
    if (this.mounted) this.frameHandle = this.environment.requestFrame(this.pollGamepads);
  }
}

function normalizeAxes(axisX: number, axisZ: number): { axisX: number; axisZ: number } {
  const magnitude = Math.hypot(axisX, axisZ);
  if (!Number.isFinite(magnitude) || magnitude === 0) return { axisX: 0, axisZ: 0 };
  if (magnitude <= 1) return { axisX, axisZ };
  return { axisX: axisX / magnitude, axisZ: axisZ / magnitude };
}

function applyDeadZone(value: number): number {
  return Number.isFinite(value) && Math.abs(value) > GAMEPAD_DEAD_ZONE ? value : 0;
}

function browserEnvironment(): PlayerInputEnvironment {
  return {
    eventTarget: window,
    visibilityTarget: document,
    isHidden: () => document.hidden,
    modalOwnsInput: () => Boolean(
      document.querySelector('dialog[open], [aria-modal="true"]:not([hidden]), [data-input-modal]:not([hidden])'),
    ),
    getGamepads: () => navigator.getGamepads?.() ?? [],
    requestFrame: (callback) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(callback)
        : 0,
    cancelFrame: (handle) => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
    },
  };
}
