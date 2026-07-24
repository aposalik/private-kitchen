// @vitest-environment jsdom
import { describe, expect, test } from "vitest";

import {
  PLAYTEST_FEEDBACK_KEY,
  PlaytestFeedbackStore,
  validatePlaytestRecord,
  type PlaytestRecordInput,
} from "../src/playtest/PlaytestFeedback.js";

describe("PlaytestFeedbackStore", () => {
  test("accepts only the strict structured record and deterministically exports it", () => {
    const storage = new MemoryStorage();
    const store = new PlaytestFeedbackStore(storage, () => "2026-07-23T10:00:00.000Z");

    store.append(validInput());

    expect(store.read()).toEqual([{
      ...validInput(),
      timestamp: "2026-07-23T10:00:00.000Z",
    }]);
    expect(store.exportJson()).toBe(`${JSON.stringify(store.read(), null, 2)}\n`);
    const exportedRecord = JSON.parse(store.exportJson())[0] as Record<string, unknown>;
    for (const forbidden of [
      "displayName", "accountId", "roomId", "sessionId", "ip",
      "freeText", "audio", "drawing",
    ]) {
      expect(exportedRecord).not.toHaveProperty(forbidden);
    }
  });

  test.each([
    { schemaVersion: 2 },
    { participationRating: 0 },
    { communicationClarity: 6 },
    { frustration: 1.5 },
    { replayIntent: "LATER" },
    { observedDurationSeconds: -1 },
    { completedSteps: 11 },
    { misunderstoodSignals: ["NONE", "POINT"] },
    { misunderstoodSignals: ["TEXT"] },
    { displayName: "Private Player" },
    { freeText: "I disliked this" },
  ])("rejects malformed, out-of-range, or extra data %#", (override) => {
    expect(() => validatePlaytestRecord({
      ...validInput(),
      timestamp: "2026-07-23T10:00:00.000Z",
      ...override,
    })).toThrow();
  });

  test("caps storage at the newest 30 records", () => {
    const storage = new MemoryStorage();
    let second = 0;
    const store = new PlaytestFeedbackStore(
      storage,
      () => `2026-07-23T10:00:${String(second++).padStart(2, "0")}.000Z`,
    );

    for (let index = 0; index < 35; index += 1) {
      store.append({ ...validInput(), completedSteps: index % 11 });
    }

    expect(store.read()).toHaveLength(30);
    expect(store.read()[0]?.timestamp).toBe("2026-07-23T10:00:05.000Z");
    expect(store.read()[29]?.timestamp).toBe("2026-07-23T10:00:34.000Z");
  });

  test("malformed existing storage never crashes or escapes into export", () => {
    const storage = new MemoryStorage();
    storage.setItem(PLAYTEST_FEEDBACK_KEY, "{not-json");
    const store = new PlaytestFeedbackStore(storage);

    expect(store.read()).toEqual([]);
    expect(store.exportJson()).toBe("[]\n");

    storage.setItem(PLAYTEST_FEEDBACK_KEY, JSON.stringify([{ roomId: "secret" }]));
    expect(store.read()).toEqual([]);
  });

  test("clear removes only the Phase 7 key", () => {
    const storage = new MemoryStorage();
    storage.setItem("account-preference", "keep");
    const store = new PlaytestFeedbackStore(storage);
    store.append(validInput());

    store.clear();

    expect(storage.getItem(PLAYTEST_FEEDBACK_KEY)).toBeNull();
    expect(storage.getItem("account-preference")).toBe("keep");
  });

  test("treats unavailable storage reads as empty evidence", () => {
    const store = new PlaytestFeedbackStore(new ThrowingStorage());

    expect(store.read()).toEqual([]);
    expect(store.exportJson()).toBe("[]\n");
  });
});

function validInput(): PlaytestRecordInput {
  return {
    schemaVersion: 1,
    role: "BLIND_COOK",
    roundOutcome: "WON",
    completedSteps: 10,
    totalSteps: 10,
    observedDurationSeconds: 185,
    participationRating: 4,
    communicationClarity: 5,
    frustration: 2,
    replayIntent: "YES",
    misunderstoodSignals: ["GESTURE", "VOICE"],
  };
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage implements Storage {
  get length(): number { throw new DOMException("Storage denied", "SecurityError"); }
  clear(): void { throw new DOMException("Storage denied", "SecurityError"); }
  getItem(): string | null { throw new DOMException("Storage denied", "SecurityError"); }
  key(): string | null { throw new DOMException("Storage denied", "SecurityError"); }
  removeItem(): void { throw new DOMException("Storage denied", "SecurityError"); }
  setItem(): void { throw new DOMException("Storage denied", "SecurityError"); }
}
