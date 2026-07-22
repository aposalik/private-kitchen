import { describe, expect, test } from "vitest";

import {
  DRAWING_COLORS,
  DRAWING_WIDTHS,
  GESTURES,
  MAX_ICE_CANDIDATE_LENGTH,
  MAX_SDP_LENGTH,
  MAX_STROKE_POINTS,
  RECIPE_CARDS,
  clientDrawingStrokeSchema,
  clientRecipeCardSchema,
  clientSignalSchema,
  voiceSignalSchema,
} from "../src/communication.js";
import { SENDONLY_AUDIO_OFFER_SDP } from "../../../tests/fixtures/voice-sdp.js";

describe("constrained communication schemas", () => {
  test("accepts only enumerated signals and bounded pointing targets", () => {
    expect(clientSignalSchema.parse({ clientSequence: 1, kind: "GESTURE", gesture: "NOD" })).toEqual({
      clientSequence: 1,
      kind: "GESTURE",
      gesture: "NOD",
    });
    expect(clientSignalSchema.parse({ clientSequence: 2, kind: "POINT", target: { kind: "COORDINATE", x: 0, y: 60 } })).toBeTruthy();
    expect(() => clientSignalSchema.parse({ clientSequence: 3, kind: "GESTURE", gesture: "SAY_HELLO" })).toThrow();
    expect(() => clientSignalSchema.parse({ clientSequence: 4, kind: "POINT", target: { kind: "COORDINATE", x: -1, y: 2 } })).toThrow();
    expect(() => clientSignalSchema.parse({ clientSequence: 5, kind: "POINT", target: { kind: "COORDINATE", x: Number.NaN, y: 2 } })).toThrow();
  });

  test("rejects free text, metadata, unknown keys, and pollution-shaped objects", () => {
    for (const payload of [
      { clientSequence: 1, kind: "EMOTE", emote: "READY", text: "meet me" },
      { clientSequence: 1, card: "CHOP", senderId: "forged" },
      { clientSequence: 1, card: "CHOP", timestamp: Date.now() },
      Object.assign(Object.create({ polluted: true }), { clientSequence: 1, card: "CHOP" }),
      JSON.parse('{"clientSequence":1,"card":"CHOP","__proto__":{"polluted":true}}'),
    ]) {
      expect(clientRecipeCardSchema.safeParse(payload).success).toBe(false);
    }
  });

  test("bounds normalized drawing strokes without any text primitive", () => {
    const valid = {
      clientSequence: 1,
      color: DRAWING_COLORS[0],
      width: DRAWING_WIDTHS[0],
      points: [{ x: 0, y: 1 }, { x: 0.5, y: 0.25 }],
    };
    expect(clientDrawingStrokeSchema.parse(valid)).toEqual(valid);
    expect(() => clientDrawingStrokeSchema.parse({ ...valid, text: "onion" })).toThrow();
    expect(() => clientDrawingStrokeSchema.parse({ ...valid, points: Array.from({ length: MAX_STROKE_POINTS + 1 }, () => ({ x: 0.5, y: 0.5 })) })).toThrow();
    expect(() => clientDrawingStrokeSchema.parse({ ...valid, points: [{ x: Infinity, y: 0 }] })).toThrow();
    expect(() => clientDrawingStrokeSchema.parse({ ...valid, points: [{ x: 1.01, y: 0 }] })).toThrow();
  });

  test("exports the exact finite vocabularies", () => {
    expect(GESTURES).toEqual(["NOD", "SHAKE_HEAD", "THUMBS_UP", "THUMBS_DOWN", "WAVE"]);
    expect(RECIPE_CARDS).toEqual(["CHOP", "BOIL", "SEASON", "PLATE", "MORE", "LESS", "STOP", "YES", "NO"]);
  });

  test("strictly bounds readiness, WebRTC offer, answer, and ICE inputs", () => {
    expect(voiceSignalSchema.parse({ kind: "READY", targetId: "publisher", clientSequence: 1 })).toEqual({ kind: "READY", targetId: "publisher", clientSequence: 1 });
    expect(voiceSignalSchema.parse({ kind: "OFFER", targetId: "target", clientSequence: 2, sdp: SENDONLY_AUDIO_OFFER_SDP })).toBeTruthy();
    expect(() => voiceSignalSchema.parse({ kind: "OFFER", targetId: "target", clientSequence: 1, sdp: "x".repeat(MAX_SDP_LENGTH + 1) })).toThrow();
    expect(() => voiceSignalSchema.parse({ kind: "ICE", targetId: "target", clientSequence: 2, offerId: "offer", candidate: "x".repeat(MAX_ICE_CANDIDATE_LENGTH + 1) })).toThrow();
    expect(() => voiceSignalSchema.parse({ kind: "ANSWER", targetId: "target", clientSequence: 2, offerId: "offer", sdp: "v=0", url: "https://evil.invalid" })).toThrow();
    expect(() => voiceSignalSchema.parse({ kind: "READY", targetId: "publisher", clientSequence: 3, offerId: "forged" })).toThrow();
    expect(voiceSignalSchema.parse({ kind: "DISABLE", clientSequence: 4 })).toEqual({ kind: "DISABLE", clientSequence: 4 });
    expect(() => voiceSignalSchema.parse({ kind: "DISABLE", clientSequence: 5, targetId: "other-player" })).toThrow();
  });
});
