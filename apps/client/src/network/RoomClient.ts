import { Client } from "@colyseus/sdk";

import {
  KITCHEN_MESSAGES,
  KITCHEN_ROOM_NAME,
  type InteractionErrorPayload,
  type KitchenObjectKind,
  type KitchenRoomState,
  type PlayerRole,
  type RoomStatus,
} from "@cooking-game/shared";

export type ConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING";

export interface LobbySnapshot {
  connectionStatus: ConnectionStatus;
  roomId?: string;
  role?: PlayerRole;
  connectedCount?: number;
  roomStatus?: RoomStatus;
  objects?: readonly LobbyObjectSnapshot[];
  interactionError?: string;
}

export interface LobbyObjectSnapshot {
  id: string;
  kind: KitchenObjectKind;
  label: string;
  x: number;
  y: number;
  heldBy?: string;
  heldByMe?: boolean;
}

export interface LobbyConnection {
  create(displayName: string): Promise<void>;
  join(roomId: string, displayName: string): Promise<void>;
  resume(): Promise<boolean>;
  pickUp(objectId: string): void;
  drop(objectId: string, x: number, y: number): void;
  subscribe(listener: (snapshot: LobbySnapshot) => void): () => void;
}

export interface RoomClientRoom {
  readonly roomId: string;
  readonly sessionId: string;
  readonly reconnectionToken: string;
  readonly reconnection: { isReconnecting: boolean };
  state: KitchenRoomState;
  onStateChange(listener: () => void): void;
  onMessage(
    type: string,
    listener: (payload: InteractionErrorPayload) => void,
  ): void;
  onDrop(listener: () => void): void;
  onReconnect(listener: () => void): void;
  onLeave(listener: () => void): void;
  onError(listener: () => void): void;
  send(type: string, payload: unknown): void;
  leave(): Promise<number>;
}

export interface RoomClientTransport {
  create(
    roomName: string,
    options: { displayName: string },
  ): Promise<RoomClientRoom>;
  joinById(
    roomId: string,
    options: { displayName: string },
  ): Promise<RoomClientRoom>;
  reconnect(token: string): Promise<RoomClientRoom>;
}

export interface RoomClientStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface RoomClientOptions {
  transport: RoomClientTransport;
  storage: RoomClientStorage;
}

const RECONNECTION_TOKEN_KEY = "kitchen.reconnectionToken";

export class RoomClient implements LobbyConnection {
  private readonly transport: RoomClientTransport;
  private readonly storage: RoomClientStorage;
  private room: RoomClientRoom | undefined;
  private operation: Promise<unknown> | undefined;
  private readonly listeners = new Set<(snapshot: LobbySnapshot) => void>();
  private interactionError: string | undefined;

  constructor(endpointOrOptions: string | RoomClientOptions = defaultEndpoint()) {
    if (typeof endpointOrOptions === "string") {
      const client = new Client(endpointOrOptions);
      this.transport = {
        create: (roomName, options) =>
          client.create<KitchenRoomState>(roomName, options),
        joinById: (roomId, options) =>
          client.joinById<KitchenRoomState>(roomId, options),
        reconnect: (token) => client.reconnect<KitchenRoomState>(token),
      };
      this.storage = sessionStorage;
    } else {
      this.transport = endpointOrOptions.transport;
      this.storage = endpointOrOptions.storage;
    }
  }

  create(displayName: string): Promise<void> {
    return this.startConnection(() =>
      this.transport.create(KITCHEN_ROOM_NAME, { displayName }),
    );
  }

  join(roomId: string, displayName: string): Promise<void> {
    return this.startConnection(() =>
      this.transport.joinById(roomId.trim(), { displayName }),
    );
  }

  resume(): Promise<boolean> {
    const token = this.storage.getItem(RECONNECTION_TOKEN_KEY);
    if (!token || this.room || this.operation) {
      return Promise.resolve(false);
    }

    const operation = this.resumeToken(token);
    this.track(operation);
    return operation;
  }

  subscribe(listener: (snapshot: LobbySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot("DISCONNECTED"));
    return () => this.listeners.delete(listener);
  }

  pickUp(objectId: string): void {
    this.interactionError = undefined;
    this.room?.send(KITCHEN_MESSAGES.pickUp, { objectId });
  }

  drop(objectId: string, x: number, y: number): void {
    this.interactionError = undefined;
    this.room?.send(KITCHEN_MESSAGES.drop, { objectId, x, y });
  }

  private async resumeToken(token: string): Promise<boolean> {
    this.emit({ connectionStatus: "RECONNECTING" });
    let reconnectedRoom: RoomClientRoom | undefined;
    try {
      reconnectedRoom = await this.transport.reconnect(token);
      await this.attach(reconnectedRoom);
      return true;
    } catch {
      if (!reconnectedRoom || this.room === reconnectedRoom) {
        this.room = undefined;
        this.storage.removeItem(RECONNECTION_TOKEN_KEY);
        this.emit({ connectionStatus: "DISCONNECTED" });
      }
      return false;
    }
  }

  private attach(room: RoomClientRoom): Promise<void> {
    this.room = room;
    this.interactionError = undefined;
    this.storage.setItem(RECONNECTION_TOKEN_KEY, room.reconnectionToken);

    return new Promise<void>((resolve, reject) => {
      let ready = false;

      const isCurrent = (): boolean => this.room === room;
      const onStateChange = (): void => {
        if (!isCurrent()) {
          return;
        }
        if (!room.state?.players?.get(room.sessionId)) {
          return;
        }

        this.emit(this.snapshot("CONNECTED"));
        if (!ready) {
          ready = true;
          resolve();
        }
      };
      const disconnect = (message: string): void => {
        if (!isCurrent() || room.reconnection.isReconnecting) {
          return;
        }

        this.room = undefined;
        this.storage.removeItem(RECONNECTION_TOKEN_KEY);
        this.emit({ connectionStatus: "DISCONNECTED" });
        if (!ready) {
          reject(new Error(message));
        }
      };

      room.onStateChange(onStateChange);
      room.onMessage(
        KITCHEN_MESSAGES.interactionError,
        (payload: InteractionErrorPayload) => {
          if (!isCurrent()) {
            return;
          }
          this.interactionError = payload.message;
          this.emit(this.snapshot("CONNECTED"));
        },
      );
      room.onDrop(() => {
        if (isCurrent()) {
          this.emit(this.snapshot("RECONNECTING"));
        }
      });
      room.onReconnect(() => {
        if (isCurrent()) {
          this.storage.setItem(RECONNECTION_TOKEN_KEY, room.reconnectionToken);
          onStateChange();
        }
      });
      room.onLeave(() => disconnect("Room left before initial state"));
      room.onError(() => disconnect("Room error before initial state"));

      onStateChange();
    });
  }

  private snapshot(connectionStatus: ConnectionStatus): LobbySnapshot {
    if (!this.room) {
      return { connectionStatus };
    }

    const state = this.room.state;
    const player = state?.players?.get(this.room.sessionId);
    const objects = state?.objects
      ? Array.from(state.objects.values(), (object) => ({
          id: object.id,
          kind: object.kind,
          label: object.label,
          x: object.x,
          y: object.y,
          ...(object.heldBy ? { heldBy: object.heldBy } : {}),
          ...(object.heldBy === this.room?.sessionId ? { heldByMe: true } : {}),
        }))
      : [];
    return {
      connectionStatus,
      roomId: this.room.roomId,
      ...(player ? { role: player.role } : {}),
      ...(typeof state?.connectedCount === "number"
        ? { connectedCount: state.connectedCount }
        : {}),
      ...(state?.status ? { roomStatus: state.status } : {}),
      objects,
      ...(this.interactionError ? { interactionError: this.interactionError } : {}),
    };
  }

  private startConnection(
    joinRoom: () => Promise<RoomClientRoom>,
  ): Promise<void> {
    if (this.room || this.operation) {
      return Promise.resolve();
    }

    const operation = this.connect(joinRoom);
    this.track(operation);
    return operation;
  }

  private async connect(
    joinRoom: () => Promise<RoomClientRoom>,
  ): Promise<void> {
    this.emit({ connectionStatus: "CONNECTING" });
    let joinedRoom: RoomClientRoom | undefined;
    try {
      joinedRoom = await joinRoom();
      await this.attach(joinedRoom);
    } catch (error) {
      if (!joinedRoom) {
        this.emit({ connectionStatus: "DISCONNECTED" });
      } else if (this.room === joinedRoom) {
        this.room = undefined;
        this.storage.removeItem(RECONNECTION_TOKEN_KEY);
        this.emit({ connectionStatus: "DISCONNECTED" });
      }
      throw error;
    }
  }

  private track(operation: Promise<unknown>): void {
    this.operation = operation;
    void operation.then(
      () => {
        if (this.operation === operation) {
          this.operation = undefined;
        }
      },
      () => {
        if (this.operation === operation) {
          this.operation = undefined;
        }
      },
    );
  }

  private emit(snapshot: LobbySnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function defaultEndpoint(): string {
  if (import.meta.env.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL;
  }
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:2567`;
}
