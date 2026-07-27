// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import {
  PlayerInputController,
  type PlayerInputEnvironment,
} from "../src/input/PlayerInputController.js";

describe("PlayerInputController", () => {
  test("normalizes keyboard/gamepad input and safely releases focus, visibility, and removed controllers", () => {
    let hidden = false;
    let modal = false;
    let gamepads: Array<Gamepad | null> = [];
    let frame: FrameRequestCallback | undefined;
    const environment: PlayerInputEnvironment = {
      eventTarget: window,
      visibilityTarget: document,
      isHidden: () => hidden,
      modalOwnsInput: () => modal,
      getGamepads: () => gamepads,
      requestFrame: (callback) => {
        frame = callback;
        return 1;
      },
      cancelFrame: () => {
        frame = undefined;
      },
    };
    const sink = {
      move: vi.fn(),
      interact: vi.fn(),
      pause: vi.fn(),
    };
    const controller = new PlayerInputController(sink, environment);
    const nextFrame = (): void => {
      const callback = frame!;
      frame = undefined;
      callback(0);
    };
    controller.mount();

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    expect(sink.move.mock.lastCall?.[0]).toBeCloseTo(Math.SQRT1_2);
    expect(sink.move.mock.lastCall?.[1]).toBeCloseTo(-Math.SQRT1_2);
    nextFrame();
    expect(sink.move.mock.lastCall?.[0]).toBeCloseTo(Math.SQRT1_2);
    expect(sink.move.mock.lastCall?.[1]).toBeCloseTo(-Math.SQRT1_2);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", repeat: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE" }));
    expect(sink.interact).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("blur"));
    expect(sink.move).toHaveBeenLastCalledWith(0, 0);
    modal = true;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(sink.move).toHaveBeenCalledTimes(3);
    modal = false;
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    expect(sink.move).toHaveBeenCalledTimes(3);
    input.remove();

    gamepads = [gamepad(0.1, -0.1, false, false)];
    nextFrame();
    expect(sink.move).toHaveBeenLastCalledWith(0, 0);
    gamepads = [gamepad(0.8, -0.8, true, true)];
    nextFrame();
    expect(sink.move.mock.lastCall?.[0]).toBeCloseTo(Math.SQRT1_2);
    expect(sink.move.mock.lastCall?.[1]).toBeCloseTo(-Math.SQRT1_2);
    expect(sink.interact).toHaveBeenCalledTimes(2);
    expect(sink.pause).toHaveBeenCalledTimes(1);
    nextFrame();
    expect(sink.interact).toHaveBeenCalledTimes(2);
    expect(sink.pause).toHaveBeenCalledTimes(1);

    gamepads = [];
    nextFrame();
    expect(sink.move).toHaveBeenLastCalledWith(0, 0);

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sink.move).toHaveBeenLastCalledWith(0, 0);
    controller.destroy();
  });
});

function gamepad(
  axisX: number,
  axisZ: number,
  primaryPressed: boolean,
  menuPressed: boolean,
): Gamepad {
  const buttons = Array.from({ length: 10 }, () => ({ pressed: false, touched: false, value: 0 }));
  buttons[0] = { pressed: primaryPressed, touched: primaryPressed, value: Number(primaryPressed) };
  buttons[9] = { pressed: menuPressed, touched: menuPressed, value: Number(menuPressed) };
  return {
    axes: [axisX, axisZ],
    buttons,
    connected: true,
    id: "test-controller",
    index: 0,
    mapping: "standard",
    timestamp: 1,
    vibrationActuator: null,
  } as unknown as Gamepad;
}
