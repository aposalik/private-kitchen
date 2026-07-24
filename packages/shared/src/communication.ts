import { z } from "zod";

import { KITCHEN_BOUNDS } from "./game-state.js";
import { PLAYER_ROLES, type PlayerRole } from "./roles.js";

export const GESTURES = ["NOD", "SHAKE_HEAD", "THUMBS_UP", "THUMBS_DOWN", "WAVE"] as const;
export const EMOTES = ["URGENT", "CONFUSED", "READY", "CELEBRATE"] as const;
export const RECIPE_CARDS = ["CHOP", "BOIL", "SEASON", "PLATE", "MORE", "LESS", "STOP", "YES", "NO"] as const;
export const DRAWING_COLORS = ["BLACK", "RED", "BLUE", "GREEN"] as const;
export const DRAWING_WIDTHS = ["THIN", "MEDIUM", "THICK"] as const;

export type Gesture = (typeof GESTURES)[number];
export type Emote = (typeof EMOTES)[number];
export type RecipeCard = (typeof RECIPE_CARDS)[number];
export type DrawingColor = (typeof DRAWING_COLORS)[number];
export type DrawingWidth = (typeof DRAWING_WIDTHS)[number];

export const MAX_STROKE_POINTS = 64;
export const MAX_BOARD_STROKES = 32;
export const MAX_OBJECT_REFERENCE_LENGTH = 64;
export const MAX_SDP_LENGTH = 16_384;
export const MAX_ICE_CANDIDATE_LENGTH = 2_048;
export const MAX_SIGNAL_ID_LENGTH = 64;
export const MAX_ACTIVE_VOICE_EDGES = 3;
export const MAX_PENDING_ICE_OFFERS = 3;
export const MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER = 32;

export const COMMUNICATION_MESSAGES = {
  signal: "COMMUNICATION_SIGNAL",
  recipeCard: "RECIPE_CARD",
  drawingStroke: "DRAWING_STROKE",
  drawingClear: "DRAWING_CLEAR",
  event: "COMMUNICATION_EVENT",
  boardSnapshot: "DRAWING_SNAPSHOT",
  error: "COMMUNICATION_ERROR",
  voiceGrant: "VOICE_GRANT",
  voiceSignal: "VOICE_SIGNAL",
  voiceRelay: "VOICE_RELAY",
  ready: "COMMUNICATION_READY",
} as const;

const invalidRecord = Object.freeze({ invalid: true });
function safeRecord(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return invalidRecord;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidRecord;
  if (["__proto__", "prototype", "constructor"].some((key) => Object.prototype.hasOwnProperty.call(value, key))) return invalidRecord;
  return value;
}
const strictObject = <T extends z.ZodRawShape>(shape: T) => z.preprocess(safeRecord, z.strictObject(shape));
const clientSequenceSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const boundedIdSchema = z.string().min(1).max(MAX_SIGNAL_ID_LENGTH);
const finiteCoordinate = (min: number, max: number) => z.number().finite().min(min).max(max);

const pointTargetSchema = z.union([
  strictObject({ kind: z.literal("OBJECT"), objectId: z.string().min(1).max(MAX_OBJECT_REFERENCE_LENGTH) }),
  strictObject({
    kind: z.literal("COORDINATE"),
    x: finiteCoordinate(KITCHEN_BOUNDS.minX, KITCHEN_BOUNDS.maxX),
    y: finiteCoordinate(KITCHEN_BOUNDS.minY, KITCHEN_BOUNDS.maxY),
  }),
]);

export const clientSignalSchema = z.union([
  strictObject({ clientSequence: clientSequenceSchema, kind: z.literal("POINT"), target: pointTargetSchema }),
  strictObject({ clientSequence: clientSequenceSchema, kind: z.literal("GESTURE"), gesture: z.enum(GESTURES) }),
  strictObject({ clientSequence: clientSequenceSchema, kind: z.literal("EMOTE"), emote: z.enum(EMOTES) }),
]);
export const clientRecipeCardSchema = strictObject({ clientSequence: clientSequenceSchema, card: z.enum(RECIPE_CARDS) });
const normalizedPointSchema = strictObject({ x: finiteCoordinate(0, 1), y: finiteCoordinate(0, 1) });
export const clientDrawingStrokeSchema = strictObject({
  clientSequence: clientSequenceSchema,
  color: z.enum(DRAWING_COLORS),
  width: z.enum(DRAWING_WIDTHS),
  points: z.array(normalizedPointSchema).min(2).max(MAX_STROKE_POINTS),
});
export const clientDrawingClearSchema = strictObject({ clientSequence: clientSequenceSchema });

const targetAndSequence = { targetId: boundedIdSchema, clientSequence: clientSequenceSchema };
export const voiceSignalSchema = z.union([
  strictObject({ kind: z.literal("DISABLE"), clientSequence: clientSequenceSchema }),
  strictObject({ kind: z.literal("READY"), ...targetAndSequence }),
  strictObject({ kind: z.literal("OFFER"), ...targetAndSequence, sdp: z.string().min(1).max(MAX_SDP_LENGTH) }),
  strictObject({ kind: z.literal("ANSWER"), ...targetAndSequence, offerId: boundedIdSchema, sdp: z.string().min(1).max(MAX_SDP_LENGTH) }),
  strictObject({
    kind: z.literal("ICE"),
    ...targetAndSequence,
    offerId: boundedIdSchema,
    candidate: z.string().min(1).max(MAX_ICE_CANDIDATE_LENGTH),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable().optional(),
  }),
]);
export const communicationReadySchema = strictObject({});

export type ClientSignal = z.infer<typeof clientSignalSchema>;
export type ClientRecipeCard = z.infer<typeof clientRecipeCardSchema>;
export type ClientDrawingStroke = z.infer<typeof clientDrawingStrokeSchema>;
export type ClientDrawingClear = z.infer<typeof clientDrawingClearSchema>;
export type VoiceSignal = z.infer<typeof voiceSignalSchema>;

export interface VoiceGrant { canPublish: boolean; canReceive: boolean }
export const VOICE_GRANTS: Readonly<Record<PlayerRole, VoiceGrant>> = {
  BLIND_COOK: { canPublish: true, canReceive: true },
  RECIPE_KEEPER: { canPublish: false, canReceive: true },
  DEAF_KITCHEN_GUIDE: { canPublish: false, canReceive: false },
};

export interface ServerEnvelope { senderId: string; senderRole: PlayerRole; sequence: number; timestamp: number }
type WithoutClientSequence<T> = T extends { clientSequence: number }
  ? Omit<T, "clientSequence">
  : never;
export type CommunicationEvent = ServerEnvelope & (
  | WithoutClientSequence<ClientSignal>
  | { kind: "RECIPE_CARD"; card: RecipeCard }
  | { kind: "DRAWING_CLEAR" }
);
export interface DrawingStroke extends ServerEnvelope {
  id: string;
  color: DrawingColor;
  width: DrawingWidth;
  points: readonly { x: number; y: number }[];
}
export interface DrawingSnapshot { strokes: readonly DrawingStroke[] }
export interface CommunicationErrorPayload { code: "INVALID_PAYLOAD" | "NOT_AUTHORIZED" | "STALE_ACTION" | "RATE_LIMITED" | "TARGET_NOT_FOUND" | "VOICE_NOT_AUTHORIZED" | "VOICE_NOT_READY" | "VOICE_EDGE_NOT_FOUND"; message: string }
export type VoiceRelayEnvelope = ServerEnvelope & (
  | { kind: "DISABLED" }
  | { kind: "READY" }
  | { kind: "OFFER"; offerId: string; sdp: string }
  | { kind: "ANSWER"; offerId: string; sdp: string }
  | { kind: "ICE"; offerId: string; candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }
);

export const VISUAL_ROLES = new Set<PlayerRole>(["RECIPE_KEEPER", "DEAF_KITCHEN_GUIDE"]);
export function canReceiveVisual(role: PlayerRole): boolean { return VISUAL_ROLES.has(role); }
export function canSendRecipeContent(role: PlayerRole): boolean { return role === "RECIPE_KEEPER"; }
export function isPlayerRole(value: unknown): value is PlayerRole { return PLAYER_ROLES.includes(value as PlayerRole); }
