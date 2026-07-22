import { Client, type Room as ClientRoom } from "@colyseus/sdk";
import { afterEach, describe, expect, test } from "vitest";

import {
  COMMUNICATION_MESSAGES,
  MAX_ACTIVE_VOICE_EDGES,
  MAX_BOARD_STROKES,
  MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER,
  MAX_SDP_LENGTH,
  type CommunicationErrorPayload,
  type DrawingSnapshot,
  type DrawingStroke,
  type KitchenRoomState,
  type PlayerRole,
  type VoiceGrant,
  type VoiceRelayEnvelope,
} from "@cooking-game/shared";
import {
  AUDIO_WITHOUT_DIRECTION_SDP,
  RECVONLY_AUDIO_ANSWER_SDP,
  SENDONLY_AUDIO_ANSWER_SDP,
  SENDONLY_AUDIO_APPLICATION_SDP,
  SENDONLY_AUDIO_DIRECT_PORT_SDP,
  SENDONLY_AUDIO_DUPLICATE_PAYLOAD_SDP,
  SENDONLY_AUDIO_EXCESSIVE_PAYLOADS_SDP,
  SENDONLY_AUDIO_NONNUMERIC_PAYLOAD_SDP,
  SENDONLY_AUDIO_NON_WEBRTC_PROTOCOL_SDP,
  SENDONLY_DISABLED_AUDIO_SDP,
  SENDONLY_AUDIO_OFFER_SDP,
  SENDONLY_AUDIO_OUT_OF_RANGE_PAYLOAD_SDP,
  SENDONLY_AUDIO_VIDEO_SDP,
  SENDONLY_AUDIO_WITH_INLINE_CANDIDATE_SDP,
  SENDRECV_AUDIO_SDP,
  RECVONLY_DISABLED_AUDIO_SDP,
  RECVONLY_MISMATCHED_MID_SDP,
  sendonlyNonAudioSdp,
} from "../../../tests/fixtures/voice-sdp.js";
import { startKitchenServer, type RunningKitchenServer } from "../src/index.js";

describe("Phase 3 authoritative communication", () => {
  let running: RunningKitchenServer | undefined;
  const rooms: ClientRoom<KitchenRoomState>[] = [];

  afterEach(async () => {
    await Promise.allSettled(rooms.splice(0).map((room) => room.connection.isOpen ? room.leave() : Promise.resolve()));
    await running?.shutdown();
    running = undefined;
  });

  test("visual signals have exact recipients and server-owned metadata", async () => {
    const byRole = await readyRoom();
    const recipeEvents: unknown[] = [];
    const deafEvents: unknown[] = [];
    const blindEvents: unknown[] = [];
    byRole.RECIPE_KEEPER.onMessage(COMMUNICATION_MESSAGES.event, (value) => recipeEvents.push(value));
    byRole.DEAF_KITCHEN_GUIDE.onMessage(COMMUNICATION_MESSAGES.event, (value) => deafEvents.push(value));
    byRole.BLIND_COOK.onMessage(COMMUNICATION_MESSAGES.event, (value) => blindEvents.push(value));

    byRole.BLIND_COOK.send(COMMUNICATION_MESSAGES.signal, { clientSequence: 1, kind: "GESTURE", gesture: "NOD" });
    await waitFor(() => deafEvents.length === 1 && recipeEvents.length === 1);
    expect(blindEvents).toEqual([]);
    expect(deafEvents[0]).toMatchObject({ kind: "GESTURE", gesture: "NOD", senderId: byRole.BLIND_COOK.sessionId, senderRole: "BLIND_COOK", sequence: 1 });
    expect(deafEvents[0]).toHaveProperty("timestamp");
  });

  test("Recipe Keeper cards and drawing reach Deaf only; rejection is sender-only", async () => {
    const byRole = await readyRoom();
    const deafEvents: unknown[] = [];
    const blindEvents: unknown[] = [];
    byRole.DEAF_KITCHEN_GUIDE.onMessage(COMMUNICATION_MESSAGES.event, (value) => deafEvents.push(value));
    byRole.DEAF_KITCHEN_GUIDE.onMessage(COMMUNICATION_MESSAGES.drawingStroke, (value) => deafEvents.push(value));
    byRole.BLIND_COOK.onMessage(COMMUNICATION_MESSAGES.event, (value) => blindEvents.push(value));
    byRole.BLIND_COOK.onMessage(COMMUNICATION_MESSAGES.drawingStroke, (value) => blindEvents.push(value));

    byRole.RECIPE_KEEPER.send(COMMUNICATION_MESSAGES.recipeCard, { clientSequence: 1, card: "CHOP" });
    byRole.RECIPE_KEEPER.send(COMMUNICATION_MESSAGES.drawingStroke, { clientSequence: 2, color: "RED", width: "THIN", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    await waitFor(() => deafEvents.length === 2);
    expect(blindEvents).toEqual([]);
    expect(deafEvents).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "RECIPE_CARD", card: "CHOP" }), expect.objectContaining({ color: "RED", id: expect.any(String) })]));

    const error = nextMessage<CommunicationErrorPayload>(byRole.DEAF_KITCHEN_GUIDE, COMMUNICATION_MESSAGES.error);
    byRole.DEAF_KITCHEN_GUIDE.send(COMMUNICATION_MESSAGES.recipeCard, { clientSequence: 1, card: "CHOP", senderRole: "RECIPE_KEEPER" });
    await expect(error).resolves.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(deafEvents).toHaveLength(2);
  });

  test("stale and rate-limited actions do not broadcast; reconnect receives capped board snapshot", async () => {
    const byRole = await readyRoom(2);
    const recipe = byRole.RECIPE_KEEPER;
    const deafStrokes: DrawingStroke[] = [];
    byRole.DEAF_KITCHEN_GUIDE.onMessage(COMMUNICATION_MESSAGES.drawingStroke, (value) => deafStrokes.push(value as DrawingStroke));
    recipe.send(COMMUNICATION_MESSAGES.drawingStroke, { clientSequence: 1, color: "BLACK", width: "THIN", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    await waitFor(() => deafStrokes.length === 1);
    const stale = nextMessage<CommunicationErrorPayload>(recipe, COMMUNICATION_MESSAGES.error);
    recipe.send(COMMUNICATION_MESSAGES.drawingStroke, { clientSequence: 1, color: "BLACK", width: "THIN", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    await expect(stale).resolves.toMatchObject({ code: "STALE_ACTION" });

    const limitedPromise = nextMatchingError(recipe, "RATE_LIMITED");
    for (let sequence = 2; sequence <= 8; sequence += 1) {
      recipe.send(COMMUNICATION_MESSAGES.drawingStroke, { clientSequence: sequence, color: "BLUE", width: "MEDIUM", points: [{ x: 0, y: 0 }, { x: sequence / 10, y: 1 }] });
    }
    const limited = await limitedPromise;
    expect(limited.code).toBe("RATE_LIMITED");

    await new Promise((resolve) => setTimeout(resolve, 1_050));
    for (let sequence = 9; sequence < 9 + MAX_BOARD_STROKES + 4; sequence += 1) {
      recipe.send(COMMUNICATION_MESSAGES.drawingStroke, { clientSequence: sequence, color: "GREEN", width: "THICK", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
      await new Promise((resolve) => setTimeout(resolve, 260));
    }
    const token = recipe.reconnectionToken;
    recipe.reconnection.enabled = false;
    recipe.connection.close();
    const reconnected = await new Client(running!.endpoint).reconnect<KitchenRoomState>(token);
    rooms.splice(rooms.indexOf(recipe), 1, reconnected);
    reconnected.onMessage(COMMUNICATION_MESSAGES.voiceGrant, () => undefined);
    const snapshotPromise = nextMessage<DrawingSnapshot>(reconnected, COMMUNICATION_MESSAGES.boardSnapshot);
    reconnected.send(COMMUNICATION_MESSAGES.ready, {});
    const snapshot = await snapshotPromise;
    expect(snapshot.strokes).toHaveLength(MAX_BOARD_STROKES);
  }, 20_000);

  test("voice grants and READY/offer/answer/ICE routing enforce the directed policy", async () => {
    const grants = new Map<PlayerRole, VoiceGrant>();
    const byRole = await readyRoom(undefined, (role, room) => room.onMessage(COMMUNICATION_MESSAGES.voiceGrant, (grant) => grants.set(role, grant as VoiceGrant)));
    await waitFor(() => grants.size === 3);
    expect(grants).toEqual(new Map([
      ["BLIND_COOK", { canPublish: true, canReceive: true }],
      ["RECIPE_KEEPER", { canPublish: false, canReceive: true }],
      ["DEAF_KITCHEN_GUIDE", { canPublish: true, canReceive: false }],
    ]));

    const readyRelay = nextMessage<VoiceRelayEnvelope>(byRole.DEAF_KITCHEN_GUIDE, COMMUNICATION_MESSAGES.voiceRelay);
    byRole.RECIPE_KEEPER.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "READY", targetId: byRole.DEAF_KITCHEN_GUIDE.sessionId, clientSequence: 1 });
    await expect(readyRelay).resolves.toMatchObject({ kind: "READY", senderRole: "RECIPE_KEEPER", senderId: byRole.RECIPE_KEEPER.sessionId });

    const offerRelay = nextMessage<VoiceRelayEnvelope>(byRole.RECIPE_KEEPER, COMMUNICATION_MESSAGES.voiceRelay);
    byRole.DEAF_KITCHEN_GUIDE.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: byRole.RECIPE_KEEPER.sessionId, clientSequence: 1, sdp: SENDONLY_AUDIO_OFFER_SDP });
    const offer = await offerRelay;
    expect(offer).toMatchObject({ kind: "OFFER", senderRole: "DEAF_KITCHEN_GUIDE", sdp: SENDONLY_AUDIO_OFFER_SDP });
    const answerRelay = nextMessage<VoiceRelayEnvelope>(byRole.DEAF_KITCHEN_GUIDE, COMMUNICATION_MESSAGES.voiceRelay);
    byRole.RECIPE_KEEPER.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ANSWER", targetId: byRole.DEAF_KITCHEN_GUIDE.sessionId, clientSequence: 2, offerId: offer.offerId, sdp: RECVONLY_AUDIO_ANSWER_SDP });
    await expect(answerRelay).resolves.toMatchObject({ kind: "ANSWER", offerId: offer.offerId });
    const iceRelay = nextMessage<VoiceRelayEnvelope>(byRole.RECIPE_KEEPER, COMMUNICATION_MESSAGES.voiceRelay);
    byRole.DEAF_KITCHEN_GUIDE.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ICE", targetId: byRole.RECIPE_KEEPER.sessionId, clientSequence: 2, offerId: offer.offerId, candidate: "candidate:1" });
    await expect(iceRelay).resolves.toMatchObject({ kind: "ICE", candidate: "candidate:1" });

    const unauthorized = nextMessage<CommunicationErrorPayload>(byRole.RECIPE_KEEPER, COMMUNICATION_MESSAGES.error);
    byRole.RECIPE_KEEPER.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: byRole.BLIND_COOK.sessionId, clientSequence: 3, sdp: SENDONLY_AUDIO_OFFER_SDP });
    await expect(unauthorized).resolves.toMatchObject({ code: "VOICE_NOT_AUTHORIZED" });
    const oversized = nextMessage<CommunicationErrorPayload>(byRole.BLIND_COOK, COMMUNICATION_MESSAGES.error);
    byRole.BLIND_COOK.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: byRole.RECIPE_KEEPER.sessionId, clientSequence: 1, sdp: "x".repeat(MAX_SDP_LENGTH + 1) });
    await expect(oversized).resolves.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  test("bootstrap is strict, idempotent, rate bounded, and role filtered", async () => {
    const byRole = await readyRoom();
    const blind = byRole.BLIND_COOK;
    const grants: VoiceGrant[] = [];
    blind.onMessage(COMMUNICATION_MESSAGES.voiceGrant, (grant) => grants.push(grant as VoiceGrant));

    const invalid = nextMessage<CommunicationErrorPayload>(blind, COMMUNICATION_MESSAGES.error);
    blind.send(COMMUNICATION_MESSAGES.ready, { role: "RECIPE_KEEPER" });
    await expect(invalid).resolves.toMatchObject({ code: "INVALID_PAYLOAD" });
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    grants.length = 0;

    await expectNoMessage(blind, COMMUNICATION_MESSAGES.boardSnapshot, () => {
      for (let index = 0; index < 4; index += 1) blind.send(COMMUNICATION_MESSAGES.ready, {});
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(grants).toHaveLength(4);
    expect(grants).toEqual(Array.from({ length: 4 }, () => ({ canPublish: true, canReceive: true })));

    const limited = nextMessage<CommunicationErrorPayload>(blind, COMMUNICATION_MESSAGES.error);
    blind.send(COMMUNICATION_MESSAGES.ready, {});
    await expect(limited).resolves.toMatchObject({ code: "RATE_LIMITED" });
  });

  test("voice SDP direction failures are sender-only and never relay", async () => {
    const byRole = await readyRoom();
    const receiver = byRole.RECIPE_KEEPER;
    const publisher = byRole.DEAF_KITCHEN_GUIDE;
    const ready = nextMessage<VoiceRelayEnvelope>(publisher, COMMUNICATION_MESSAGES.voiceRelay);
    receiver.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "READY", targetId: publisher.sessionId, clientSequence: 1 });
    await ready;

    let sequence = 1;
    for (const invalidSdp of [
      "v=0\r\n",
      AUDIO_WITHOUT_DIRECTION_SDP,
      SENDRECV_AUDIO_SDP,
      SENDONLY_AUDIO_VIDEO_SDP,
      SENDONLY_AUDIO_APPLICATION_SDP,
      SENDONLY_DISABLED_AUDIO_SDP,
      SENDONLY_AUDIO_WITH_INLINE_CANDIDATE_SDP,
      SENDONLY_AUDIO_NON_WEBRTC_PROTOCOL_SDP,
      SENDONLY_AUDIO_DIRECT_PORT_SDP,
      SENDONLY_AUDIO_NONNUMERIC_PAYLOAD_SDP,
      SENDONLY_AUDIO_OUT_OF_RANGE_PAYLOAD_SDP,
      SENDONLY_AUDIO_DUPLICATE_PAYLOAD_SDP,
      SENDONLY_AUDIO_EXCESSIVE_PAYLOADS_SDP,
      ...(["video", "text", "image", "message"] as const).map(sendonlyNonAudioSdp),
    ]) {
      const error = nextMessage<CommunicationErrorPayload>(publisher, COMMUNICATION_MESSAGES.error);
      await expectNoMessage(receiver, COMMUNICATION_MESSAGES.voiceRelay, () => {
        publisher.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: receiver.sessionId, clientSequence: sequence++, sdp: invalidSdp });
      });
      await expect(error).resolves.toMatchObject({ code: "INVALID_PAYLOAD" });
    }

    const offerPromise = nextMessage<VoiceRelayEnvelope>(receiver, COMMUNICATION_MESSAGES.voiceRelay);
    publisher.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: receiver.sessionId, clientSequence: sequence++, sdp: SENDONLY_AUDIO_OFFER_SDP });
    const offer = await offerPromise;
    for (const invalidAnswer of [SENDRECV_AUDIO_SDP, SENDONLY_AUDIO_ANSWER_SDP, AUDIO_WITHOUT_DIRECTION_SDP, RECVONLY_DISABLED_AUDIO_SDP, RECVONLY_MISMATCHED_MID_SDP, SENDONLY_AUDIO_APPLICATION_SDP]) {
      const error = nextMessage<CommunicationErrorPayload>(receiver, COMMUNICATION_MESSAGES.error);
      await expectNoMessage(publisher, COMMUNICATION_MESSAGES.voiceRelay, () => {
        receiver.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ANSWER", targetId: publisher.sessionId, clientSequence: ++sequence, offerId: offer.offerId, sdp: invalidAnswer });
      });
      await expect(error).resolves.toMatchObject({ code: "INVALID_PAYLOAD" });
    }
  });

  test("DISABLE revokes only the authoritative sender and notifies involved peers", async () => {
    const byRole = await readyRoom();
    const recipe = byRole.RECIPE_KEEPER;
    const deaf = byRole.DEAF_KITCHEN_GUIDE;
    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "READY", targetId: deaf.sessionId, clientSequence: 1 });
    await nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);

    const disabled = nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "DISABLE", clientSequence: 2 });
    await expect(disabled).resolves.toMatchObject({ kind: "DISABLED", senderId: recipe.sessionId, senderRole: "RECIPE_KEEPER" });

    const error = nextMessage<CommunicationErrorPayload>(deaf, COMMUNICATION_MESSAGES.error);
    await expectNoMessage(recipe, COMMUNICATION_MESSAGES.voiceRelay, () => {
      deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: recipe.sessionId, clientSequence: 1, sdp: SENDONLY_AUDIO_OFFER_SDP });
    });
    await expect(error).resolves.toMatchObject({ code: "VOICE_NOT_READY" });
  });

  test("READY ordering, pair supersession, global edge bound, and ICE burst bounds are enforced", async () => {
    const byRole = await readyRoom();
    const blind = byRole.BLIND_COOK;
    const recipe = byRole.RECIPE_KEEPER;
    const deaf = byRole.DEAF_KITCHEN_GUIDE;

    const notReadyError = nextMessage<CommunicationErrorPayload>(deaf, COMMUNICATION_MESSAGES.error);
    await expectNoMessage(recipe, COMMUNICATION_MESSAGES.voiceRelay, () => {
      deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: recipe.sessionId, clientSequence: 1, sdp: SENDONLY_AUDIO_OFFER_SDP });
    });
    await expect(notReadyError).resolves.toMatchObject({ code: "VOICE_NOT_READY" });

    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "READY", targetId: deaf.sessionId, clientSequence: 1 });
    await nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    const firstPromise = nextMessage<VoiceRelayEnvelope>(recipe, COMMUNICATION_MESSAGES.voiceRelay);
    deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: recipe.sessionId, clientSequence: 2, sdp: SENDONLY_AUDIO_OFFER_SDP });
    const first = await firstPromise;
    const replacementPromise = nextMessage<VoiceRelayEnvelope>(recipe, COMMUNICATION_MESSAGES.voiceRelay);
    deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: recipe.sessionId, clientSequence: 3, sdp: SENDONLY_AUDIO_OFFER_SDP });
    const replacement = await replacementPromise;
    expect(replacement.offerId).not.toBe(first.offerId);

    const staleAnswer = nextMessage<CommunicationErrorPayload>(recipe, COMMUNICATION_MESSAGES.error);
    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ANSWER", targetId: deaf.sessionId, clientSequence: 2, offerId: first.offerId, sdp: RECVONLY_AUDIO_ANSWER_SDP });
    await expect(staleAnswer).resolves.toMatchObject({ code: "VOICE_EDGE_NOT_FOUND" });
    const staleIce = nextMessage<CommunicationErrorPayload>(deaf, COMMUNICATION_MESSAGES.error);
    deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ICE", targetId: recipe.sessionId, clientSequence: 4, offerId: first.offerId, candidate: "candidate:stale" });
    await expect(staleIce).resolves.toMatchObject({ code: "VOICE_EDGE_NOT_FOUND" });

    const answerRelay = nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ANSWER", targetId: deaf.sessionId, clientSequence: 3, offerId: replacement.offerId, sdp: RECVONLY_AUDIO_ANSWER_SDP });
    await answerRelay;

    const iceRelays: VoiceRelayEnvelope[] = [];
    recipe.onMessage(COMMUNICATION_MESSAGES.voiceRelay, (relay) => { if ((relay as VoiceRelayEnvelope).kind === "ICE") iceRelays.push(relay as VoiceRelayEnvelope); });
    for (let index = 0; index < MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER; index += 1) {
      deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ICE", targetId: recipe.sessionId, clientSequence: 5 + index, offerId: replacement.offerId, candidate: `candidate:${index}` });
    }
    await waitFor(() => iceRelays.length === MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER);
    const capped = nextMessage<CommunicationErrorPayload>(deaf, COMMUNICATION_MESSAGES.error);
    deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ICE", targetId: recipe.sessionId, clientSequence: 5 + MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER, offerId: replacement.offerId, candidate: "candidate:overflow" });
    await expect(capped).resolves.toMatchObject({ code: "RATE_LIMITED" });
    expect(iceRelays).toHaveLength(MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER);

    const blindReadyRelay = nextMessage<VoiceRelayEnvelope>(blind, COMMUNICATION_MESSAGES.voiceRelay);
    const deafReadyRelay = nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "READY", targetId: blind.sessionId, clientSequence: 4 });
    blind.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "READY", targetId: deaf.sessionId, clientSequence: 1 });
    await Promise.all([blindReadyRelay, deafReadyRelay]);
    const toRecipe = nextMessage<VoiceRelayEnvelope>(recipe, COMMUNICATION_MESSAGES.voiceRelay);
    blind.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: recipe.sessionId, clientSequence: 2, sdp: SENDONLY_AUDIO_OFFER_SDP });
    const toBlind = nextMessage<VoiceRelayEnvelope>(blind, COMMUNICATION_MESSAGES.voiceRelay);
    deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: blind.sessionId, clientSequence: 6 + MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER, sdp: SENDONLY_AUDIO_OFFER_SDP });
    await Promise.all([toRecipe, toBlind]);
    expect(MAX_ACTIVE_VOICE_EDGES).toBe(3);
  });

  test("unanswered and established voice edges expire", async () => {
    const byRole = await readyRoom(undefined, undefined, { voicePendingEdgeTtlMs: 80, voiceEstablishedEdgeTtlMs: 100 });
    const recipe = byRole.RECIPE_KEEPER;
    const deaf = byRole.DEAF_KITCHEN_GUIDE;
    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "READY", targetId: deaf.sessionId, clientSequence: 1 });
    await nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    const offerPromise = nextMessage<VoiceRelayEnvelope>(recipe, COMMUNICATION_MESSAGES.voiceRelay);
    deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: recipe.sessionId, clientSequence: 1, sdp: SENDONLY_AUDIO_OFFER_SDP });
    const expiredPending = await offerPromise;
    const pendingPublisherDisabled = nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    const pendingReceiverDisabled = nextMessage<VoiceRelayEnvelope>(recipe, COMMUNICATION_MESSAGES.voiceRelay);
    await expect(pendingPublisherDisabled).resolves.toMatchObject({ kind: "DISABLED", senderId: recipe.sessionId, senderRole: "RECIPE_KEEPER" });
    await expect(pendingReceiverDisabled).resolves.toMatchObject({ kind: "DISABLED", senderId: deaf.sessionId, senderRole: "DEAF_KITCHEN_GUIDE" });
    const pendingError = nextMessage<CommunicationErrorPayload>(recipe, COMMUNICATION_MESSAGES.error);
    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ANSWER", targetId: deaf.sessionId, clientSequence: 2, offerId: expiredPending.offerId, sdp: RECVONLY_AUDIO_ANSWER_SDP });
    await expect(pendingError).resolves.toMatchObject({ code: "VOICE_EDGE_NOT_FOUND" });

    const secondOfferPromise = nextMessage<VoiceRelayEnvelope>(recipe, COMMUNICATION_MESSAGES.voiceRelay);
    deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: recipe.sessionId, clientSequence: 2, sdp: SENDONLY_AUDIO_OFFER_SDP });
    const established = await secondOfferPromise;
    const answer = nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ANSWER", targetId: deaf.sessionId, clientSequence: 3, offerId: established.offerId, sdp: RECVONLY_AUDIO_ANSWER_SDP });
    await answer;
    const establishedPublisherDisabled = nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    const establishedReceiverDisabled = nextMessage<VoiceRelayEnvelope>(recipe, COMMUNICATION_MESSAGES.voiceRelay);
    await expect(establishedPublisherDisabled).resolves.toMatchObject({ kind: "DISABLED", senderId: recipe.sessionId, senderRole: "RECIPE_KEEPER" });
    await expect(establishedReceiverDisabled).resolves.toMatchObject({ kind: "DISABLED", senderId: deaf.sessionId, senderRole: "DEAF_KITCHEN_GUIDE" });
    const establishedError = nextMessage<CommunicationErrorPayload>(deaf, COMMUNICATION_MESSAGES.error);
    deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "ICE", targetId: recipe.sessionId, clientSequence: 3, offerId: established.offerId, candidate: "candidate:late" });
    await expect(establishedError).resolves.toMatchObject({ code: "VOICE_EDGE_NOT_FOUND" });
  });

  test("voice readiness expires and authoritatively revokes both endpoints", async () => {
    const byRole = await readyRoom(undefined, undefined, { voicePendingEdgeTtlMs: 1_000, voiceEstablishedEdgeTtlMs: 1_000, voiceReadinessTtlMs: 80 });
    const recipe = byRole.RECIPE_KEEPER;
    const deaf = byRole.DEAF_KITCHEN_GUIDE;
    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "READY", targetId: deaf.sessionId, clientSequence: 1 });
    await nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    const publisherRevoked = nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    const receiverRevoked = nextMessage<VoiceRelayEnvelope>(recipe, COMMUNICATION_MESSAGES.voiceRelay);
    await expect(publisherRevoked).resolves.toMatchObject({ kind: "DISABLED", senderId: recipe.sessionId, senderRole: "RECIPE_KEEPER" });
    await expect(receiverRevoked).resolves.toMatchObject({ kind: "DISABLED", senderId: deaf.sessionId, senderRole: "DEAF_KITCHEN_GUIDE" });

    const error = nextMessage<CommunicationErrorPayload>(deaf, COMMUNICATION_MESSAGES.error);
    await expectNoMessage(recipe, COMMUNICATION_MESSAGES.voiceRelay, () => {
      deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: recipe.sessionId, clientSequence: 1, sdp: SENDONLY_AUDIO_OFFER_SDP });
    });
    await expect(error).resolves.toMatchObject({ code: "VOICE_NOT_READY" });
  });

  test("receiver reconnect clears readiness and requires a fresh bounded handshake", async () => {
    const byRole = await readyRoom(2);
    const recipe = byRole.RECIPE_KEEPER;
    const deaf = byRole.DEAF_KITCHEN_GUIDE;
    const readyRelay = nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    recipe.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "READY", targetId: deaf.sessionId, clientSequence: 1 });
    await readyRelay;
    const firstOffer = nextMessage<VoiceRelayEnvelope>(recipe, COMMUNICATION_MESSAGES.voiceRelay);
    deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: recipe.sessionId, clientSequence: 1, sdp: SENDONLY_AUDIO_OFFER_SDP });
    await firstOffer;

    const token = recipe.reconnectionToken;
    recipe.reconnection.enabled = false;
    recipe.connection.close();
    await waitForState(deaf, (state) => state.status === "WAITING");
    const reconnected = await new Client(running!.endpoint).reconnect<KitchenRoomState>(token);
    rooms.splice(rooms.indexOf(recipe), 1, reconnected);
    registerNoopMessageHandlers(reconnected);
    await waitForState(deaf, (state) => state.status === "READY");

    const missingReady = nextMessage<CommunicationErrorPayload>(deaf, COMMUNICATION_MESSAGES.error);
    await expectNoMessage(reconnected, COMMUNICATION_MESSAGES.voiceRelay, () => {
      deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: reconnected.sessionId, clientSequence: 2, sdp: SENDONLY_AUDIO_OFFER_SDP });
    });
    await expect(missingReady).resolves.toMatchObject({ code: "VOICE_NOT_READY" });

    const freshReadyRelay = nextMessage<VoiceRelayEnvelope>(deaf, COMMUNICATION_MESSAGES.voiceRelay);
    reconnected.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "READY", targetId: deaf.sessionId, clientSequence: 1 });
    await freshReadyRelay;
    const freshOffer = nextMessage<VoiceRelayEnvelope>(reconnected, COMMUNICATION_MESSAGES.voiceRelay);
    deaf.send(COMMUNICATION_MESSAGES.voiceSignal, { kind: "OFFER", targetId: reconnected.sessionId, clientSequence: 3, sdp: SENDONLY_AUDIO_OFFER_SDP });
    await expect(freshOffer).resolves.toMatchObject({ kind: "OFFER", senderId: deaf.sessionId });
  });

  async function readyRoom(grace?: number, beforeReady?: (role: PlayerRole, room: ClientRoom<KitchenRoomState>) => void, voiceTimers?: { voicePendingEdgeTtlMs: number; voiceEstablishedEdgeTtlMs: number; voiceReadinessTtlMs?: number }): Promise<Record<PlayerRole, ClientRoom<KitchenRoomState>>> {
    running = await startKitchenServer({ port: 0, ...(grace ? { reconnectionGraceSeconds: grace } : {}), ...voiceTimers });
    const sdk = new Client(running.endpoint);
    const first = await sdk.create<KitchenRoomState>("kitchen", { displayName: "One" });
    rooms.push(first); registerNoopMessageHandlers(first);
    const firstRole = await waitForSelf(first);
    beforeReady?.(firstRole, first);
    const second = await sdk.joinById<KitchenRoomState>(first.roomId, { displayName: "Two" });
    rooms.push(second); registerNoopMessageHandlers(second);
    const secondRole = await waitForSelf(second);
    beforeReady?.(secondRole, second);
    const third = await sdk.joinById<KitchenRoomState>(first.roomId, { displayName: "Three" });
    rooms.push(third); registerNoopMessageHandlers(third);
    const thirdRole = await waitForSelf(third);
    beforeReady?.(thirdRole, third);
    await waitForState(first, (state) => state.status === "READY");
    const result = {} as Record<PlayerRole, ClientRoom<KitchenRoomState>>;
    for (const room of rooms) {
      const role = room.state.players.get(room.sessionId)!.role;
      result[role] = room;
      if (role !== "BLIND_COOK") {
        room.onMessage(COMMUNICATION_MESSAGES.boardSnapshot, () => undefined);
      }
      room.send(COMMUNICATION_MESSAGES.ready, {});
    }
    return result;
  }
});

function nextMessage<T>(room: ClientRoom<KitchenRoomState>, type: string, timeoutMs = 2_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error(`Timed out waiting for ${type}`)); }, timeoutMs);
    const unsubscribe = room.onMessage(type, (payload) => { clearTimeout(timeout); unsubscribe(); resolve(payload as T); });
  });
}
async function expectNoMessage(room: ClientRoom<KitchenRoomState>, type: string, action: () => void, durationMs = 120): Promise<void> {
  let received = false;
  const unsubscribe = room.onMessage(type, () => { received = true; });
  action();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  unsubscribe();
  expect(received).toBe(false);
}
function registerNoopMessageHandlers(room: ClientRoom<KitchenRoomState>): void {
  for (const type of [
    COMMUNICATION_MESSAGES.voiceGrant,
    COMMUNICATION_MESSAGES.boardSnapshot,
    COMMUNICATION_MESSAGES.event,
    COMMUNICATION_MESSAGES.drawingStroke,
    COMMUNICATION_MESSAGES.error,
    COMMUNICATION_MESSAGES.voiceRelay,
  ]) room.onMessage(type, () => undefined);
}
function nextMatchingError(room: ClientRoom<KitchenRoomState>, code: CommunicationErrorPayload["code"]): Promise<CommunicationErrorPayload> {
  return new Promise((resolve) => room.onMessage(COMMUNICATION_MESSAGES.error, (payload) => { const error = payload as CommunicationErrorPayload; if (error.code === code) resolve(error); }));
}
function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => predicate() ? resolve() : Date.now() - started >= timeoutMs ? reject(new Error("Timed out waiting for condition")) : setTimeout(poll, 10);
    poll();
  });
}
function waitForState(room: ClientRoom<KitchenRoomState>, predicate: (state: KitchenRoomState) => boolean, timeoutMs = 2_000): Promise<void> {
  if (room.state && predicate(room.state)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { subscription.remove(); reject(new Error("Timed out waiting for state")); }, timeoutMs);
    const subscription = room.onStateChange((state) => { if (predicate(state)) { clearTimeout(timeout); subscription.remove(); resolve(); } });
  });
}
async function waitForSelf(room: ClientRoom<KitchenRoomState>): Promise<PlayerRole> {
  await waitForState(room, (state) => state.players?.get(room.sessionId) !== undefined);
  return room.state.players.get(room.sessionId)!.role;
}
