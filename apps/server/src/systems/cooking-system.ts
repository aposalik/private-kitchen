import { type Client, type Room } from "@colyseus/core";
import {
  MAX_TOTAL_INGREDIENT_OBJECTS,
  type Recipe,
  type RecipeStep,
} from "@cooking-game/recipe-schema";
import {
  KITCHEN_MESSAGES,
  MAX_OBJECT_ID_LENGTH,
  cookActionSchema,
  createInitialKitchenObjects,
  type CookAction,
  type CookingErrorCode,
  type PlayerRole,
} from "@cooking-game/shared";

import type { KitchenObject, KitchenState } from "../rooms/KitchenRoom.js";

export interface CookingSystemOptions {
  placementSeed: string;
  recipe: Recipe;
  createObject(): KitchenObject;
  onTerminal?(): void;
}

export class CookingSystem {
  private static readonly TIMER_INTERVAL_MS = 20;
  private readonly roundDurationMs: number;
  private started = false;
  private readonly lastActionSequence = new Map<string, number>();
  private readonly creditedChops = new Set<string>();
  private readonly completedByStep = new Map<string, number>();
  private readonly replacementSequence = new Map<string, number>();
  private timerInterval: { clear(): void } | undefined;
  private runningStartedAt: number | undefined;
  private remainingAtRunningStart = 0;

  constructor(
    private readonly state: KitchenState,
    private readonly options: CookingSystemOptions,
  ) {
    this.roundDurationMs = options.recipe.roundDurationMs;
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
    this.completedByStep.clear();
    this.replacementSequence.clear();
  }

  readinessChanged(ready: boolean): void {
    if (!this.started) {
      if (!ready) return;
      this.started = true;
      this.state.roundStatus = "RUNNING";
      this.state.remainingMs = this.roundDurationMs;
      this.state.completedStepCount = 0;
      this.state.totalStepCount = this.options.recipe.steps.reduce(
        (total, step) => total + this.requiredActions(step),
        0,
      );
      this.state.outcomeReason = "NONE";
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

  private handleAction(client: Client, action: CookAction): CookingErrorCode | undefined {
    if (action.action !== "CHOP" && action.action !== "ADD_TO_POT") {
      return this.handleTerminalAction(action.action);
    }
    const object = this.state.objects.get(action.objectId);
    if (!object) return "OBJECT_NOT_FOUND";

    const ingredient = this.options.recipe.ingredients.find(
      (ingredient) => ingredient.kind === object.kind,
    );
    if (!ingredient) return "OUT_OF_ORDER";
    if (object.heldBy !== client.sessionId) return "OBJECT_NOT_OWNED";
    if (object.location !== "COUNTER") return "INVALID_PREPARATION";

    const step = this.options.recipe.steps.find((candidate) =>
      candidate.action === action.action && candidate.ingredientId === ingredient.id
    );
    if (!step) return "OUT_OF_ORDER";

    if (action.action === "CHOP") {
      if (object.preparation === "RAW") {
        if (!this.canAdvance(step)) return "OUT_OF_ORDER";
        object.preparation = "CHOPPED";
        this.creditedChops.add(object.id);
        this.advance(step);
        return undefined;
      }
      if (object.preparation === "CHOPPED") {
        if (this.hasStartedDependent(step.id)) return "OUT_OF_ORDER";
        this.ruinAndReplace(object, step.id);
        return undefined;
      }
      return "INVALID_PREPARATION";
    }

    if (!this.canAdvance(step)) return "OUT_OF_ORDER";
    if (object.preparation !== "CHOPPED") return "INVALID_PREPARATION";
    const countInPot = Array.from(this.state.objects.values()).filter(
      (candidate) => candidate.kind === object.kind && candidate.location === "POT",
    ).length;
    if (countInPot >= ingredient.count) return "OUT_OF_ORDER";
    object.location = "POT";
    object.heldBy = "";
    this.advance(step);
    return undefined;
  }

  private handleTerminalAction(
    action: "SEASON" | "BOIL" | "MIX" | "PLATE",
  ): CookingErrorCode | undefined {
    const step = this.options.recipe.steps.find((candidate) => candidate.action === action);
    if (!step || !this.canAdvance(step)) return "OUT_OF_ORDER";

    this.advance(step);
    if (action === "PLATE") {
      this.state.roundStatus = "WON";
      this.state.outcomeReason = "COMPLETED";
      this.runningStartedAt = undefined;
      this.remainingAtRunningStart = this.state.remainingMs;
      this.stopTimerInterval();
      this.options.onTerminal?.();
    }
    return undefined;
  }

  private requiredActions(step: RecipeStep): number {
    if (step.ingredientId === undefined) return 1;
    return this.options.recipe.ingredients.find(({ id }) => id === step.ingredientId)?.count ?? 0;
  }

  private canAdvance(step: RecipeStep): boolean {
    return (this.completedByStep.get(step.id) ?? 0) < this.requiredActions(step)
      && step.dependsOn.every((dependency) => this.isStepComplete(dependency));
  }

  private isStepComplete(stepId: string): boolean {
    const step = this.options.recipe.steps.find(({ id }) => id === stepId);
    return step !== undefined
      && (this.completedByStep.get(stepId) ?? 0) >= this.requiredActions(step);
  }

  private advance(step: RecipeStep): void {
    this.completedByStep.set(step.id, (this.completedByStep.get(step.id) ?? 0) + 1);
    this.state.completedStepCount += 1;
  }

  private hasStartedDependent(stepId: string): boolean {
    return this.options.recipe.steps.some((step) =>
      step.dependsOn.includes(stepId) && (this.completedByStep.get(step.id) ?? 0) > 0
    );
  }

  private ruinAndReplace(object: KitchenObject, stepId: string): void {
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
      this.completedByStep.set(
        stepId,
        Math.max(0, (this.completedByStep.get(stepId) ?? 0) - 1),
      );
      this.state.completedStepCount = Math.max(0, this.state.completedStepCount - 1);
    }

    if (this.state.objects.size >= MAX_TOTAL_INGREDIENT_OBJECTS) {
      this.state.objects.delete(object.id);
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
    }
  }

  private stopTimerInterval(): void {
    this.timerInterval?.clear();
    this.timerInterval = undefined;
  }
}
