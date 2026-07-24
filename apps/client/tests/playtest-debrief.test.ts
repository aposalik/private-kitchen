// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";

import { PlaytestFeedbackStore } from "../src/playtest/PlaytestFeedback.js";
import { PlaytestDebrief } from "../src/ui/PlaytestDebrief.js";

describe("PlaytestDebrief", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test("is absent without an authoritative terminal context and visible for both outcomes", () => {
    const { debrief, root } = setup();

    debrief.render();
    expect(root.querySelector("[data-playtest-debrief]")).toBeNull();

    debrief.render(context("WON", "round-1"));
    expect(root.querySelector("[data-playtest-debrief]")?.textContent).toContain("Round won");

    debrief.render();
    debrief.render(context("LOST", "round-2"));
    expect(root.querySelector("[data-playtest-debrief]")?.textContent).toContain("Round lost");
  });

  test("uses accessible required structured controls and has no free-text input", () => {
    const { debrief, root } = setup();
    debrief.render(context("WON", "round-1"));

    expect(root.querySelectorAll("fieldset legend")).toHaveLength(5);
    expect(root.querySelectorAll("select[required]")).toHaveLength(4);
    expect(root.querySelectorAll('input[type="checkbox"][name="misunderstoodSignals"]')).toHaveLength(7);
    expect(root.querySelectorAll('textarea, input[type="text"], input:not([type])')).toHaveLength(0);
    expect(root.querySelector("[data-feedback-confirmation]")?.getAttribute("aria-live")).toBe("polite");
  });

  test("rejects incomplete input, stores one sanitized record, and prevents duplicate submission", () => {
    const { debrief, root, store } = setup();
    debrief.render(context("WON", "round-1"));

    root.querySelector<HTMLButtonElement>("[data-feedback-submit]")!.click();
    expect(store.read()).toEqual([]);
    expect(root.querySelector("[data-feedback-confirmation]")?.textContent).toContain("Complete");

    select(root, "participationRating", "4");
    select(root, "communicationClarity", "5");
    select(root, "frustration", "2");
    select(root, "replayIntent", "YES");
    root.querySelector<HTMLInputElement>('[value="GESTURE"]')!.checked = true;
    root.querySelector<HTMLButtonElement>("[data-feedback-submit]")!.click();

    expect(store.read()).toEqual([expect.objectContaining({
      schemaVersion: 1,
      role: "DEAF_KITCHEN_GUIDE",
      roundOutcome: "WON",
      completedSteps: 10,
      totalSteps: 10,
      observedDurationSeconds: 187,
      participationRating: 4,
      communicationClarity: 5,
      frustration: 2,
      replayIntent: "YES",
      misunderstoodSignals: ["GESTURE"],
    })]);
    expect(root.querySelector("[data-feedback-confirmation]")?.textContent).toContain("saved locally");
    expect(root.querySelector<HTMLButtonElement>("[data-feedback-submit]")!.disabled).toBe(true);
    root.querySelector<HTMLButtonElement>("[data-feedback-submit]")!.click();
    expect(store.read()).toHaveLength(1);
  });

  test("exports deterministic JSON and clears only after the explicit clear button", () => {
    let exported = "";
    const { debrief, root, store } = setup((json) => {
      exported = json;
    });
    store.append({
      schemaVersion: 1,
      role: "BLIND_COOK",
      roundOutcome: "LOST",
      completedSteps: 3,
      totalSteps: 10,
      observedDurationSeconds: 300,
      participationRating: 3,
      communicationClarity: 2,
      frustration: 4,
      replayIntent: "MAYBE",
      misunderstoodSignals: ["NONE"],
    });
    debrief.render(context("LOST", "round-1"));

    expect(store.read()).toHaveLength(1);
    root.querySelector<HTMLButtonElement>("[data-feedback-export]")!.click();
    expect(exported).toBe(store.exportJson());
    expect(store.read()).toHaveLength(1);

    root.querySelector<HTMLButtonElement>("[data-feedback-clear]")!.click();
    expect(store.read()).toEqual([]);
    expect(root.querySelector("[data-feedback-confirmation]")?.textContent).toContain("cleared");
  });

  test("reports unavailable storage without crashing or marking the round submitted", () => {
    const root = document.createElement("section");
    document.body.append(root);
    const debrief = new PlaytestDebrief(
      root,
      new PlaytestFeedbackStore(new ThrowingStorage()),
      () => undefined,
    );
    debrief.render(context("WON", "round-storage-failure"));
    select(root, "participationRating", "4");
    select(root, "communicationClarity", "4");
    select(root, "frustration", "2");
    select(root, "replayIntent", "YES");
    root.querySelector<HTMLInputElement>('[value="NONE"]')!.checked = true;

    expect(() => root.querySelector<HTMLButtonElement>("[data-feedback-submit]")!.click())
      .not.toThrow();
    expect(root.querySelector("[data-feedback-confirmation]")?.textContent)
      .toContain("could not be saved");
    expect(root.querySelector<HTMLButtonElement>("[data-feedback-submit]")!.disabled)
      .toBe(false);
  });
});

function setup(exporter?: (json: string) => void) {
  const root = document.createElement("section");
  document.body.append(root);
  const storage = new MemoryStorage();
  const store = new PlaytestFeedbackStore(storage, () => "2026-07-23T10:00:00.000Z");
  const debrief = new PlaytestDebrief(root, store, exporter);
  return { debrief, root, store };
}

function context(roundOutcome: "WON" | "LOST", observationId: string) {
  return {
    observationId,
    role: "DEAF_KITCHEN_GUIDE" as const,
    roundOutcome,
    completedSteps: roundOutcome === "WON" ? 10 : 4,
    totalSteps: 10,
    observedDurationSeconds: 187,
  };
}

function select(root: HTMLElement, name: string, value: string): void {
  root.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!.value = value;
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class ThrowingStorage implements Storage {
  get length(): number { throw new DOMException("Storage denied", "SecurityError"); }
  clear(): void { throw new DOMException("Storage denied", "SecurityError"); }
  getItem(): string | null { throw new DOMException("Storage denied", "SecurityError"); }
  key(): string | null { throw new DOMException("Storage denied", "SecurityError"); }
  removeItem(): void { throw new DOMException("Storage denied", "SecurityError"); }
  setItem(): void { throw new DOMException("Storage denied", "SecurityError"); }
}
