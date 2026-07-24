// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

import { TouchControls, type TouchEnvironment } from "../src/input/TouchControls.js";

describe("TouchControls", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-touch-capable");
    document.documentElement.removeAttribute("data-input-mode");
  });

  test("coarse pointer or maxTouchPoints sets a stable touch-capable marker", () => {
    const coarse = mediaQuery(false);
    new TouchControls(document.documentElement, environment(coarse, 2)).mount();

    expect(document.documentElement.dataset.touchCapable).toBe("true");
  });

  test.each(["touch", "pen", "mouse"] as const)("pointerdown records %s mode without preventing native behavior", (pointerType) => {
    new TouchControls(document.documentElement, environment(mediaQuery(true))).mount();
    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "pointerType", { value: pointerType });

    window.dispatchEvent(event);

    expect(document.documentElement.dataset.inputMode).toBe(pointerType);
    expect(event.defaultPrevented).toBe(false);
  });

  test("keyboard navigation records keyboard mode and preserves default behavior", () => {
    new TouchControls(document.documentElement, environment(mediaQuery(false))).mount();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });

    window.dispatchEvent(event);

    expect(document.documentElement.dataset.inputMode).toBe("keyboard");
    expect(event.defaultPrevented).toBe(false);
  });

  test("coarse-pointer media changes update touch capability", () => {
    const coarse = mediaQuery(false);
    new TouchControls(document.documentElement, environment(coarse)).mount();
    expect(document.documentElement.dataset.touchCapable).toBe("false");

    Object.defineProperty(coarse, "matches", { value: true, configurable: true });
    const change = vi.mocked(coarse.addEventListener).mock.calls.find(([name]) => name === "change")?.[1];
    expect(change).toBeTypeOf("function");
    (change as EventListener)(new Event("change"));

    expect(document.documentElement.dataset.touchCapable).toBe("true");
  });

  test("destroy removes listeners and input markers", () => {
    const coarse = mediaQuery(true);
    const eventTarget = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as TouchEnvironment["eventTarget"];
    const controls = new TouchControls(document.documentElement, {
      coarseQuery: coarse,
      maxTouchPoints: 1,
      eventTarget,
    });
    controls.mount();
    document.documentElement.dataset.inputMode = "touch";

    controls.destroy();

    expect(eventTarget.removeEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(eventTarget.removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(coarse.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(document.documentElement.hasAttribute("data-touch-capable")).toBe(false);
    expect(document.documentElement.hasAttribute("data-input-mode")).toBe(false);
  });
});

function environment(coarseQuery: MediaQueryList, maxTouchPoints = 0): TouchEnvironment {
  return { coarseQuery, maxTouchPoints, eventTarget: window };
}

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}
