import { Client } from "@colyseus/sdk";

import {
  COMMUNICATION_MESSAGES,
  DRAWING_COLORS,
  DRAWING_WIDTHS,
  EMOTES,
  GESTURES,
  INTERACTION_ERROR_CODES,
  KITCHEN_BOUNDS,
  KITCHEN_MESSAGES,
  KITCHEN_ROOM_NAME,
  MAX_ACTION_SEQUENCE,
  MAX_OBJECT_ID_LENGTH,
  RECIPE_CARDS,
  MAX_ICE_CANDIDATE_LENGTH,
  MAX_SDP_LENGTH,
  MAX_SIGNAL_ID_LENGTH,
  MAX_OBJECT_REFERENCE_LENGTH,
  VOICE_GRANTS,
  canReceiveVisual,
  cookingErrorSchema,
  isPlayerRole,
  privateRecipeSchema,
  type CommunicationEvent,
  type DrawingColor,
  type DrawingStroke,
  type DrawingWidth,
  type Emote,
  type Gesture,
  type InteractionErrorPayload,
  type KitchenObjectKind,
  type KitchenObjectLocation,
  type KitchenObjectPreparation,
  type KitchenRoomState,
  type PlayerRole,
  type PrivateRecipePayload,
  type RoundOutcomeReason,
  type RoundStatus,
  type RoomStatus,
  type RecipeCard,
  type VoiceGrant,
  type VoiceRelayEnvelope,
  type VoiceSignal,
} from "@cooking-game/shared";

export type ConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING";
export type VoiceSignalIntent = VoiceSignal extends infer Signal
  ? Signal extends { clientSequence: number }
    ? Omit<Signal, "clientSequence">
    : never
  : never;

export interface LobbySnapshot {
  connectionStatus: ConnectionStatus;
  roomId?: string;
  sessionId?: string;
  role?: PlayerRole;
  connectedCount?: number;
  roomStatus?: RoomStatus;
  roundStatus?: RoundStatus;
  remainingMs?: number;
  completedStepCount?: number;
  totalStepCount?: number;
  outcomeReason?: RoundOutcomeReason;
  objects?: readonly LobbyObjectSnapshot[];
  interactionError?: string;
  cookingError?: string;
  privateRecipe?: PrivateRecipePayload;
  communicationError?: string;
  communicationFeed?: readonly CommunicationEvent[];
  drawingStrokes?: readonly DrawingStroke[];
  voiceGrant?: VoiceGrant;
  players?: readonly { id: string; role: PlayerRole }[];
}

export interface LobbyObjectSnapshot {
  id: string;
  kind: KitchenObjectKind;
  label: string;
  x: number;
  y: number;
  heldBy?: string;
  heldByMe?: boolean;
  preparation: KitchenObjectPreparation;
  location: KitchenObjectLocation;
}

export interface LobbyConnection {
  create(displayName: string): Promise<void>;
  join(roomId: string, displayName: string): Promise<void>;
  resume(): Promise<boolean>;
  pickUp(objectId: string): void;
  drop(objectId: string, x: number, y: number): void;
  chop(objectId: string): void;
  addToPot(objectId: string): void;
  season(): void;
  boil(): void;
  mix(): void;
  plate(): void;
  pointAtObject(objectId: string): void;
  pointAtLocation(x: number, y: number): void;
  sendGesture(gesture: Gesture): void;
  sendEmote(emote: Emote): void;
  sendRecipeCard(card: RecipeCard): void;
  sendDrawingStroke(color: DrawingColor, width: DrawingWidth, points: readonly { x: number; y: number }[]): void;
  clearDrawing(): void;
  sendVoiceSignal(signal: VoiceSignalIntent): void;
  subscribeVoice(listener: (relay: VoiceRelayEnvelope) => void): () => void;
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
    listener: (payload: unknown) => void,
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
const COOKING_ACTION_SEQUENCE_KEY = "kitchen.cookingActionSequence";
const COMMUNICATION_SEQUENCE_KEY = "kitchen.communicationSequence";

export class RoomClient implements LobbyConnection {
  private readonly transport: RoomClientTransport;
  private readonly storage: RoomClientStorage;
  private room: RoomClientRoom | undefined;
  private operation: Promise<unknown> | undefined;
  private readonly listeners = new Set<(snapshot: LobbySnapshot) => void>();
  private interactionError: string | undefined;
  private cookingError: string | undefined;
  private privateRecipe: PrivateRecipePayload | undefined;
  private communicationError: string | undefined;
  private communicationFeed: CommunicationEvent[] = [];
  private drawingStrokes: DrawingStroke[] = [];
  private voiceGrant: VoiceGrant | undefined;
  private clientSequence = 0;
  private cookingActionSequence = 0;
  private readonly voiceListeners = new Set<(relay: VoiceRelayEnvelope) => void>();

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

    this.cookingActionSequence = parseStoredSequence(
      this.storage.getItem(COOKING_ACTION_SEQUENCE_KEY),
    );
    this.clientSequence = parseStoredSequence(
      this.storage.getItem(COMMUNICATION_SEQUENCE_KEY),
    );
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

  chop(objectId: string): void {
    this.sendObjectCookAction("CHOP", objectId);
  }

  addToPot(objectId: string): void {
    this.sendObjectCookAction("ADD_TO_POT", objectId);
  }

  season(): void { this.sendTerminalCookAction("SEASON"); }
  boil(): void { this.sendTerminalCookAction("BOIL"); }
  mix(): void { this.sendTerminalCookAction("MIX"); }
  plate(): void { this.sendTerminalCookAction("PLATE"); }

  pointAtObject(objectId: string): void {
    if (objectId.length < 1 || objectId.length > MAX_OBJECT_REFERENCE_LENGTH) return;
    this.send(COMMUNICATION_MESSAGES.signal, { kind: "POINT", target: { kind: "OBJECT", objectId } });
  }

  pointAtLocation(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < KITCHEN_BOUNDS.minX || x > KITCHEN_BOUNDS.maxX || y < KITCHEN_BOUNDS.minY || y > KITCHEN_BOUNDS.maxY) return;
    this.send(COMMUNICATION_MESSAGES.signal, { kind: "POINT", target: { kind: "COORDINATE", x, y } });
  }

  sendGesture(gesture: Gesture): void { this.send(COMMUNICATION_MESSAGES.signal, { kind: "GESTURE", gesture }); }
  sendEmote(emote: Emote): void { this.send(COMMUNICATION_MESSAGES.signal, { kind: "EMOTE", emote }); }
  sendRecipeCard(card: RecipeCard): void { this.send(COMMUNICATION_MESSAGES.recipeCard, { card }); }
  sendDrawingStroke(color: DrawingColor, width: DrawingWidth, points: readonly { x: number; y: number }[]): void {
    this.send(COMMUNICATION_MESSAGES.drawingStroke, { color, width, points: points.map((point) => ({ ...point })) });
  }
  clearDrawing(): void { this.send(COMMUNICATION_MESSAGES.drawingClear, {}); }
  sendVoiceSignal(signal: VoiceSignalIntent): void { this.send(COMMUNICATION_MESSAGES.voiceSignal, signal); }
  subscribeVoice(listener: (relay: VoiceRelayEnvelope) => void): () => void {
    this.voiceListeners.add(listener);
    return () => this.voiceListeners.delete(listener);
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
        this.clearCookingSequence();
        this.clearCommunicationSequence();
        this.emit({ connectionStatus: "DISCONNECTED" });
      }
      return false;
    }
  }

  private attach(room: RoomClientRoom): Promise<void> {
    this.room = room;
    this.interactionError = undefined;
    this.cookingError = undefined;
    this.privateRecipe = undefined;
    this.communicationError = undefined;
    this.communicationFeed = [];
    this.drawingStrokes = [];
    this.voiceGrant = undefined;
    this.storage.setItem(RECONNECTION_TOKEN_KEY, room.reconnectionToken);

    return new Promise<void>((resolve, reject) => {
      let ready = false;
      let bootstrapSent = false;
      let listenersAttached = false;

      const isCurrent = (): boolean => this.room === room;
      const requestBootstrap = (): void => {
        if (!listenersAttached || !isCurrent() || bootstrapSent || room.state?.status !== "READY" || !room.state.players?.get(room.sessionId)) return;
        bootstrapSent = true;
        room.send(COMMUNICATION_MESSAGES.ready, {});
        room.send(KITCHEN_MESSAGES.roundReady, {});
      };
      const onStateChange = (): void => {
        if (!isCurrent()) {
          return;
        }
        const currentPlayer = room.state?.players?.get(room.sessionId);
        if (currentPlayer?.role !== "RECIPE_KEEPER") {
          this.privateRecipe = undefined;
        }
        if (!currentPlayer) {
          return;
        }

        this.emit(this.snapshot("CONNECTED"));
        requestBootstrap();
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
        this.cookingError = undefined;
        this.privateRecipe = undefined;
        this.storage.removeItem(RECONNECTION_TOKEN_KEY);
        this.clearCookingSequence();
        this.clearCommunicationSequence();
        this.emit({ connectionStatus: "DISCONNECTED" });
        if (!ready) {
          reject(new Error(message));
        }
      };

      room.onStateChange(onStateChange);
      room.onMessage(
        KITCHEN_MESSAGES.interactionError,
        (payload: unknown) => {
          if (!isCurrent()) {
            return;
          }
          const error = parseInteractionError(payload);
          if (!error) return;
          this.interactionError = error.message;
          this.emit(this.snapshot("CONNECTED"));
        },
      );
      room.onMessage(KITCHEN_MESSAGES.privateRecipe, (payload: unknown) => {
        if (!isCurrent() || room.state?.players?.get(room.sessionId)?.role !== "RECIPE_KEEPER") return;
        const parsed = privateRecipeSchema.safeParse(payload);
        if (!parsed.success) return;
        this.privateRecipe = clonePrivateRecipe(parsed.data);
        this.emit(this.snapshot("CONNECTED"));
      });
      room.onMessage(KITCHEN_MESSAGES.cookingError, (payload: unknown) => {
        if (!isCurrent()) return;
        const parsed = cookingErrorSchema.safeParse(payload);
        if (!parsed.success) return;
        this.cookingError = parsed.data.message;
        this.emit(this.snapshot("CONNECTED"));
      });
      room.onMessage(COMMUNICATION_MESSAGES.voiceGrant, (payload) => {
        if (!isCurrent()) return;
        const role = room.state?.players?.get(room.sessionId)?.role;
        const grant = parseVoiceGrant(payload);
        if (!role || !grant || grant.canPublish !== VOICE_GRANTS[role].canPublish || grant.canReceive !== VOICE_GRANTS[role].canReceive) return;
        this.voiceGrant = grant;
        this.emit(this.snapshot("CONNECTED"));
      });
      room.onMessage(COMMUNICATION_MESSAGES.event, (payload) => {
        if (!isCurrent() || !this.currentCanSeeVisual()) return;
        const event = parseCommunicationEvent(payload);
        if (!event) return;
        if (event.kind === "DRAWING_CLEAR") this.drawingStrokes = [];
        this.communicationFeed = [...this.communicationFeed, event].slice(-24);
        this.emit(this.snapshot("CONNECTED"));
      });
      room.onMessage(COMMUNICATION_MESSAGES.drawingStroke, (payload) => {
        if (!isCurrent() || !this.currentCanSeeVisual()) return;
        const stroke = parseDrawingStroke(payload);
        if (!stroke) return;
        this.drawingStrokes = [...this.drawingStrokes, stroke].slice(-32);
        this.emit(this.snapshot("CONNECTED"));
      });
      room.onMessage(COMMUNICATION_MESSAGES.boardSnapshot, (payload) => {
        if (!isCurrent() || !this.currentCanSeeVisual()) return;
        const strokes = parseDrawingSnapshot(payload);
        if (!strokes) return;
        this.drawingStrokes = strokes;
        this.emit(this.snapshot("CONNECTED"));
      });
      room.onMessage(COMMUNICATION_MESSAGES.error, (payload) => {
        if (!isCurrent() || !isRecord(payload) || !hasExactKeys(payload, ["code", "message"]) || typeof payload.message !== "string") return;
        this.communicationError = payload.message;
        this.emit(this.snapshot("CONNECTED"));
      });
      room.onMessage(COMMUNICATION_MESSAGES.voiceRelay, (payload) => {
        if (!isCurrent()) return;
        const relay = parseVoiceRelay(payload);
        if (relay) for (const listener of this.voiceListeners) listener(relay);
      });
      room.onDrop(() => {
        if (isCurrent()) {
          bootstrapSent = false;
          this.emit(this.snapshot("RECONNECTING"));
        }
      });
      room.onReconnect(() => {
        if (isCurrent()) {
          bootstrapSent = false;
          this.storage.setItem(RECONNECTION_TOKEN_KEY, room.reconnectionToken);
          onStateChange();
        }
      });
      room.onLeave(() => disconnect("Room left before initial state"));
      room.onError(() => disconnect("Room error before initial state"));

      listenersAttached = true;
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
          preparation: object.preparation,
          location: object.location,
          ...(object.heldBy ? { heldBy: object.heldBy } : {}),
          ...(object.heldBy === this.room?.sessionId ? { heldByMe: true } : {}),
        }))
      : [];
    const role = player?.role;
    return {
      connectionStatus,
      roomId: this.room.roomId,
      sessionId: this.room.sessionId,
      ...(role ? { role } : {}),
      ...(typeof state?.connectedCount === "number"
        ? { connectedCount: state.connectedCount }
        : {}),
      ...(state?.status ? { roomStatus: state.status } : {}),
      ...(state?.roundStatus ? { roundStatus: state.roundStatus } : {}),
      ...(typeof state?.remainingMs === "number" ? { remainingMs: state.remainingMs } : {}),
      ...(typeof state?.completedStepCount === "number" ? { completedStepCount: state.completedStepCount } : {}),
      ...(typeof state?.totalStepCount === "number" ? { totalStepCount: state.totalStepCount } : {}),
      ...(state?.outcomeReason ? { outcomeReason: state.outcomeReason } : {}),
      objects,
      ...(state?.players ? { players: Array.from(state.players.values(), ({ id, role: playerRole }) => ({ id, role: playerRole })) } : {}),
      ...(this.interactionError ? { interactionError: this.interactionError } : {}),
      ...(this.cookingError ? { cookingError: this.cookingError } : {}),
      ...(role === "RECIPE_KEEPER" && this.privateRecipe
        ? { privateRecipe: clonePrivateRecipe(this.privateRecipe) }
        : {}),
      ...(this.communicationError ? { communicationError: this.communicationError } : {}),
      ...(role && canReceiveVisual(role) ? { communicationFeed: [...this.communicationFeed], drawingStrokes: [...this.drawingStrokes] } : {}),
      ...(this.voiceGrant ? { voiceGrant: { ...this.voiceGrant } } : {}),
    };
  }

  private startConnection(
    joinRoom: () => Promise<RoomClientRoom>,
  ): Promise<void> {
    if (this.room || this.operation) {
      return Promise.resolve();
    }

    this.clearCookingSequence();
    this.clearCommunicationSequence();
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
        this.clearCookingSequence();
        this.clearCommunicationSequence();
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

  private send(type: string, payload: Record<string, unknown>): void {
    if (!this.room || this.clientSequence >= MAX_ACTION_SEQUENCE) return;
    this.communicationError = undefined;
    this.clientSequence += 1;
    this.storage.setItem(COMMUNICATION_SEQUENCE_KEY, String(this.clientSequence));
    this.room.send(type, { clientSequence: this.clientSequence, ...payload });
  }

  private sendObjectCookAction(action: "CHOP" | "ADD_TO_POT", objectId: string): void {
    if (objectId.length < 1 || objectId.length > MAX_OBJECT_ID_LENGTH) return;
    this.sendCookAction({ action, objectId });
  }

  private sendTerminalCookAction(action: "SEASON" | "BOIL" | "MIX" | "PLATE"): void {
    this.sendCookAction({ action });
  }

  private sendCookAction(payload: { action: "CHOP" | "ADD_TO_POT"; objectId: string } | { action: "SEASON" | "BOIL" | "MIX" | "PLATE" }): void {
    if (!this.room || this.cookingActionSequence >= MAX_ACTION_SEQUENCE) return;
    this.cookingError = undefined;
    this.cookingActionSequence += 1;
    this.storage.setItem(COOKING_ACTION_SEQUENCE_KEY, String(this.cookingActionSequence));
    this.emit(this.snapshot("CONNECTED"));
    this.room.send(KITCHEN_MESSAGES.cookAction, {
      action: payload.action,
      actionSequence: this.cookingActionSequence,
      ...(payload.action === "CHOP" || payload.action === "ADD_TO_POT" ? { objectId: payload.objectId } : {}),
    });
  }

  private clearCookingSequence(): void {
    this.cookingActionSequence = 0;
    this.storage.removeItem(COOKING_ACTION_SEQUENCE_KEY);
  }

  private clearCommunicationSequence(): void {
    this.clientSequence = 0;
    this.storage.removeItem(COMMUNICATION_SEQUENCE_KEY);
  }

  private currentCanSeeVisual(): boolean {
    const role = this.room?.state?.players?.get(this.room.sessionId)?.role;
    return Boolean(role && canReceiveVisual(role));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}
function parseVoiceGrant(value: unknown): VoiceGrant | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["canPublish", "canReceive"]) || typeof value.canPublish !== "boolean" || typeof value.canReceive !== "boolean") return undefined;
  return { canPublish: value.canPublish, canReceive: value.canReceive };
}
function parseInteractionError(value: unknown): InteractionErrorPayload | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["code", "message"]) || !INTERACTION_ERROR_CODES.includes(value.code as InteractionErrorPayload["code"]) || typeof value.message !== "string") return undefined;
  return { code: value.code as InteractionErrorPayload["code"], message: value.message };
}
function validEnvelope(value: Record<string, unknown>): boolean {
  return typeof value.senderId === "string" && value.senderId.length > 0 && value.senderId.length <= MAX_SIGNAL_ID_LENGTH && isPlayerRole(value.senderRole) && Number.isSafeInteger(value.sequence) && (value.sequence as number) > 0 && Number.isSafeInteger(value.timestamp) && (value.timestamp as number) >= 0;
}
function parseCommunicationEvent(value: unknown): CommunicationEvent | undefined {
  if (!isRecord(value) || !validEnvelope(value) || typeof value.kind !== "string") return undefined;
  const base = ["kind", "senderId", "senderRole", "sequence", "timestamp"];
  if (value.kind === "GESTURE" && hasExactKeys(value, [...base, "gesture"]) && GESTURES.includes(value.gesture as Gesture)) return value as unknown as CommunicationEvent;
  if (value.kind === "EMOTE" && hasExactKeys(value, [...base, "emote"]) && EMOTES.includes(value.emote as Emote)) return value as unknown as CommunicationEvent;
  if (value.kind === "RECIPE_CARD" && hasExactKeys(value, [...base, "card"]) && RECIPE_CARDS.includes(value.card as RecipeCard)) return value as unknown as CommunicationEvent;
  if (value.kind === "DRAWING_CLEAR" && hasExactKeys(value, base)) return value as unknown as CommunicationEvent;
  if (value.kind === "POINT" && hasExactKeys(value, [...base, "target"]) && isRecord(value.target)) {
    const target = value.target;
    if (target.kind === "OBJECT" && hasExactKeys(target, ["kind", "objectId"]) && typeof target.objectId === "string") return value as unknown as CommunicationEvent;
    if (target.kind === "COORDINATE" && hasExactKeys(target, ["kind", "x", "y"]) && finite(value.target.x) && finite(value.target.y)) return value as unknown as CommunicationEvent;
  }
  return undefined;
}
function parseDrawingStroke(value: unknown): DrawingStroke | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "color", "width", "points", "senderId", "senderRole", "sequence", "timestamp"]) || !validEnvelope(value) || typeof value.id !== "string" || !DRAWING_COLORS.includes(value.color as DrawingColor) || !DRAWING_WIDTHS.includes(value.width as DrawingWidth) || !Array.isArray(value.points) || value.points.length < 2 || value.points.length > 64) return undefined;
  if (!value.points.every((point) => isRecord(point) && hasExactKeys(point, ["x", "y"]) && finite(point.x) && finite(point.y) && (point.x as number) >= 0 && (point.x as number) <= 1 && (point.y as number) >= 0 && (point.y as number) <= 1)) return undefined;
  return value as unknown as DrawingStroke;
}
function parseDrawingSnapshot(value: unknown): DrawingStroke[] | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["strokes"]) || !Array.isArray(value.strokes) || value.strokes.length > 32) return undefined;
  const strokes = value.strokes.map(parseDrawingStroke);
  return strokes.every(Boolean) ? strokes as DrawingStroke[] : undefined;
}
function parseVoiceRelay(value: unknown): VoiceRelayEnvelope | undefined {
  if (!isRecord(value) || !validEnvelope(value) || !["DISABLED", "READY", "OFFER", "ANSWER", "ICE"].includes(String(value.kind))) return undefined;
  if (value.kind === "READY" || value.kind === "DISABLED") {
    return hasExactKeys(value, ["kind", "senderId", "senderRole", "sequence", "timestamp"])
      ? value as unknown as VoiceRelayEnvelope
      : undefined;
  }
  if (typeof value.offerId !== "string" || value.offerId.length < 1 || value.offerId.length > MAX_SIGNAL_ID_LENGTH) return undefined;
  const base = ["kind", "offerId", "senderId", "senderRole", "sequence", "timestamp"];
  if (value.kind === "OFFER" || value.kind === "ANSWER") {
    if (!hasExactKeys(value, [...base, "sdp"]) || typeof value.sdp !== "string" || value.sdp.length < 1 || value.sdp.length > MAX_SDP_LENGTH) return undefined;
    return value as unknown as VoiceRelayEnvelope;
  }
  const allowed = [...base, "candidate", "sdpMid", "sdpMLineIndex"];
  if (Object.keys(value).some((key) => !allowed.includes(key)) || typeof value.candidate !== "string" || value.candidate.length < 1 || value.candidate.length > MAX_ICE_CANDIDATE_LENGTH) return undefined;
  if (value.sdpMid !== undefined && value.sdpMid !== null && (typeof value.sdpMid !== "string" || value.sdpMid.length > 64)) return undefined;
  if (value.sdpMLineIndex !== undefined && value.sdpMLineIndex !== null && (!Number.isSafeInteger(value.sdpMLineIndex) || (value.sdpMLineIndex as number) < 0 || (value.sdpMLineIndex as number) > 65_535)) return undefined;
  return value as unknown as VoiceRelayEnvelope;
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function parseStoredSequence(value: string | null): number {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_ACTION_SEQUENCE ? parsed : 0;
}
function clonePrivateRecipe(recipe: PrivateRecipePayload): PrivateRecipePayload {
  return {
    id: recipe.id,
    title: recipe.title,
    ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient })),
    steps: recipe.steps.map((step) => ({ ...step })),
  };
}

function defaultEndpoint(): string {
  if (import.meta.env.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL;
  }
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:2567`;
}
