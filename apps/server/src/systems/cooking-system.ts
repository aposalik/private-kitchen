import { type Client, type Room } from "@colyseus/core";
import { TOMATO_SOUP_RECIPE } from "@cooking-game/recipe-schema";
import {
  KITCHEN_MESSAGES,
  MAX_OBJECT_ID_LENGTH,
  MAX_ROUND_REMAINING_MS,
  cookActionSchema,
  createInitialKitchenObjects,
  type CookAction,
  type CookingErrorCode,
  type PlayerRole,
} from "@cooking-game/shared";

import type { KitchenObject, KitchenState } from "../rooms/KitchenRoom.js";

export interface CookingSystemOptions {
  placementSeed: string;
  roundDurationMs?: number;
  createObject(): KitchenObject;
  onTerminal?(): void;
  onTerminal?(): void;
}

export class CookingSystem {
  private static readonly TIMER_INTERVAL_MS = 20;
  private readonly roundDurationMs: number;
  private started = false;
  private readonly lastActionSequence = new Map<string, number>();
  private readonly creditedChops = new Set<string>();
  private readonly replacementSequence = new Map<string, number>();
  private terminalStage = 0;
  private timerInterval: { clear(): void } | undefined;
  private runningStartedAt: number | undefined;
  private remainingAtRunningStart = 0;

  constructor(
    private readonly state: KitchenState,
    private readonly options: CookingSystemOptions,
  ) {
    this.roundDurationMs = validDuration(options.roundDurationMs)
      ? options.roundDurationMs
      : TOMATO_SOUP_RECIPE.roundDurationMs;
  }

  register(room: Room, roleOf: (sessionId: string) => PlayerRole | undefined): void {
    this.timerInterval ??= room.clock.setInterval(
      () => this.reconcileRunningTime(),
      CookingSystem.TIMER_INTERVAL_MS,
    );
    room.onMessage(KITCHEN_MESSAGES.cookAction, (client, rawPayload: unknown) => {
      const parsed = cookActionSchema.safeParse(rawPayload);
      if (!parsed.success) {
        this.sendError(client, "INVALID_COMMAND");
        return;
      }
      this.reconcileRunningTime();

      const lastSequence = this.lastActionSequence.get(client.sessionId);
      if (parsed.data.actionSequence === lastSequence) {
        this.sendError(client, "REPLAYED_ACTION");
        return;
      }
      if (lastSequence !== undefined && parsed.data.actionSequence < lastSequence) {
        this.sendError(client, "STALE_ACTION");
        return;
      }
      this.lastActionSequence.set(client.sessionId, parsed.data.actionSequence);

      if (this.state.status !== "READY") {
        this.sendError(client, "NOT_READY");
        return;
      }
      if (this.state.roundStatus === "WON" || this.state.roundStatus === "LOST") {
        this.sendError(client, "ROUND_TERMINAL");
        return;
      }
      if (this.state.roundStatus !== "RUNNING") {
        this.sendError(client, "NOT_RUNNING");
        return;
      }
      if (roleOf(client.sessionId) !== "BLIND_COOK") {
        this.sendError(client, "NOT_AUTHORIZED");
        return;
      }
      const error = this.handleAction(client, parsed.data);
      if (error) this.sendError(client, error);
    });
  }

  permanentLeave(sessionId: string): void {
    this.lastActionSequence.delete(sessionId);
  }

  dispose(): void {
    this.stopTimerInterval();
    this.runningStartedAt = undefined;
    this.remainingAtRunningStart = 0;
    this.lastActionSequence.clear();
    this.creditedChops.clear();
    this.replacementSequence.clear();
  }

  readinessChanged(ready: boolean): void {
    if (!this.started) {
      if (!ready) return;
      this.started = true;
      this.ensureIngredientCount("TOMATO", 2);
      this.ensureIngredientCount("ONION", 1);
      this.state.roundStatus = "RUNNING";
      this.state.remainingMs = this.roundDurationMs;
      this.state.completedStepCount = 0;
      this.state.totalStepCount = TOMATO_SOUP_RECIPE.ingredients.reduce(
        (total, ingredient) => total + ingredient.count * 2,
        4,
      );
      this.state.outcomeReason = "NONE";
      this.terminalStage = 0;
      this.resumeCountdown();
      return;
    }

    if (this.state.roundStatus === "WON" || this.state.roundStatus === "LOST") return;
    if (!ready && this.state.roundStatus === "RUNNING") {
      this.reconcileRunningTime();
      if (this.state.roundStatus !== "RUNNING") return;
      this.state.roundStatus = "PAUSED";
      this.runningStartedAt = undefined;
      this.remainingAtRunningStart = this.state.remainingMs;
      return;
    }
    if (ready && this.state.roundStatus === "PAUSED") {
      this.state.roundStatus = "RUNNING";
      this.resumeCountdown();
    }
  }

  private ensureIngredientCount(kind: "TOMATO" | "ONION", required: number): void {
    let count = Array.from(this.state.objects.values()).filter(
      (object) => object.kind === kind && object.preparation !== "RUINED",
    ).length;
    while (count < required) {
      const object = this.options.createObject();
      const initial = createInitialKitchenObjects(
        `${this.options.placementSeed}:round:${kind}:${count}`,
      ).find((candidate) => candidate.kind === kind)!;
      object.id = `round-${kind.toLowerCase()}-${count + 1}`;
      object.kind = kind;
      object.label = initial.label;
      object.x = initial.x;
      object.y = initial.y;
      object.heldBy = "";
      object.preparation = "RAW";
      object.location = "COUNTER";
      this.state.objects.set(object.id, object);
      count += 1;
    }
  }

  private handleAction(client: Client, action: CookAction): CookingErrorCode | undefined {
    if (action.action !== "CHOP" && action.action !== "ADD_TO_POT") {
      return this.handleTerminalAction(action.action);
    }
    const object = this.state.objects.get(action.objectId);
    if (!object) return "OBJECT_NOT_FOUND";

    const requiredCount = TOMATO_SOUP_RECIPE.ingredients.find(
      (ingredient) => ingredient.kind === object.kind,
    )?.count;
    if (requiredCount === undefined) return "OUT_OF_ORDER";
    if (object.heldBy !== client.sessionId) return "OBJECT_NOT_OWNED";
    if (object.location !== "COUNTER") return "INVALID_PREPARATION";

    if (action.action === "CHOP") {
      if (object.preparation === "RAW") {
        object.preparation = "CHOPPED";
        this.creditedChops.add(object.id);
        this.state.completedStepCount += 1;
        return undefined;
      }
      if (object.preparation === "CHOPPED") {
        this.ruinAndReplace(object);
        return undefined;
      }
      return "INVALID_PREPARATION";
    }

    if (object.preparation !== "CHOPPED") return "INVALID_PREPARATION";
    if (this.state.completedStepCount < this.requiredIngredientTotal()) return "OUT_OF_ORDER";
    const countInPot = Array.from(this.state.objects.values()).filter(
      (candidate) => candidate.kind === object.kind && candidate.location === "POT",
    ).length;
    if (countInPot >= requiredCount) return "OUT_OF_ORDER";
    object.location = "POT";
    object.heldBy = "";
    this.state.completedStepCount += 1;
    return undefined;
  }

  private requiredIngredientTotal(): number {
    return TOMATO_SOUP_RECIPE.ingredients.reduce(
      (total, ingredient) => total + ingredient.count,
      0,
    );
  }

  private handleTerminalAction(
    action: "SEASON" | "BOIL" | "MIX" | "PLATE",
  ): CookingErrorCode | undefined {
    if (this.state.completedStepCount !== this.requiredIngredientTotal() * 2 + this.terminalStage) {
      return "OUT_OF_ORDER";
    }
    const orderedActions = ["SEASON", "BOIL", "MIX", "PLATE"] as const;
    if (action !== orderedActions[this.terminalStage]) return "OUT_OF_ORDER";

    this.terminalStage += 1;
    this.state.completedStepCount += 1;
    if (action === "PLATE") {
      this.state.roundStatus = "WON";
      this.state.outcomeReason = "COMPLETED";
      this.runningStartedAt = undefined;
      this.remainingAtRunningStart = this.state.remainingMs;
      this.stopTimerInterval();
      this.options.onTerminal?.();
      this.options.onTerminal?.();
    }
    return undefined;
  }

  private ruinAndReplace(object: KitchenObject): void {
    for (const candidate of Array.from(this.state.objects.values())) {
      if (
        candidate.id !== object.id
        && candidate.kind === object.kind
        && candidate.preparation === "RUINED"
      ) {
        this.state.objects.delete(candidate.id);
      }
    }

    object.preparation = "RUINED";
    object.location = "COUNTER";
    object.heldBy = "";
    if (this.creditedChops.delete(object.id)) {
      this.state.completedStepCount = Math.max(0, this.state.completedStepCount - 1);
    }

    const replacementIndex = (this.replacementSequence.get(object.kind) ?? 0) + 1;
    this.replacementSequence.set(object.kind, replacementIndex);
    const replacement = this.options.createObject();
    replacement.id = this.uniqueReplacementId(object.kind.toLowerCase(), replacementIndex);
    const placement = createInitialKitchenObjects(
      `${this.options.placementSeed}:replacement:${object.kind}:${replacementIndex}`,
    ).find((candidate) => candidate.kind === object.kind)!;
    replacement.kind = object.kind;
    replacement.label = object.label;
    replacement.x = placement.x;
    replacement.y = placement.y;
    replacement.heldBy = "";
    replacement.preparation = "RAW";
    replacement.location = "COUNTER";
    this.state.objects.set(replacement.id, replacement);
  }

  private uniqueReplacementId(kind: string, replacementIndex: number): string {
    const prefix = `replacement-${kind}-`;
    for (let offset = 0; offset <= this.state.objects.size; offset += 1) {
      const suffix = String(replacementIndex + offset);
      const candidate = `${prefix.slice(0, MAX_OBJECT_ID_LENGTH - suffix.length)}${suffix}`;
      if (!this.state.objects.has(candidate)) return candidate;
    }
    throw new Error("Bounded replacement ID space exhausted");
  }

  private sendError(client: Client, code: CookingErrorCode): void {
    client.send(KITCHEN_MESSAGES.cookingError, { code, message: "Cooking action rejected." });
  }

  private resumeCountdown(): void {
    this.remainingAtRunningStart = this.state.remainingMs;
    this.runningStartedAt = performance.now();
  }

  private reconcileRunningTime(): void {
    if (this.state.roundStatus !== "RUNNING" || this.runningStartedAt === undefined) return;
    const elapsedMs = Math.max(0, performance.now() - this.runningStartedAt);
    const remainingMs = Math.max(
      0,
      Math.ceil(this.remainingAtRunningStart - elapsedMs),
    );
    this.state.remainingMs = remainingMs;
    if (remainingMs === 0) {
      this.state.roundStatus = "LOST";
      this.state.outcomeReason = "TIME_EXPIRED";
      this.runningStartedAt = undefined;
      this.remainingAtRunningStart = 0;
      this.stopTimerInterval();
      this.options.onTerminal?.();
      this.options.onTerminal?.();
    }
  }

  private stopTimerInterval(): void {
    this.timerInterval?.clear();
    this.timerInterval = undefined;
  }
}

function validDuration(value: number | undefined): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value > 0
    && value <= MAX_ROUND_REMAINING_MS;
}
