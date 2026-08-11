// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MATCHMAKING_MESSAGES } from "@cooking-game/shared";
import { MatchmakingLobby } from "../src/ui/MatchmakingLobby.js";

// ---------------------------------------------------------------------------
// Mock @colyseus/sdk
// vi.mock is hoisted before imports, so state that the factory closes over
// must be created with vi.hoisted().
// ---------------------------------------------------------------------------

const mockRoom = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: unknown) => void>,
  leaveHandlers: [] as Array<() => void>,
  sent: [] as string[],
  shouldFail: false,
}));

vi.mock("@colyseus/sdk", () => ({
  // Must be a regular function — arrow functions cannot be used with `new`.
  Client: vi.fn(function MockClient() {
    return {
      joinOrCreate: vi.fn().mockImplementation(async () => {
        if (mockRoom.shouldFail) throw new Error("connection refused");
        return {
          onMessage: (type: string, cb: (e: unknown) => void) => {
            mockRoom.handlers[type] = cb;
          },
          onLeave: (cb: () => void) => {
            mockRoom.leaveHandlers.push(cb);
          },
          send: (type: string) => {
            mockRoom.sent.push(type);
          },
          leave: vi.fn().mockResolvedValue(undefined),
        };
      }),
    };
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function triggerServerEvent(event: unknown): void {
  mockRoom.handlers[MATCHMAKING_MESSAGES.event]?.(event);
}

function btn(root: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button "${label}" not found in DOM`);
  return found;
}

async function clickFindMatch(root: HTMLElement): Promise<void> {
  btn(root, "Find Match").click();
  // startSearch() is async: the sync phase-change happens immediately, but we
  // need two microtask ticks for joinOrCreate to resolve and register handlers.
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("MatchmakingLobby", () => {
  let root: HTMLElement;
  let onMatch: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;
  let lobby: MatchmakingLobby;

  beforeEach(() => {
    vi.useFakeTimers();

    // Reset mock room state between tests
    mockRoom.handlers = {};
    mockRoom.leaveHandlers = [];
    mockRoom.sent = [];
    mockRoom.shouldFail = false;

    root = document.createElement("div");
    document.body.replaceChildren(root);
    onMatch = vi.fn();
    onCancel = vi.fn();

    lobby = new MatchmakingLobby(root, {
      endpoint: "ws://localhost:2567",
      displayName: "Test Player",
      characterId: "Rabbit_Blond",
      onMatch,
      onCancel,
    });
    lobby.mount();
  });

  afterEach(() => {
    lobby.unmount();
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------

  test("mount renders Quick Match heading with region and role selects", () => {
    expect(root.querySelector("h2")?.textContent).toBe("Quick Match");
    const selects = root.querySelectorAll("select");
    expect(selects.length).toBe(2);
    expect(root.querySelector("button")?.textContent).toBeTruthy();
  });

  test("clicking Find Match immediately shows Finding players... phase", () => {
    btn(root, "Find Match").click();
    // Phase change + render happens synchronously before the first await
    expect(root.querySelector("h2")?.textContent).toBe("Finding players...");
    expect(root.querySelector(".mm-spinner")).toBeTruthy();
  });

  test("READY_CHECK event transitions to ready-check phase with assigned role", async () => {
    await clickFindMatch(root);

    triggerServerEvent({
      type: "READY_CHECK",
      timeoutMs: 15_000,
      matchId: "match-1",
      assignedRole: "BLIND_COOK",
    });

    expect(root.querySelector("h2")?.textContent).toBe("Match found!");
    expect(root.querySelector("p")?.textContent).toContain("BLIND COOK");
    expect(root.querySelector("[data-mm-timer]")).toBeTruthy();
    expect(btn(root, "Accept")).toBeTruthy();
    expect(btn(root, "Decline")).toBeTruthy();
  });

  test("clicking Accept sends readyConfirm, hides buttons, and shows Waiting for others...", async () => {
    await clickFindMatch(root);

    triggerServerEvent({
      type: "READY_CHECK",
      timeoutMs: 15_000,
      matchId: "m1",
      assignedRole: "RECIPE_KEEPER",
    });

    btn(root, "Accept").click();

    expect(mockRoom.sent).toContain(MATCHMAKING_MESSAGES.readyConfirm);
    expect(root.querySelectorAll("button").length).toBe(0);
    expect(root.querySelector("h2")?.textContent).toBe("Waiting for others...");
  });

  test("MATCH_READY event calls onMatch with roomId, ticket, displayName and characterId", async () => {
    await clickFindMatch(root);

    triggerServerEvent({
      type: "MATCH_READY",
      roomId: "room-abc123",
      ticket: "ticket-xyz789",
    });

    expect(onMatch).toHaveBeenCalledOnce();
    expect(onMatch).toHaveBeenCalledWith({
      roomId: "room-abc123",
      ticket: "ticket-xyz789",
      displayName: "Test Player",
      characterId: "Rabbit_Blond",
    });
  });

  test("MATCH_CANCELLED with requeued:true keeps SEARCHING phase", async () => {
    await clickFindMatch(root);

    triggerServerEvent({
      type: "READY_CHECK",
      timeoutMs: 15_000,
      matchId: "m1",
      assignedRole: "BLIND_COOK",
    });

    triggerServerEvent({ type: "MATCH_CANCELLED", reason: "DECLINED", requeued: true });

    expect(root.querySelector("h2")?.textContent).toBe("Finding players...");
  });

  test("MATCH_CANCELLED with requeued:false returns to PREFERENCES phase", async () => {
    await clickFindMatch(root);

    triggerServerEvent({ type: "MATCH_CANCELLED", reason: "DECLINED", requeued: false });

    expect(root.querySelector("h2")?.textContent).toBe("Quick Match");
    expect(btn(root, "Find Match")).toBeTruthy();
  });

  test("PENALTY_ACTIVE event shows penalty phase with remaining time", async () => {
    await clickFindMatch(root);

    triggerServerEvent({ type: "PENALTY_ACTIVE", remainingMs: 60_000 });

    expect(root.querySelector("h2")?.textContent).toBe("Penalty active");
    const penaltyEl = root.querySelector("[data-mm-penalty]");
    expect(penaltyEl).toBeTruthy();
    expect(penaltyEl?.textContent).toContain("60s");
  });

  test("clicking Decline sends readyDecline and immediately shows penalty phase", async () => {
    await clickFindMatch(root);

    triggerServerEvent({
      type: "READY_CHECK",
      timeoutMs: 15_000,
      matchId: "m1",
      assignedRole: "DEAF_KITCHEN_GUIDE",
    });

    btn(root, "Decline").click();

    expect(mockRoom.sent).toContain(MATCHMAKING_MESSAGES.readyDecline);
    expect(root.querySelector("h2")?.textContent).toBe("Penalty active");
  });

  test("connection failure falls back to PREFERENCES phase", async () => {
    mockRoom.shouldFail = true;

    btn(root, "Find Match").click();
    // Phase shows SEARCHING immediately
    expect(root.querySelector("h2")?.textContent).toBe("Finding players...");

    // After the rejected promise resolves, the catch block runs
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector("h2")?.textContent).toBe("Quick Match");
    expect(btn(root, "Find Match")).toBeTruthy();
  });

  test("clicking Cancel during search returns to PREFERENCES phase", async () => {
    await clickFindMatch(root);

    btn(root, "Cancel").click();

    expect(root.querySelector("h2")?.textContent).toBe("Quick Match");
  });

  test("ready-check countdown timer updates every 500 ms via setInterval", async () => {
    await clickFindMatch(root);

    triggerServerEvent({
      type: "READY_CHECK",
      timeoutMs: 10_000,
      matchId: "m1",
      assignedRole: "BLIND_COOK",
    });

    const initialText = root.querySelector("[data-mm-timer]")?.textContent ?? "";
    expect(initialText).toContain("10s");

    vi.advanceTimersByTime(1_000);

    const updatedText = root.querySelector("[data-mm-timer]")?.textContent ?? "";
    expect(updatedText).toContain("9s");
  });
});
