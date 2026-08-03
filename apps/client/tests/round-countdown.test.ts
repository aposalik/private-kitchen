// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { RoundCountdown } from "../src/ui/RoundCountdown.js";

describe("RoundCountdown", () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.replaceChildren(container);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("is hidden before start() is called", () => {
    const cd = new RoundCountdown(container);
    cd.mount();
    expect(container.querySelector<HTMLElement>("[data-round-countdown]")!.hidden).toBe(true);
  });

  test("shows countdown overlay with digit 3 immediately after start()", () => {
    const cd = new RoundCountdown(container);
    cd.mount();
    cd.start();
    const overlay = container.querySelector<HTMLElement>("[data-round-countdown]")!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.querySelector<HTMLElement>("[data-countdown-digit]")!.textContent).toBe("3");
  });

  test("advances to 2 after 1 second", () => {
    const cd = new RoundCountdown(container);
    cd.mount();
    cd.start();
    vi.advanceTimersByTime(1000);
    const digit = container.querySelector<HTMLElement>("[data-countdown-digit]")!;
    expect(digit.textContent).toBe("2");
  });

  test("advances to 1 after 2 seconds", () => {
    const cd = new RoundCountdown(container);
    cd.mount();
    cd.start();
    vi.advanceTimersByTime(2000);
    expect(container.querySelector<HTMLElement>("[data-countdown-digit]")!.textContent).toBe("1");
  });

  test("hides overlay after 3 seconds", () => {
    const cd = new RoundCountdown(container);
    cd.mount();
    cd.start();
    vi.advanceTimersByTime(3000);
    expect(container.querySelector<HTMLElement>("[data-round-countdown]")!.hidden).toBe(true);
  });

  test("does not start a second countdown if already counting", () => {
    const cd = new RoundCountdown(container);
    cd.mount();
    cd.start();
    vi.advanceTimersByTime(500);
    cd.start();
    expect(container.querySelector<HTMLElement>("[data-countdown-digit]")!.textContent).toBe("3");
    vi.advanceTimersByTime(500);
    expect(container.querySelector<HTMLElement>("[data-countdown-digit]")!.textContent).toBe("2");
  });

  test("destroy() hides the overlay and stops ticks", () => {
    const cd = new RoundCountdown(container);
    cd.mount();
    cd.start();
    cd.destroy();
    expect(container.querySelector<HTMLElement>("[data-round-countdown]")!.hidden).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(container.querySelector<HTMLElement>("[data-round-countdown]")!.hidden).toBe(true);
  });


});
