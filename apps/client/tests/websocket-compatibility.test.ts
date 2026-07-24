// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import { installWebSocketCompatibility } from "../src/platform/WebSocketCompatibility.js";

describe("installWebSocketCompatibility", () => {
  test("rejects non-standard object protocols synchronously so SDK browser fallback runs", () => {
    const calls: unknown[][] = [];
    class NativeWebSocket {
      static readonly OPEN = 1;
      constructor(...args: unknown[]) { calls.push(args); }
    }
    const host = { WebSocket: NativeWebSocket as unknown as typeof WebSocket };

    installWebSocketCompatibility(host);

    expect(() => new host.WebSocket("ws://localhost:2567", { headers: {} } as never)).toThrow(TypeError);
    const socket = new host.WebSocket("ws://localhost:2567", ["kitchen"]);
    expect(socket).toBeInstanceOf(NativeWebSocket);
    expect(calls).toEqual([["ws://localhost:2567", ["kitchen"]]]);
    expect(host.WebSocket.OPEN).toBe(1);
  });

  test("is idempotent", () => {
    class NativeWebSocket {}
    const host = { WebSocket: NativeWebSocket as unknown as typeof WebSocket };
    installWebSocketCompatibility(host);
    const installed = host.WebSocket;

    installWebSocketCompatibility(host);

    expect(host.WebSocket).toBe(installed);
  });
});
