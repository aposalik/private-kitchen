import { afterEach, describe, expect, test, vi } from "vitest";

import { consumeTicket, createTicket } from "../src/rooms/ticketStore.js";

describe("ticketStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("createTicket returns a non-empty string id", () => {
    const id = createTicket("BLIND_COOK");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("consumeTicket returns the stored role for a valid ticket", () => {
    const id = createTicket("RECIPE_KEEPER");
    expect(consumeTicket(id)).toBe("RECIPE_KEEPER");
  });

  test("consumeTicket deletes the ticket after first consumption", () => {
    const id = createTicket("DEAF_KITCHEN_GUIDE");
    consumeTicket(id);
    expect(consumeTicket(id)).toBeUndefined();
  });

  test("consumeTicket returns undefined for an unknown id", () => {
    expect(consumeTicket("no-such-ticket-id")).toBeUndefined();
  });

  test("consumeTicket returns undefined for an expired ticket", () => {
    vi.useFakeTimers();
    const id = createTicket("BLIND_COOK", 1_000);
    vi.advanceTimersByTime(1_001);
    expect(consumeTicket(id)).toBeUndefined();
  });

  test("a ticket consumed just before expiry is still valid", () => {
    vi.useFakeTimers();
    const id = createTicket("RECIPE_KEEPER", 1_000);
    vi.advanceTimersByTime(999);
    expect(consumeTicket(id)).toBe("RECIPE_KEEPER");
  });

  test("createTicket produces distinct ids across many calls", () => {
    const ids = Array.from({ length: 50 }, () => createTicket("BLIND_COOK"));
    expect(new Set(ids).size).toBe(50);
  });
});
