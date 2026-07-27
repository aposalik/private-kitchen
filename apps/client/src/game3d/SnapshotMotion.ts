import { PLAYER_MOVEMENT_SPEED } from "@cooking-game/shared";

export interface MotionTransform {
  readonly x: number;
  readonly z: number;
  readonly facingYaw: number;
}

export interface PredictedInput {
  readonly sequence: number;
  readonly axisX: number;
  readonly axisZ: number;
}

interface TimedTransform extends MotionTransform {
  readonly at: number;
}

export class RemoteSnapshotInterpolator {
  private readonly samples = new Map<string, [TimedTransform, TimedTransform]>();

  push(id: string, transform: MotionTransform, at: number): void {
    const next = { ...transform, at };
    const current = this.samples.get(id);
    this.samples.set(id, current ? [current[1], next] : [next, next]);
  }

  sample(id: string, at: number): MotionTransform | undefined {
    const pair = this.samples.get(id);
    if (!pair) return undefined;
    const [from, to] = pair;
    const duration = Math.max(1, to.at - from.at);
    const amount = Math.min(1, Math.max(0, (at - from.at) / duration));
    return {
      x: lerp(from.x, to.x, amount),
      z: lerp(from.z, to.z, amount),
      facingYaw: lerpAngle(from.facingYaw, to.facingYaw, amount),
    };
  }

  removeExcept(ids: ReadonlySet<string>): void {
    for (const id of this.samples.keys()) {
      if (!ids.has(id)) this.samples.delete(id);
    }
  }
}

export class LocalPrediction {
  private authoritative: MotionTransform;
  private predicted: MotionTransform;
  private readonly pending: Array<PredictedInput & { readonly deltaSeconds: number }> = [];
  private activeInput: PredictedInput | undefined;

  constructor(initial: MotionTransform) {
    this.authoritative = { ...initial };
    this.predicted = { ...initial };
  }

  get presentation(): MotionTransform {
    return { ...this.predicted };
  }

  get pendingSequences(): number[] {
    return this.pending.map(({ sequence }) => sequence);
  }

  applyInput(input: PredictedInput, deltaSeconds: number): void {
    const latest = this.pending.at(-1);
    if (latest && input.sequence < latest.sequence) return;
    const boundedDelta = Math.min(0.1, Math.max(0, deltaSeconds));
    this.activeInput = input;
    if (latest && input.sequence === latest.sequence) {
      this.pending[this.pending.length - 1] = {
        ...input,
        deltaSeconds: latest.deltaSeconds,
      };
      this.predicted = this.pending.reduce(
        (transform, pendingInput) => integrate(
          transform,
          pendingInput,
          pendingInput.deltaSeconds,
        ),
        this.authoritative,
      );
      return;
    }
    this.pending.push({ ...input, deltaSeconds: boundedDelta });
    this.predicted = integrate(this.predicted, input, boundedDelta);
  }

  advance(deltaSeconds: number): void {
    if (!this.activeInput) return;
    this.predicted = integrate(
      this.predicted,
      this.activeInput,
      Math.min(0.1, Math.max(0, deltaSeconds)),
    );
  }

  reconcile(server: MotionTransform & {
    readonly lastProcessedMovementSequence: number;
  }): void {
    this.authoritative = {
      x: server.x,
      z: server.z,
      facingYaw: server.facingYaw,
    };
    while (
      this.pending[0]
      && this.pending[0].sequence <= server.lastProcessedMovementSequence
    ) {
      this.pending.shift();
    }
    this.predicted = this.pending.reduce(
      (transform, input) => integrate(transform, input, input.deltaSeconds),
      this.authoritative,
    );
  }
}

function integrate(
  transform: MotionTransform,
  input: Pick<PredictedInput, "axisX" | "axisZ">,
  deltaSeconds: number,
): MotionTransform {
  const magnitude = Math.hypot(input.axisX, input.axisZ);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  const axisX = input.axisX * scale;
  const axisZ = input.axisZ * scale;
  return {
    x: transform.x + axisX * PLAYER_MOVEMENT_SPEED * deltaSeconds,
    z: transform.z + axisZ * PLAYER_MOVEMENT_SPEED * deltaSeconds,
    facingYaw: magnitude > 0
      ? Math.atan2(axisX, axisZ)
      : transform.facingYaw,
  };
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function lerpAngle(from: number, to: number, amount: number): number {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + difference * amount;
}
