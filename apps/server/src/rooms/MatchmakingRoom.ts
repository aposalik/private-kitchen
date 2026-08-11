import { type Client, ErrorCode, Room, type RoomOptions, ServerError, matchMaker } from "@colyseus/core";
import { z } from "zod";

import {
  KITCHEN_ROOM_NAME,
  MATCHMAKING_MESSAGES,
  PLAYER_ROLES,
  REGIONS,
  ROLE_PREFERENCES,
  type PlayerRole,
  type Region,
  type RolePreference,
  type MatchmakingServerEvent,
} from "@cooking-game/shared";

import { createTicket } from "./ticketStore.js";

const READY_CHECK_TIMEOUT_MS = 15_000;
const PENALTY_DURATION_MS = 60_000;
const QUEUE_TIMEOUT_MS = 5 * 60_000;

const joinOptionsSchema = z
  .object({
    displayName: z.string().trim().min(1).max(32),
    characterId: z.string().trim().min(1).max(32).optional(),
    region: z.enum(REGIONS),
    rolePreference: z.enum(ROLE_PREFERENCES),
    recipeId: z.string().min(1).max(64).optional(),
  })
  .strict();

interface QueueEntry {
  sessionId: string;
  displayName: string;
  characterId: string;
  region: Region;
  rolePreference: RolePreference;
  recipeId: string | undefined;
  joinedAt: number;
}

interface PendingMatch {
  matchId: string;
  entries: QueueEntry[];
  assignedRoles: Map<string, PlayerRole>;
  readySet: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

// Module-level penalty store shared across all MatchmakingRoom instances.
const penalties = new Map<string, number>();

export class MatchmakingRoom extends Room<RoomOptions> {
  maxClients = 200;

  private queue: QueueEntry[] = [];
  private readonly pendingMatches = new Map<string, PendingMatch>();
  private readonly clientMatchId = new Map<string, string>();
  private readonly queueTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async onCreate(): Promise<void> {
    this.onMessage(MATCHMAKING_MESSAGES.readyConfirm, (client: Client) =>
      this.handleReadyConfirm(client),
    );
    this.onMessage(MATCHMAKING_MESSAGES.readyDecline, (client: Client) =>
      this.handleReadyDecline(client),
    );
  }

  onJoin(client: Client, rawOptions: unknown): void {
    const parsed = joinOptionsSchema.safeParse(rawOptions);
    if (!parsed.success) {
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        "Invalid matchmaking options",
      );
    }

    const penaltyExpiry = penalties.get(client.sessionId);
    if (penaltyExpiry && penaltyExpiry > Date.now()) {
      this.sendEvent(client, {
        type: "PENALTY_ACTIVE",
        remainingMs: penaltyExpiry - Date.now(),
      });
      client.leave();
      return;
    }
    penalties.delete(client.sessionId);

    const entry: QueueEntry = {
      sessionId: client.sessionId,
      displayName: parsed.data.displayName,
      characterId: parsed.data.characterId ?? "Rabbit_Blond",
      region: parsed.data.region,
      rolePreference: parsed.data.rolePreference,
      recipeId: parsed.data.recipeId,
      joinedAt: Date.now(),
    };

    this.queue.push(entry);

    const queueTimer = setTimeout(() => {
      this.removeFromQueue(client.sessionId);
      this.sendEvent(client, { type: "MATCH_CANCELLED", reason: "TIMEOUT", requeued: false });
      client.leave();
    }, QUEUE_TIMEOUT_MS);
    this.queueTimers.set(client.sessionId, queueTimer);

    this.broadcastQueueSize();
    this.tryFormMatch();
  }

  onLeave(client: Client): void {
    this.removeFromQueue(client.sessionId);

    const matchId = this.clientMatchId.get(client.sessionId);
    if (matchId) {
      const match = this.pendingMatches.get(matchId);
      if (match) {
        this.pendingMatches.delete(matchId);
        clearTimeout(match.timer);
        this.applyPenalty(client.sessionId);
        void this.cancelMatch(match, "DECLINED", client.sessionId);
      }
    }
    this.clientMatchId.delete(client.sessionId);
    this.broadcastQueueSize();
  }

  onDispose(): void {
    for (const t of this.queueTimers.values()) clearTimeout(t);
    for (const m of this.pendingMatches.values()) clearTimeout(m.timer);
    this.pendingMatches.clear();
    this.queue.length = 0;
  }

  private removeFromQueue(sessionId: string): void {
    const idx = this.queue.findIndex((e) => e.sessionId === sessionId);
    if (idx !== -1) this.queue.splice(idx, 1);
    const t = this.queueTimers.get(sessionId);
    if (t) clearTimeout(t);
    this.queueTimers.delete(sessionId);
  }

  private tryFormMatch(): void {
    const byRegion = new Map<Region, QueueEntry[]>();
    for (const entry of this.queue) {
      const group = byRegion.get(entry.region) ?? [];
      group.push(entry);
      byRegion.set(entry.region, group);
    }

    for (const [, entries] of byRegion) {
      if (entries.length < 3) continue;
      const result = this.findCompatibleGroup(entries);
      if (!result) continue;
      for (const e of result.entries) this.removeFromQueue(e.sessionId);
      void this.startReadyCheck(result.entries, result.roles);
      return;
    }
  }

  private findCompatibleGroup(
    entries: QueueEntry[],
  ): { entries: QueueEntry[]; roles: Map<string, PlayerRole> } | null {
    for (let i = 0; i < entries.length - 2; i++) {
      for (let j = i + 1; j < entries.length - 1; j++) {
        for (let k = j + 1; k < entries.length; k++) {
          const a = entries[i], b = entries[j], c = entries[k];
          if (!a || !b || !c) continue;
          const group: QueueEntry[] = [a, b, c];
          const roles = this.assignRoles(group);
          if (roles) return { entries: group, roles };
        }
      }
    }
    return null;
  }

  private assignRoles(
    group: QueueEntry[],
  ): Map<string, PlayerRole> | null {
    const withPref = group.filter((e) => e.rolePreference !== "ANY");
    const withAny = group.filter((e) => e.rolePreference === "ANY");

    const prefRoles = withPref.map((e) => e.rolePreference as PlayerRole);
    const uniquePrefRoles = new Set(prefRoles);
    if (uniquePrefRoles.size !== prefRoles.length) return null;

    const roles = new Map<string, PlayerRole>();
    for (const e of withPref) roles.set(e.sessionId, e.rolePreference as PlayerRole);

    const remaining = PLAYER_ROLES.filter((r) => !uniquePrefRoles.has(r));
    for (const e of withAny) {
      const role = remaining.shift();
      if (!role) return null;
      roles.set(e.sessionId, role);
    }

    return roles;
  }

  private async startReadyCheck(
    entries: QueueEntry[],
    assignedRoles: Map<string, PlayerRole>,
  ): Promise<void> {
    const matchId =
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2);

    const match: PendingMatch = {
      matchId,
      entries,
      assignedRoles,
      readySet: new Set(),
      timer: setTimeout(
        () => void this.resolveReadyCheck(matchId, "TIMEOUT", undefined),
        READY_CHECK_TIMEOUT_MS,
      ),
    };
    this.pendingMatches.set(matchId, match);

    for (const e of entries) {
      this.clientMatchId.set(e.sessionId, matchId);
      const client = this.clients.find((c) => c.sessionId === e.sessionId);
      if (client) {
        this.sendEvent(client, {
          type: "READY_CHECK",
          timeoutMs: READY_CHECK_TIMEOUT_MS,
          matchId,
          assignedRole: assignedRoles.get(e.sessionId) ?? "BLIND_COOK",
        });
      }
    }
  }

  private handleReadyConfirm(client: Client): void {
    const matchId = this.clientMatchId.get(client.sessionId);
    if (!matchId) return;
    const match = this.pendingMatches.get(matchId);
    if (!match) return;

    match.readySet.add(client.sessionId);
    if (match.readySet.size === 3) {
      void this.resolveReadyCheck(matchId, "ALL_READY", undefined);
    }
  }

  private handleReadyDecline(client: Client): void {
    const matchId = this.clientMatchId.get(client.sessionId);
    if (!matchId) return;
    this.applyPenalty(client.sessionId);
    void this.resolveReadyCheck(matchId, "DECLINED", client.sessionId);
  }

  private async resolveReadyCheck(
    matchId: string,
    reason: "ALL_READY" | "TIMEOUT" | "DECLINED",
    declinerId: string | undefined,
  ): Promise<void> {
    const match = this.pendingMatches.get(matchId);
    if (!match) return;
    this.pendingMatches.delete(matchId);
    clearTimeout(match.timer);

    if (reason === "ALL_READY") {
      await this.launchKitchenRoom(match);
      return;
    }

    const cancelReason: "TIMEOUT" | "DECLINED" = reason;

    if (cancelReason === "TIMEOUT") {
      for (const e of match.entries) {
        if (!match.readySet.has(e.sessionId)) this.applyPenalty(e.sessionId);
      }
    }

    // Pass the match object directly — pendingMatches no longer holds it.
    await this.cancelMatch(match, cancelReason, declinerId);
  }

  private async launchKitchenRoom(match: PendingMatch): Promise<void> {
    let roomId: string;
    const recipeId = match.entries.find((e) => e.recipeId)?.recipeId;

    try {
      const created = await matchMaker.createRoom(KITCHEN_ROOM_NAME, {
        ...(recipeId ? { recipeId } : {}),
      });
      roomId = created.roomId;
    } catch {
      await this.cancelMatch(match, "TIMEOUT", undefined);
      return;
    }

    for (const e of match.entries) {
      const role = match.assignedRoles.get(e.sessionId);
      if (!role) continue;
      const ticket = createTicket(role);
      const client = this.clients.find((c) => c.sessionId === e.sessionId);
      this.clientMatchId.delete(e.sessionId);
      if (client) {
        this.sendEvent(client, { type: "MATCH_READY", roomId, ticket });
      }
    }
  }

  private async cancelMatch(
    match: PendingMatch,
    reason: "TIMEOUT" | "DECLINED",
    penalizedId: string | undefined,
  ): Promise<void> {
    for (const e of match.entries) {
      this.clientMatchId.delete(e.sessionId);
      const client = this.clients.find((c) => c.sessionId === e.sessionId);
      if (!client) continue;

      // For DECLINED only the explicit decliner loses their queue slot.
      // For TIMEOUT every player who did not confirm is penalised.
      const isPenalized =
        reason === "DECLINED"
          ? e.sessionId === penalizedId
          : !match.readySet.has(e.sessionId);

      if (isPenalized) {
        this.sendEvent(client, { type: "MATCH_CANCELLED", reason, requeued: false });
        client.leave();
      } else {
        this.sendEvent(client, { type: "MATCH_CANCELLED", reason, requeued: true });
        this.queue.push({ ...e, joinedAt: Date.now() });
        this.broadcastQueueSize();
        this.tryFormMatch();
      }
    }
  }

  private applyPenalty(sessionId: string): void {
    penalties.set(sessionId, Date.now() + PENALTY_DURATION_MS);
  }

  private sendEvent(client: Client, event: MatchmakingServerEvent): void {
    client.send(MATCHMAKING_MESSAGES.event, event);
  }

  private broadcastQueueSize(): void {
    this.broadcast(MATCHMAKING_MESSAGES.event, {
      type: "QUEUE_UPDATE",
      inQueue: this.queue.length,
    } satisfies MatchmakingServerEvent);
  }
}
