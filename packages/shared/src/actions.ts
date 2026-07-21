export const KITCHEN_MESSAGES = {
  pickUp: "PICK_UP",
  drop: "DROP",
  interactionError: "INTERACTION_ERROR",
} as const;

export const MAX_OBJECT_ID_LENGTH = 64;

export interface PickUpPayload {
  objectId: string;
}

export interface DropPayload {
  objectId: string;
  x: number;
  y: number;
}

export const INTERACTION_ERROR_CODES = [
  "INVALID_COMMAND",
  "NOT_READY",
  "NOT_AUTHORIZED",
  "OBJECT_NOT_FOUND",
  "OBJECT_UNAVAILABLE",
  "ALREADY_HOLDING",
  "OUT_OF_REACH",
  "NOT_HOLDER",
  "INVALID_DESTINATION",
] as const;

export type InteractionErrorCode = (typeof INTERACTION_ERROR_CODES)[number];

export interface InteractionErrorPayload {
  code: InteractionErrorCode;
  message: string;
}
