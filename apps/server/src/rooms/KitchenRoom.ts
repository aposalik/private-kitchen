import { type Client, ErrorCode, Room, ServerError } from "@colyseus/core";
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
  type PlayerRole,
  type RoomStatus,
} from "@cooking-game/shared";

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

class KitchenObject extends Schema {
  id = "";
  kind: KitchenObjectKind = "TOMATO";
  label = "";
  x = 0;
  y = 0;
  heldBy = "";
}

defineTypes(KitchenObject, {
  id: "string",
  kind: "string",
  label: "string",
  x: "float64",
  y: "float64",
  heldBy: "string",
});

class KitchenState extends Schema {
  players = new MapSchema<KitchenPlayer>();
  objects = new MapSchema<KitchenObject>();
  placementSeed = "";
  connectedCount = 0;
  status: RoomStatus = "WAITING";
}

defineTypes(KitchenState, {
  players: { map: KitchenPlayer },
  objects: { map: KitchenObject },
  placementSeed: "string",
  connectedCount: "uint8",
  status: "string",
});

export interface KitchenRoomOptions {
  reconnectionGraceSeconds?: number;
  placementSeed?: string;
}

export class KitchenRoom extends Room {
  maxClients = REQUIRED_PLAYER_COUNT;
  state = new KitchenState();

  private reconnectionGraceSeconds = DEFAULT_RECONNECTION_GRACE_SECONDS;

  async onCreate(options: KitchenRoomOptions): Promise<void> {
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
      this.state.objects.set(object.id, object);
    }

    this.onMessage(KITCHEN_MESSAGES.pickUp, (client, payload: unknown) => {
      this.handlePickUp(client, payload);
    });
    this.onMessage(KITCHEN_MESSAGES.drop, (client, payload: unknown) => {
      this.handleDrop(client, payload);
    });

    await this.setPrivate();
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
    this.updateReadiness();
  }

  onDrop(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
      this.updateReadiness();
      this.allowReconnection(client, this.reconnectionGraceSeconds);
    }
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = true;
      this.updateReadiness();
    }
  }

  onLeave(client: Client): void {
    this.releaseHeldObjects(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.updateReadiness();
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
    if (this.state.status !== "READY") {
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
    this.state.connectedCount = Array.from(
      this.state.players.values(),
    ).filter((player) => player.connected).length;
    this.state.status =
      this.state.connectedCount === REQUIRED_PLAYER_COUNT ? "READY" : "WAITING";
  }
}
