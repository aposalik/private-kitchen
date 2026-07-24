import { isPlayerRole, type PlayerRole } from "@cooking-game/shared";

export const PLAYTEST_FEEDBACK_KEY =
  "cooperative-cooking:phase7:playtest-feedback";
const MAX_RECORDS = 30;
const MAX_STEPS = 1_000;
const MAX_DURATION_SECONDS = 86_400;

const REPLAY_INTENTS = ["YES", "MAYBE", "NO"] as const;
const MISUNDERSTOOD_SIGNALS = [
  "POINT",
  "GESTURE",
  "EMOTE",
  "RECIPE_CARD",
  "DRAWING",
  "VOICE",
  "NONE",
] as const;

export type ReplayIntent = (typeof REPLAY_INTENTS)[number];
export type MisunderstoodSignal = (typeof MISUNDERSTOOD_SIGNALS)[number];

export interface PlaytestRecordInput {
  readonly schemaVersion: 1;
  readonly role: PlayerRole;
  readonly roundOutcome: "WON" | "LOST";
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly observedDurationSeconds: number;
  readonly participationRating: number;
  readonly communicationClarity: number;
  readonly frustration: number;
  readonly replayIntent: ReplayIntent;
  readonly misunderstoodSignals: readonly MisunderstoodSignal[];
}

export interface PlaytestRecord extends PlaytestRecordInput {
  readonly timestamp: string;
}

const RECORD_KEYS = [
  "schemaVersion",
  "role",
  "roundOutcome",
  "completedSteps",
  "totalSteps",
  "observedDurationSeconds",
  "participationRating",
  "communicationClarity",
  "frustration",
  "replayIntent",
  "misunderstoodSignals",
  "timestamp",
] as const;

export function validatePlaytestRecord(value: unknown): PlaytestRecord {
  if (!isPlainRecord(value)) throw new Error("Invalid playtest record.");
  const keys = Object.keys(value);
  if (keys.length !== RECORD_KEYS.length || keys.some((key) => !RECORD_KEYS.includes(key as never))) {
    throw new Error("Invalid playtest record fields.");
  }
  if (value.schemaVersion !== 1) throw new Error("Invalid schema version.");
  if (!isPlayerRole(value.role)) throw new Error("Invalid role.");
  if (value.roundOutcome !== "WON" && value.roundOutcome !== "LOST") {
    throw new Error("Invalid round outcome.");
  }
  if (!boundedInteger(value.totalSteps, 0, MAX_STEPS)
    || !boundedInteger(value.completedSteps, 0, value.totalSteps)) {
    throw new Error("Invalid step counts.");
  }
  if (!boundedInteger(value.observedDurationSeconds, 0, MAX_DURATION_SECONDS)) {
    throw new Error("Invalid duration.");
  }
  for (const key of ["participationRating", "communicationClarity", "frustration"] as const) {
    if (!boundedInteger(value[key], 1, 5)) throw new Error(`Invalid ${key}.`);
  }
  if (!REPLAY_INTENTS.includes(value.replayIntent as ReplayIntent)) {
    throw new Error("Invalid replay intent.");
  }
  if (!Array.isArray(value.misunderstoodSignals)
    || value.misunderstoodSignals.length < 1
    || value.misunderstoodSignals.length > MISUNDERSTOOD_SIGNALS.length
    || value.misunderstoodSignals.some((signal) =>
      typeof signal !== "string"
      || !MISUNDERSTOOD_SIGNALS.includes(signal as MisunderstoodSignal))
    || new Set(value.misunderstoodSignals).size !== value.misunderstoodSignals.length
    || (value.misunderstoodSignals.includes("NONE")
      && value.misunderstoodSignals.length !== 1)) {
    throw new Error("Invalid misunderstood signals.");
  }
  if (typeof value.timestamp !== "string"
    || !Number.isFinite(Date.parse(value.timestamp))
    || new Date(value.timestamp).toISOString() !== value.timestamp) {
    throw new Error("Invalid timestamp.");
  }
  return value as unknown as PlaytestRecord;
}

export class PlaytestFeedbackStore {
  constructor(
    private readonly storage: Storage,
    private readonly timestamp: () => string = () => new Date().toISOString(),
  ) {}

  append(input: PlaytestRecordInput): PlaytestRecord {
    const record = validatePlaytestRecord({ ...input, timestamp: this.timestamp() });
    const records = [...this.read(), record].slice(-MAX_RECORDS);
    this.storage.setItem(PLAYTEST_FEEDBACK_KEY, JSON.stringify(records));
    return record;
  }

  read(): PlaytestRecord[] {
    let serialized: string | null;
    try {
      serialized = this.storage.getItem(PLAYTEST_FEEDBACK_KEY);
    } catch {
      return [];
    }
    if (serialized === null) return [];
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((record) => {
        try {
          return [validatePlaytestRecord(record)];
        } catch {
          return [];
        }
      }).slice(-MAX_RECORDS);
    } catch {
      return [];
    }
  }

  clear(): void {
    this.storage.removeItem(PLAYTEST_FEEDBACK_KEY);
  }

  exportJson(): string {
    return `${JSON.stringify(this.read(), null, 2)}\n`;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}
