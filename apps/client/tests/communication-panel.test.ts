// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { CommunicationEvent, PlayerRole, VoiceRelayEnvelope } from "@cooking-game/shared";
import { CommunicationPanel, type VoiceController } from "../src/ui/CommunicationPanel.js";
import type { LobbyConnection, LobbySnapshot, VoiceSignalIntent } from "../src/network/RoomClient.js";

describe("CommunicationPanel", () => {
  beforeEach(() => document.body.replaceChildren());

  test.each(["BLIND_COOK", "RECIPE_KEEPER", "DEAF_KITCHEN_GUIDE"] as const)("%s gets only finite gesture and emote controls", (role) => {
    const { root, connection } = mount(role);
    expect(root.querySelectorAll("[data-gesture]")).toHaveLength(5);
    expect(root.querySelectorAll("[data-emote]")).toHaveLength(4);
    expect(root.querySelectorAll("input, textarea, [contenteditable=true]")).toHaveLength(0);
    root.querySelector<HTMLButtonElement>('[data-gesture="NOD"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-emote="READY"]')!.click();
    expect(connection.sendGesture).toHaveBeenCalledWith("NOD");
    expect(connection.sendEmote).toHaveBeenCalledWith("READY");
  });

  test("Recipe Keeper alone can send cards, draw pointer strokes, and clear", () => {
    const { root, connection } = mount("RECIPE_KEEPER");
    expect(root.querySelectorAll("[data-card]")).toHaveLength(9);
    expect(root.querySelector("canvas[data-drawing-board]")).not.toBeNull();
    expect(root.querySelector("[data-clear-drawing]")).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-card="CHOP"]')!.click();
    expect(connection.sendRecipeCard).toHaveBeenCalledWith("CHOP");
    root.querySelector<HTMLButtonElement>("[data-clear-drawing]")!.click();
    expect(connection.clearDrawing).toHaveBeenCalled();

    const canvas = root.querySelector<HTMLCanvasElement>("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120, x: 10, y: 20, toJSON: () => ({}) });
    canvas.dispatchEvent(pointer("pointerdown", 10, 20));
    canvas.dispatchEvent(pointer("pointermove", 210, 120));
    canvas.dispatchEvent(pointer("pointerup", 210, 120));
    expect(connection.sendDrawingStroke).toHaveBeenCalledWith("BLACK", "MEDIUM", [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  test("editable drawing cancellation and lost capture discard an in-progress stroke", () => {
    for (const cancellation of ["pointercancel", "lostpointercapture"]) {
      const { root, connection } = mount("RECIPE_KEEPER");
      const canvas = root.querySelector<HTMLCanvasElement>('canvas[data-drawing-board][data-editable="true"]')!;
      vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
      canvas.dispatchEvent(pointer("pointerdown", 10, 10));
      canvas.dispatchEvent(pointer("pointermove", 100, 50));
      canvas.dispatchEvent(pointer(cancellation, 100, 50));
      canvas.dispatchEvent(pointer("pointerup", 190, 90));

      expect(connection.sendDrawingStroke).not.toHaveBeenCalled();
    }
  });

  test("timer-only snapshots preserve the interactive drawing canvas", () => {
    const { root, connection, voice } = mount("RECIPE_KEEPER");
    const canvas = root.querySelector<HTMLCanvasElement>("canvas[data-drawing-board]")!;
    voice.configure.mockClear();

    connection.emit(snapshot("RECIPE_KEEPER", { roundStatus: "RUNNING", remainingMs: 299_000 }));
    const afterFirstTimer = root.querySelector<HTMLCanvasElement>("canvas[data-drawing-board]")!;
    connection.emit(snapshot("RECIPE_KEEPER", { roundStatus: "RUNNING", remainingMs: 298_000 }));

    expect(afterFirstTimer).toBe(canvas);
    expect(root.querySelector("canvas[data-drawing-board]")).toBe(canvas);
    expect(voice.configure).not.toHaveBeenCalled();
  });

  test("Deaf sees visual feed/board without Recipe controls; Blind renders neither", () => {
    const deaf = mount("DEAF_KITCHEN_GUIDE");
    deaf.connection.emit(snapshot("DEAF_KITCHEN_GUIDE", { communicationFeed: [cardEvent("<img src=x onerror=evil>")], drawingStrokes: [] }));
    expect(deaf.root.querySelector("[data-communication-feed]")?.textContent).toContain("CHOP");
    expect(deaf.root.querySelector("img")).toBeNull();
    expect(deaf.root.querySelector("canvas[data-drawing-board]")).not.toBeNull();
    expect(deaf.root.querySelectorAll("[data-card], [data-clear-drawing]")).toHaveLength(0);

    const blind = mount("BLIND_COOK");
    blind.connection.emit(snapshot("BLIND_COOK", { communicationFeed: [cardEvent("recipe")], drawingStrokes: [] }));
    expect(blind.root.querySelector("[data-communication-feed], [data-visual-signal-stage], canvas[data-drawing-board], [data-card]")).toBeNull();
  });

  test("visual recipients get bounded motion, emote, and point indicators with object highlighting", () => {
    const object = document.createElement("li");
    object.dataset.objectId = "ingredient-1";
    document.body.append(object);
    const deaf = mount("DEAF_KITCHEN_GUIDE");
    const base = { senderId: "blind", senderRole: "BLIND_COOK" as const, timestamp: 1 };

    deaf.connection.emit(snapshot("DEAF_KITCHEN_GUIDE", { communicationFeed: [{ ...base, sequence: 1, kind: "GESTURE", gesture: "NOD" }] }));
    expect(deaf.root.querySelector("[data-head-motion]")?.classList.contains("head-motion--nod")).toBe(true);
    deaf.connection.emit(snapshot("DEAF_KITCHEN_GUIDE", { communicationFeed: [{ ...base, sequence: 2, kind: "EMOTE", emote: "URGENT" }] }));
    expect(deaf.root.querySelector("[data-emote-indicator]")?.textContent).toBe("Urgent 🚨");
    deaf.connection.emit(snapshot("DEAF_KITCHEN_GUIDE", { communicationFeed: [{ ...base, sequence: 3, kind: "POINT", target: { kind: "OBJECT", objectId: "ingredient-1" } }] }));
    expect(deaf.root.querySelector("[data-point-marker]")?.getAttribute("data-point-object")).toBe("ingredient-1");
    expect(object.classList.contains("visual-point-target")).toBe(true);
    deaf.connection.emit(snapshot("DEAF_KITCHEN_GUIDE", { communicationFeed: [{ ...base, sequence: 4, kind: "POINT", target: { kind: "COORDINATE", x: 50, y: 30 } }] }));
    expect(deaf.root.querySelector("[data-point-marker]")?.getAttribute("data-point-x")).toBe("50");
    expect(object.classList.contains("visual-point-target")).toBe(false);
    expect(deaf.root.querySelectorAll("[data-head-motion], [data-emote-indicator], [data-point-marker]")).toHaveLength(1);
  });

  test("reapplies the current point highlight when authoritative object rows are replaced", () => {
    const original = document.createElement("li");
    original.dataset.objectId = "ingredient-1";
    document.body.append(original);
    const deaf = mount("DEAF_KITCHEN_GUIDE");
    const point = {
      senderId: "blind",
      senderRole: "BLIND_COOK" as const,
      sequence: 1,
      timestamp: 1,
      kind: "POINT" as const,
      target: { kind: "OBJECT" as const, objectId: "ingredient-1" },
    };
    deaf.connection.emit(snapshot("DEAF_KITCHEN_GUIDE", {
      communicationFeed: [point],
      objects: [{ id: "ingredient-1", kind: "TOMATO", label: "Tomato", x: 24, y: 18, preparation: "RAW", location: "COUNTER" }],
    }));
    expect(original.classList.contains("visual-point-target")).toBe(true);

    const replacement = document.createElement("li");
    replacement.dataset.objectId = "ingredient-1";
    original.replaceWith(replacement);
    deaf.connection.emit(snapshot("DEAF_KITCHEN_GUIDE", {
      communicationFeed: [point],
      objects: [{ id: "ingredient-1", kind: "TOMATO", label: "Tomato", x: 24, y: 18, preparation: "CHOPPED", location: "COUNTER" }],
    }));

    expect(replacement.classList.contains("visual-point-target")).toBe(true);
  });

  test("renders a malicious object point as inert literal data without creating markup", () => {
    const malicious = '<img src=x onerror="globalThis.evil=true">';
    const object = document.createElement("li");
    object.dataset.objectId = malicious;
    document.body.append(object);
    const deaf = mount("DEAF_KITCHEN_GUIDE");
    deaf.connection.emit(snapshot("DEAF_KITCHEN_GUIDE", { communicationFeed: [{
      senderId: "blind",
      senderRole: "BLIND_COOK",
      sequence: 1,
      timestamp: 1,
      kind: "POINT",
      target: { kind: "OBJECT", objectId: malicious },
    }] }));
    expect(deaf.root.querySelector("[data-point-marker]")?.getAttribute("data-point-object")).toBe(malicious);
    expect(deaf.root.querySelector("[data-point-marker]")?.textContent).toBe("Pointing at kitchen object");
    expect(deaf.root.querySelectorAll("img, script")).toHaveLength(0);
    expect(object.classList.contains("visual-point-target")).toBe(true);
  });

  test.each([
    ["BLIND_COOK", "Microphone on · Voice output on", true],
    ["RECIPE_KEEPER", "Microphone off · Voice output on", true],
    ["DEAF_KITCHEN_GUIDE", "Microphone off · Voice output off", false],
  ] as const)("%s renders its exact grant and user-gesture enable", async (role, policy, canEnable) => {
    const { root, voice } = mount(role);
    expect(root.querySelector("[data-voice-policy]")?.textContent).toBe(policy);
    expect(root.querySelector("[data-voice-stream-count]")?.textContent).toBe("Remote streams: 0");
    expect(voice.configure).toHaveBeenCalledWith("room", role, expect.any(Object), expect.any(Array), true);
    const enable = root.querySelector<HTMLButtonElement>("[data-enable-voice]");
    expect(enable !== null).toBe(canEnable);
    enable?.click();
    if (canEnable) await vi.waitFor(() => expect(voice.enable).toHaveBeenCalled());
    else expect(voice.enable).not.toHaveBeenCalled();
  });

  test("enabled voice renders a disable control and reconnect suspends without revoking opt-in", () => {
    const { root, voice, connection } = mount("BLIND_COOK", "ENABLED");
    voice.disable.mockClear();
    root.querySelector<HTMLButtonElement>("[data-disable-voice]")!.click();
    expect(voice.disable).toHaveBeenCalledTimes(1);
    voice.disable.mockClear();
    connection.emit({ connectionStatus: "RECONNECTING", roomId: "room", sessionId: "BLIND_COOK", role: "BLIND_COOK" });
    expect(voice.suspend).toHaveBeenCalledTimes(1);
    expect(voice.disable).not.toHaveBeenCalled();
    connection.emit({ connectionStatus: "DISCONNECTED" });
    expect(voice.disable).toHaveBeenCalledTimes(1);
  });
});

function mount(role: PlayerRole, voiceStatus: "DISABLED" | "ENABLED" = "DISABLED") {
  const root = document.createElement("section");
  document.body.append(root);
  const connection = new FakeConnection();
  const voice = new FakeVoice();
  voice.status = voiceStatus;
  new CommunicationPanel(root, connection, () => voice).mount();
  connection.emit(snapshot(role));
  return { root, connection, voice };
}
function snapshot(role: PlayerRole, extra: Partial<LobbySnapshot> = {}): LobbySnapshot {
  const grants = {
    BLIND_COOK: { canPublish: true, canReceive: true },
    RECIPE_KEEPER: { canPublish: false, canReceive: true },
    DEAF_KITCHEN_GUIDE: { canPublish: false, canReceive: false },
  } as const;
  return { connectionStatus: "CONNECTED", roomId: "room", sessionId: role, role, connectedCount: 3, roomStatus: "READY", players: [{ id: role, role }], voiceGrant: grants[role], ...extra };
}
function cardEvent(senderId: string): CommunicationEvent {
  return { kind: "RECIPE_CARD", card: "CHOP", senderId, senderRole: "RECIPE_KEEPER", sequence: 1, timestamp: 1 };
}
function pointer(type: string, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}
class FakeVoice implements VoiceController {
  status: "DISABLED" | "ENABLED" = "DISABLED";
  remoteStreamCount = 0;
  configure = vi.fn(); enable = vi.fn(async () => true); disable = vi.fn(); suspend = vi.fn(); handleRelay = vi.fn(async () => undefined);
  subscribe = vi.fn((listener: (status: "DISABLED" | "ENABLED") => void) => { listener(this.status); return () => undefined; });
}
class FakeConnection implements LobbyConnection {
  create = vi.fn(async () => undefined); join = vi.fn(async () => undefined); resume = vi.fn(async () => false);
  pickUp = vi.fn(); drop = vi.fn(); sendGesture = vi.fn(); sendEmote = vi.fn(); sendRecipeCard = vi.fn(); sendDrawingStroke = vi.fn(); clearDrawing = vi.fn(); sendVoiceSignal = vi.fn((_signal: VoiceSignalIntent) => undefined);
  private listener?: (snapshot: LobbySnapshot) => void;
  subscribe(listener: (snapshot: LobbySnapshot) => void): () => void { this.listener = listener; listener({ connectionStatus: "DISCONNECTED" }); return () => undefined; }
  subscribeVoice(_listener: (relay: VoiceRelayEnvelope) => void): () => void { return () => undefined; }
  emit(value: LobbySnapshot): void { this.listener?.(value); }
}
