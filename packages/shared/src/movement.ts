import { z } from "zod";

import { MAX_ACTION_SEQUENCE } from "./actions.js";

export const MOVEMENT_SIMULATION_INTERVAL_MS = 50;
export const MOVEMENT_SEND_INTERVAL_MS = 50;
export const PLAYER_MOVEMENT_SPEED = 18;
export const GAMEPAD_DEAD_ZONE = 0.2;
export const LOCOMOTION_STATES = ["IDLE", "MOVE"] as const;

export type LocomotionState = (typeof LOCOMOTION_STATES)[number];

const finiteAxisSchema = z.number().finite().min(-1).max(1);
const invalidRecord = Object.freeze({ invalid: true });

function safeRecord(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return invalidRecord;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidRecord;
  if (["__proto__", "prototype", "constructor"].some(
    (key) => Object.prototype.hasOwnProperty.call(value, key),
  )) return invalidRecord;
  return value;
}

export const movementIntentSchema = z.preprocess(
  safeRecord,
  z.strictObject({
    sequence: z.number().int().min(1).max(MAX_ACTION_SEQUENCE),
    axisX: finiteAxisSchema,
    axisZ: finiteAxisSchema,
  }).superRefine(({ axisX, axisZ }, context) => {
    if (axisX * axisX + axisZ * axisZ > 1 + Number.EPSILON * 8) {
      context.addIssue({
        code: "custom",
        message: "Movement axes must form a normalized vector",
        path: ["axisX"],
      });
    }
  }),
);

export const playerTransformSchema = z.strictObject({
  x: z.number().finite(),
  z: z.number().finite(),
  facingYaw: z.number().finite(),
  locomotion: z.enum(LOCOMOTION_STATES),
  lastProcessedMovementSequence: z.number().int().min(0).max(MAX_ACTION_SEQUENCE),
});

export type MovementIntent = z.infer<typeof movementIntentSchema>;
export type PlayerTransform = z.infer<typeof playerTransformSchema>;
