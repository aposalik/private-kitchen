import type { Room } from "@colyseus/core";
import {
  KITCHEN_LAYOUT,
  KITCHEN_MESSAGES,
  MOVEMENT_SEND_INTERVAL_MS,
  MOVEMENT_SIMULATION_INTERVAL_MS,
  PLAYER_COLLISION_RADIUS,
  PLAYER_MOVEMENT_SPEED,
  movementIntentSchema,
  type KitchenPlayerState,
  type MovementIntent,
} from "@cooking-game/shared";

interface MutablePlayer extends KitchenPlayerState {
  x: number;
  z: number;
  facingYaw: number;
  locomotion: "IDLE" | "MOVE";
  lastProcessedMovementSequence: number;
}

interface MutableMovementState {
  readonly status: string;
  readonly roundStatus: string;
  readonly players: {
    get(id: string): MutablePlayer | undefined;
    values(): IterableIterator<MutablePlayer>;
  };
  readonly objects: {
    values(): IterableIterator<MutableObject>;
  };
}

interface MutableObject {
  x: number;
  y: number;
  heldBy?: string;
}

const MOVEMENT_BURST_CAPACITY = 2;

export class MovementRateBudget {
  private readonly entries = new Map<string, { tokens: number; refilledAt: number }>();

  consume(sessionId: string, now = performance.now()): boolean {
    const current = this.entries.get(sessionId) ?? {
      tokens: MOVEMENT_BURST_CAPACITY,
      refilledAt: now,
    };
    const elapsed = Math.max(0, now - current.refilledAt);
    const tokens = Math.min(
      MOVEMENT_BURST_CAPACITY,
      current.tokens + elapsed / MOVEMENT_SEND_INTERVAL_MS,
    );
    if (tokens < 1) {
      this.entries.set(sessionId, { tokens, refilledAt: Math.max(now, current.refilledAt) });
      return false;
    }
    this.entries.set(sessionId, {
      tokens: tokens - 1,
      refilledAt: Math.max(now, current.refilledAt),
    });
    return true;
  }

  delete(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  clear(): void {
    this.entries.clear();
  }
}

export class MovementSystem {
  private readonly pending = new Map<string, MovementIntent>();
  private readonly active = new Map<string, MovementIntent>();
  private readonly lastReceivedSequence = new Map<string, number>();
  private readonly rateBudget = new MovementRateBudget();
  private interval: { clear(): void } | undefined;

  constructor(private readonly state: MutableMovementState) {}

  register(room: Room): void {
    room.onMessage(KITCHEN_MESSAGES.movementIntent, (client, payload: unknown) => {
      const parsed = movementIntentSchema.safeParse(payload);
      const canMove = this.state.status === "READY" && this.state.roundStatus === "RUNNING";
      if (!canMove || !parsed.success || !this.state.players.get(client.sessionId)?.connected) return;
      const lastSequence = this.lastReceivedSequence.get(client.sessionId)
        ?? this.state.players.get(client.sessionId)?.lastProcessedMovementSequence
        ?? 0;
      if (parsed.data.sequence <= lastSequence) return;
      if (!this.rateBudget.consume(client.sessionId)) return;
      this.lastReceivedSequence.set(client.sessionId, parsed.data.sequence);
      this.pending.set(client.sessionId, parsed.data);
    });
    this.interval ??= room.clock.setInterval(
      () => this.step(MOVEMENT_SIMULATION_INTERVAL_MS),
      MOVEMENT_SIMULATION_INTERVAL_MS,
    );
  }

  permanentLeave(sessionId: string): void {
    this.pending.delete(sessionId);
    this.active.delete(sessionId);
    this.lastReceivedSequence.delete(sessionId);
    this.rateBudget.delete(sessionId);
  }

  disconnected(sessionId: string): void {
    this.pending.delete(sessionId);
    this.active.delete(sessionId);
    const player = this.state.players.get(sessionId);
    if (player) player.locomotion = "IDLE";
  }

  dispose(): void {
    this.interval?.clear();
    this.interval = undefined;
    this.pending.clear();
    this.active.clear();
    this.lastReceivedSequence.clear();
    this.rateBudget.clear();
  }

  step(deltaMs: number): void {
    const canMove = this.state.status === "READY" && this.state.roundStatus === "RUNNING";
    if (!canMove) {
      this.pending.clear();
      this.active.clear();
    }
    for (const player of this.state.players.values()) {
      const pending = this.pending.get(player.id);
      if (pending) {
        this.active.set(player.id, pending);
        this.pending.delete(player.id);
        player.lastProcessedMovementSequence = pending.sequence;
      }
      const intent = this.active.get(player.id);
      if (!canMove || !player.connected || !intent || (intent.axisX === 0 && intent.axisZ === 0)) {
        player.locomotion = "IDLE";
        this.syncHeldObjects(player);
        continue;
      }

      const distance = PLAYER_MOVEMENT_SPEED * Math.max(0, deltaMs) / 1_000;
      const previousX = player.x;
      const previousZ = player.z;
      const nextX = player.x + intent.axisX * distance;
      const nextZ = player.z + intent.axisZ * distance;
      if (this.canOccupy(player.id, nextX, player.z)) player.x = nextX;
      if (this.canOccupy(player.id, player.x, nextZ)) player.z = nextZ;
      player.facingYaw = Math.atan2(intent.axisX, intent.axisZ);
      player.locomotion = player.x === previousX && player.z === previousZ ? "IDLE" : "MOVE";
      this.syncHeldObjects(player);
    }
  }

  private canOccupy(sessionId: string, x: number, z: number): boolean {
    const bounds = KITCHEN_LAYOUT.walkableBounds;
    if (
      x < bounds.minX || x > bounds.maxX
      || z < bounds.minZ || z > bounds.maxZ
    ) return false;

    for (const collider of KITCHEN_LAYOUT.staticColliders) {
      if (
        x + PLAYER_COLLISION_RADIUS > collider.minX
        && x - PLAYER_COLLISION_RADIUS < collider.maxX
        && z + PLAYER_COLLISION_RADIUS > collider.minZ
        && z - PLAYER_COLLISION_RADIUS < collider.maxZ
      ) return false;
    }
    const minimumSeparation = PLAYER_COLLISION_RADIUS * 2;
    for (const other of this.state.players.values()) {
      if (other.id === sessionId) continue;
      const deltaX = x - other.x;
      const deltaZ = z - other.z;
      if (deltaX * deltaX + deltaZ * deltaZ < minimumSeparation * minimumSeparation) {
        return false;
      }
    }
    return true;
  }

  private syncHeldObjects(player: MutablePlayer): void {
    for (const object of this.state.objects.values()) {
      if (object.heldBy !== player.id) continue;
      object.x = player.x;
      object.y = player.z;
    }
  }
}
