// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

import { OrientationGate, type OrientationEnvironment } from "../src/ui/OrientationGate.js";

describe("OrientationGate", () => {
  beforeEach(() => document.body.replaceChildren());

  test("touch-capable portrait renders accessible rotate guidance and makes the app inert", () => {
    const root = document.createElement("main");
    root.id = "app";
    document.body.append(root);

    new OrientationGate(root, environment({ touch: true, portrait: true })).mount();

    const gate = document.querySelector<HTMLElement>("[data-orientation-gate]");
    expect(gate).not.toBeNull();
    expect(gate?.getAttribute("role")).toBe("dialog");
    expect(gate?.textContent).toContain("Rotate your device");
    expect(gate?.querySelector("button")).not.toBeNull();
    expect(document.activeElement).toBe(gate?.querySelector("button"));
    expect(root.hasAttribute("inert")).toBe(true);
  });

  test("a portrait media-query change to landscape removes the gate and inert state", () => {
    const root = document.createElement("main");
    document.body.append(root);
    const previousFocus = document.createElement("button");
    root.append(previousFocus);
    previousFocus.focus();
    const portrait = mediaQuery(true);
    new OrientationGate(root, {
      touchQuery: mediaQuery(true),
      portraitQuery: portrait,
      requestFullscreen: vi.fn(async () => undefined),
    }).mount();

    Object.defineProperty(portrait, "matches", { value: false, configurable: true });
    const change = vi.mocked(portrait.addEventListener).mock.calls.find(([name]) => name === "change")?.[1];
    expect(change).toBeTypeOf("function");
    (change as EventListener)(new Event("change"));

    expect(document.querySelector("[data-orientation-gate]")).toBeNull();
    expect(root.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(previousFocus);
  });

  test("desktop portrait remains usable and ungated", () => {
    const root = document.createElement("main");
    document.body.append(root);

    new OrientationGate(root, environment({ touch: false, portrait: true })).mount();

    expect(document.querySelector("[data-orientation-gate]")).toBeNull();
    expect(root.hasAttribute("inert")).toBe(false);
  });

  test("fullscreen and then landscape lock run only after button activation", async () => {
    const root = document.createElement("main");
    document.body.append(root);
    const calls: string[] = [];
    const requestFullscreen = vi.fn(async () => { calls.push("fullscreen"); });
    const lockLandscape = vi.fn(async () => { calls.push("lock"); });
    new OrientationGate(root, {
      touchQuery: mediaQuery(true),
      portraitQuery: mediaQuery(true),
      requestFullscreen,
      lockLandscape,
    }).mount();

    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(lockLandscape).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>("[data-orientation-gate] button")!.click();
    await vi.waitFor(() => expect(lockLandscape).toHaveBeenCalledOnce());

    expect(calls).toEqual(["fullscreen", "lock"]);
  });

  test("missing and rejected fullscreen APIs show bounded fallback guidance", async () => {
    const root = document.createElement("main");
    document.body.append(root);
    new OrientationGate(root, {
      touchQuery: mediaQuery(true),
      portraitQuery: mediaQuery(true),
    }).mount();
    document.querySelector<HTMLButtonElement>("[data-orientation-gate] button")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-orientation-gate]")?.textContent).toContain("Rotate manually"),
    );

    document.body.replaceChildren(root);
    new OrientationGate(root, {
      touchQuery: mediaQuery(true),
      portraitQuery: mediaQuery(true),
      requestFullscreen: vi.fn(async () => { throw new Error("denied"); }),
    }).mount();
    document.querySelector<HTMLButtonElement>("[data-orientation-gate] button")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-orientation-gate]")?.textContent).toContain("Rotate manually"),
    );
  });

  test("destroy removes listeners, overlay, and inert state", () => {
    const root = document.createElement("main");
    document.body.append(root);
    const touch = mediaQuery(true);
    const portrait = mediaQuery(true);
    const gate = new OrientationGate(root, {
      touchQuery: touch,
      portraitQuery: portrait,
    });
    gate.mount();

    gate.destroy();

    expect(touch.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(portrait.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(document.querySelector("[data-orientation-gate]")).toBeNull();
    expect(root.hasAttribute("inert")).toBe(false);
  });
});

function environment({ touch, portrait }: { touch: boolean; portrait: boolean }): OrientationEnvironment {
  return {
    touchQuery: mediaQuery(touch),
    portraitQuery: mediaQuery(portrait),
    requestFullscreen: vi.fn(async () => undefined),
  };
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
