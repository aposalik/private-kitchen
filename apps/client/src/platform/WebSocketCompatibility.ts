export interface WebSocketHost {
  WebSocket: typeof WebSocket;
}

const installedConstructors = new WeakSet<object>();

export function installWebSocketCompatibility(
  host: WebSocketHost = globalThis as WebSocketHost,
): void {
  const NativeWebSocket = host.WebSocket;
  if (installedConstructors.has(NativeWebSocket)) return;

  const CompatibleWebSocket = function (
    url: string | URL,
    protocols?: string | string[],
  ): WebSocket {
    if (
      protocols !== undefined
      && typeof protocols === "object"
      && !Array.isArray(protocols)
    ) {
      throw new TypeError("WebSocket protocols must be a string or string array");
    }
    return protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
  } as unknown as typeof WebSocket;

  Object.setPrototypeOf(CompatibleWebSocket, NativeWebSocket);
  Object.defineProperty(CompatibleWebSocket, "prototype", {
    value: NativeWebSocket.prototype,
  });
  installedConstructors.add(CompatibleWebSocket);
  host.WebSocket = CompatibleWebSocket;
}
