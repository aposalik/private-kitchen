import { type AuthContext, type Client, ErrorCode, Room, ServerError } from "@colyseus/core";
import { defineTypes, MapSchema, Schema } from "@colyseus/schema";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  KITCHEN_MESSAGES,
  MAX_OBJECT_ID_LENGTH,
  createInitialKitchenObjects,
  DEFAULT_RECONNECTION_GRACE_SECONDS,
  isInsideKitchenBounds,
  isWithinReach,
  PLAYER_ROLES,
  REQUIRED_PLAYER_COUNT,
  type InteractionErrorCode,
  type KitchenJoinOptions,
  type KitchenObjectKind,
  type KitchenObjectLocation,
  type KitchenObjectPreparation,
  type PlayerRole,
  type RoundOutcomeReason,
  type RoundStatus,
  type RoomStatus,
} from "@cooking-game/shared";
import { CommunicationSystem } from "../systems/communication-system.js";
import { CookingSystem } from "../systems/cooking-system.js";
import { RecipeSystem } from "../systems/recipe-system.js";
import type { NewGameHistory } from "../db/repository.js";

const joinOptionsSchema = z
  .object({
    displayName: z.string().trim().min(1).max(32),
  })
  .strict();

const objectIdSchema = z.string().trim().min(1).max(MAX_OBJECT_ID_LENGTH);
const pickUpPayloadSchema = z.object({ objectId: objectIdSchema }).strict();
const dropPayloadSchema = z
  .object({
    objectId: objectIdSchema,
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

class KitchenPlayer extends Schema {
  id = "";
  displayName = "";
  role: PlayerRole = "BLIND_COOK";
  connected = true;
}

defineTypes(KitchenPlayer, {
  id: "string",
  displayName: "string",
  role: "string",
  connected: "boolean",
});

export class KitchenObject extends Schema {
  id = "";
  kind: KitchenObjectKind = "TOMATO";
  label = "";
  x = 0;
  y = 0;
  heldBy = "";
  preparation: KitchenObjectPreparation = "RAW";
  location: KitchenObjectLocation = "COUNTER";
}

defineTypes(KitchenObject, {
  id: "string",
  kind: "string",
  label: "string",
  x: "float64",
  y: "float64",
  heldBy: "string",
  preparation: "string",
  location: "string",
});

export class KitchenState extends Schema {
  players = new MapSchema<KitchenPlayer>();
  objects = new MapSchema<KitchenObject>();
  placementSeed = "";
  connectedCount = 0;
  status: RoomStatus = "WAITING";
  roundStatus: RoundStatus = "NOT_STARTED";
  remainingMs = 0;
  completedStepCount = 0;
  totalStepCount = 0;
  outcomeReason: RoundOutcomeReason = "NONE";
}

defineTypes(KitchenState, {
  players: { map: KitchenPlayer },
  objects: { map: KitchenObject },
  placementSeed: "string",
  connectedCount: "uint8",
  status: "string",
  roundStatus: "string",
  remainingMs: "uint32",
  completedStepCount: "uint8",
  totalStepCount: "uint8",
  outcomeReason: "string",
});

export interface KitchenRoomOptions {
  reconnectionGraceSeconds?: number;
  placementSeed?: string;
  voicePendingEdgeTtlMs?: number;
  voiceEstablishedEdgeTtlMs?: number;
  voiceReadinessTtlMs?: number;
  roundDurationMs?: number;
  now?: () => Date;
  resolveAuthCookie?: (cookieHeader: string | undefined) => Promise<RoomAccountAuth | undefined>;
  recordGameHistory?: (history: NewGameHistory) => Promise<boolean>;
}

interface RoomAccountAuth {
  accountId: string;
  expiresAt: Date;
}

interface KitchenClientAuth {
  guest: true;
  account?: RoomAccountAuth;
}

export class KitchenRoom extends Room {
  maxClients = REQUIRED_PLAYER_COUNT;
  state = new KitchenState();

  private reconnectionGraceSeconds = DEFAULT_RECONNECTION_GRACE_SECONDS;
  private communication!: CommunicationSystem;
  private cooking!: CookingSystem;
  private recipe!: RecipeSystem;
  private now: () => Date = () => new Date();
  private resolveAuthCookie: KitchenRoomOptions["resolveAuthCookie"];
  private recordGameHistory: KitchenRoomOptions["recordGameHistory"];
  private roundDurationMs = 300_000;
  private readonly accountBySession = new Map<string, RoomAccountAuth>();
  private readonly historyWrites = new Map<string, Promise<boolean>>();

  async onCreate(options: KitchenRoomOptions): Promise<void> {
    this.now = options.now ?? (() => new Date());
    this.resolveAuthCookie = options.resolveAuthCookie;
    this.recordGameHistory = options.recordGameHistory;
    this.roundDurationMs = options.roundDurationMs ?? 300_000;
    if (
      typeof options.reconnectionGraceSeconds === "number" &&
      Number.isFinite(options.reconnectionGraceSeconds) &&
      options.reconnectionGraceSeconds > 0
    ) {
      this.reconnectionGraceSeconds = options.reconnectionGraceSeconds;
    }

    this.state.placementSeed = options.placementSeed ?? randomUUID();
    for (const initial of createInitialKitchenObjects(this.state.placementSeed)) {
      const object = new KitchenObject();
      object.id = initial.id;
      object.kind = initial.kind;
      object.label = initial.label;
      object.x = initial.x;
      object.y = initial.y;
      object.preparation = initial.preparation;
      object.location = initial.location;
      this.state.objects.set(object.id, object);
    }

    this.cooking = new CookingSystem(this.state, {
      placementSeed: this.state.placementSeed,
      ...(options.roundDurationMs ? { roundDurationMs: options.roundDurationMs } : {}),
      createObject: () => new KitchenObject(),
      onTerminal: () => this.recordTerminalHistory(),
    });
    this.cooking.register(
      this,
      (sessionId) => this.state.players.get(sessionId)?.role,
    );
    this.recipe = new RecipeSystem(this, {
      roleOf: (sessionId) => this.state.players.get(sessionId)?.role,
      roundStarted: () => this.state.roundStatus !== "NOT_STARTED",
    });
    this.recipe.register();

    this.onMessage(KITCHEN_MESSAGES.pickUp, (client, payload: unknown) => {
      this.handlePickUp(client, payload);
    });
    this.onMessage(KITCHEN_MESSAGES.drop, (client, payload: unknown) => {
      this.handleDrop(client, payload);
    });
    this.communication = new CommunicationSystem(this, {
      roleOf: (sessionId) => this.state.players.get(sessionId)?.role,
      hasObject: (objectId) => this.state.objects.has(objectId),
      isReady: () => this.state.status === "READY",
    }, {
      ...(options.voicePendingEdgeTtlMs ? { pendingEdgeTtlMs: options.voicePendingEdgeTtlMs } : {}),
      ...(options.voiceEstablishedEdgeTtlMs ? { establishedEdgeTtlMs: options.voiceEstablishedEdgeTtlMs } : {}),
      ...(options.voiceReadinessTtlMs ? { readinessTtlMs: options.voiceReadinessTtlMs } : {}),
    });
    this.communication.register();

    await this.setPrivate();
  }

  async onAuth(_client: Client, _options: unknown, context: AuthContext): Promise<KitchenClientAuth> {
    const account = await this.resolveAuthCookie?.(context.headers.get("cookie") ?? undefined);
    return account ? { guest: true, account } : { guest: true };
  }

  onJoin(client: Client, rawOptions: unknown): void {
    const parsedOptions = joinOptionsSchema.safeParse(rawOptions);
    if (!parsedOptions.success) {
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        "Invalid join options",
      );
    }

    const options: KitchenJoinOptions = parsedOptions.data;
    const role = this.nextAvailableRole();

    if (!role) {
      throw new Error("Room capacity reached");
    }

    const player = new KitchenPlayer();
    player.id = client.sessionId;
    player.displayName = options.displayName;
    player.role = role;
    this.state.players.set(client.sessionId, player);
    const auth = client.auth as KitchenClientAuth | undefined;
    if (auth?.account && auth.account.expiresAt.getTime() > this.now().getTime()) {
      this.accountBySession.set(client.sessionId, auth.account);
    }
    this.updateReadiness();
    const roundWasNotStarted = this.state.roundStatus === "NOT_STARTED";
    this.cooking.readinessChanged(this.state.status === "READY");
    if (roundWasNotStarted && this.state.roundStatus === "RUNNING") {
      this.recipe.roundDidStart();
    } else {
      this.recipe.connected(client);
    }
    this.communication.connected(client);
  }

  onDrop(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
      this.communication.disconnected(client.sessionId, false);
      this.updateReadiness();
      this.cooking.readinessChanged(false);
      this.allowReconnection(client, this.reconnectionGraceSeconds);
    }
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      const account = this.accountBySession.get(client.sessionId);
      if (account && account.expiresAt.getTime() <= this.now().getTime()) {
        this.accountBySession.delete(client.sessionId);
      }
      player.connected = true;
      this.updateReadiness();
      this.cooking.readinessChanged(this.state.status === "READY");
      this.recipe.connected(client);
      this.communication.connected(client);
    }
  }

  onLeave(client: Client): void {
    this.communication.disconnected(client.sessionId, true);
    this.cooking.permanentLeave(client.sessionId);
    this.releaseHeldObjects(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.accountBySession.delete(client.sessionId);
    this.updateReadiness();
    this.cooking.readinessChanged(this.state.status === "READY");
  }

  onDispose(): void {
    this.communication.dispose();
    this.cooking.dispose();
    this.accountBySession.clear();
    this.historyWrites.clear();
  }

  private recordTerminalHistory(): void {
    if (!this.recordGameHistory) return;
    const outcome = this.state.roundStatus;
    if (outcome !== "WON" && outcome !== "LOST") return;
    const accountIds = new Set(
      Array.from(this.accountBySession.values(), ({ accountId }) => accountId),
    );
    for (const accountId of accountIds) {
      if (this.historyWrites.has(accountId)) continue;
      const write = this.recordGameHistory({
        accountId,
        roundId: `${this.roomId}:1`,
        roomId: this.roomId,
        recipeId: "tomato-soup",
        outcome,
        outcomeReason: this.state.outcomeReason,
        completedStepCount: this.state.completedStepCount,
        totalStepCount: this.state.totalStepCount,
        durationMs: Math.max(0, this.roundDurationMs - this.state.remainingMs),
        finishedAt: this.now(),
      });
      this.historyWrites.set(accountId, write);
      void write.catch(() => undefined);
    }
  }

  private nextAvailableRole(): PlayerRole | undefined {
    const assigned = new Set(
      Array.from(this.state.players.values(), (player) => player.role),
    );
    return PLAYER_ROLES.find((role) => !assigned.has(role));
  }

  private handlePickUp(client: Client, rawPayload: unknown): void {
    const parsed = pickUpPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.sendInteractionError(client, "INVALID_COMMAND", "Invalid pickup command.");
      return;
    }
    if (!this.canInteract(client)) {
      return;
    }

    const object = this.state.objects.get(parsed.data.objectId);
    if (!object) {
      this.sendInteractionError(client, "OBJECT_NOT_FOUND", "Object not found.");
      return;
    }
    if (object.location === "POT" || object.preparation === "RUINED") {
      this.sendInteractionError(client, "OBJECT_UNAVAILABLE", "Object cannot be picked up.");
      return;
    }
    if (object.heldBy) {
      this.sendInteractionError(client, "OBJECT_UNAVAILABLE", "Object is already held.");
      return;
    }
    if (Array.from(this.state.objects.values()).some((item) => item.heldBy === client.sessionId)) {
      this.sendInteractionError(client, "ALREADY_HOLDING", "You are already holding an object.");
      return;
    }
    if (!isWithinReach(object.x, object.y)) {
      this.sendInteractionError(client, "OUT_OF_REACH", "Object is out of reach.");
      return;
    }
    object.heldBy = client.sessionId;
  }

  private handleDrop(client: Client, rawPayload: unknown): void {
    const parsed = dropPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.sendInteractionError(client, "INVALID_COMMAND", "Invalid drop command.");
      return;
    }
    if (!this.canInteract(client)) {
      return;
    }

    const object = this.state.objects.get(parsed.data.objectId);
    if (!object) {
      this.sendInteractionError(client, "OBJECT_NOT_FOUND", "Object not found.");
      return;
    }
    if (object.heldBy !== client.sessionId) {
      this.sendInteractionError(client, "NOT_HOLDER", "You do not hold that object.");
      return;
    }
    if (!isInsideKitchenBounds(parsed.data.x, parsed.data.y)) {
      this.sendInteractionError(client, "INVALID_DESTINATION", "Destination is outside the kitchen.");
      return;
    }
    if (!isWithinReach(parsed.data.x, parsed.data.y)) {
      this.sendInteractionError(client, "OUT_OF_REACH", "Destination is out of reach.");
      return;
    }
    object.x = parsed.data.x;
    object.y = parsed.data.y;
    object.heldBy = "";
  }

  private canInteract(client: Client): boolean {
    if (this.state.status !== "READY" || this.state.roundStatus !== "RUNNING") {
      this.sendInteractionError(client, "NOT_READY", "Kitchen is not ready.");
      return false;
    }
    if (this.state.players.get(client.sessionId)?.role !== "BLIND_COOK") {
      this.sendInteractionError(client, "NOT_AUTHORIZED", "Only the Blind Cook can interact.");
      return false;
    }
    return true;
  }

  private releaseHeldObjects(sessionId: string): void {
    for (const object of this.state.objects.values()) {
      if (object.heldBy === sessionId) {
        object.heldBy = "";
      }
    }
  }

  private sendInteractionError(
    client: Client,
    code: InteractionErrorCode,
    message: string,
  ): void {
    client.send(KITCHEN_MESSAGES.interactionError, { code, message });
  }

  private updateReadiness(): void {
    const wasReady = this.state.status === "READY";
    this.state.connectedCount = Array.from(
      this.state.players.values(),
    ).filter((player) => player.connected).length;
    this.state.status =
      this.state.connectedCount === REQUIRED_PLAYER_COUNT ? "READY" : "WAITING";
    if (wasReady && this.state.status !== "READY") this.communication.roomReadinessChanged(false);
  }
}
