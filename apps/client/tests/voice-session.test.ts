import { describe, expect, test, vi } from "vitest";

import { MAX_PENDING_ICE_OFFERS, type VoiceRelayEnvelope } from "@cooking-game/shared";
import { RECVONLY_AUDIO_ANSWER_SDP, SENDONLY_AUDIO_OFFER_SDP } from "../../../tests/fixtures/voice-sdp.js";
import { VoiceSession, type VoicePeer, type VoiceSessionDependencies } from "../src/voice/VoiceSession.js";

describe("VoiceSession", () => {
  test("a receive-only grant announces readiness without requesting a microphone or originating offers", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await expect(harness.session.enable()).resolves.toBe(true);
    expect(harness.getUserMedia).not.toHaveBeenCalled();
    expect(harness.sent).toEqual([
      { kind: "READY", targetId: "blind" },
    ]);
    expect(harness.connections).toHaveLength(0);
  });

  test("a publisher waits for receiver readiness and uses an explicit sendonly transceiver", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    expect(harness.getUserMedia).not.toHaveBeenCalled();
    await harness.session.enable();
    expect(harness.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(harness.sent).toEqual([]);

    await harness.session.handleRelay(ready("recipe", "RECIPE_KEEPER"), "room-a");
    expect(harness.connections).toHaveLength(1);
    expect(harness.connections[0]!.addTransceiver).toHaveBeenCalledWith(harness.stream.track, { direction: "sendonly", streams: [harness.stream] });
    expect(harness.connections[0]!.getTransceivers()[0]!.direction).toBe("sendonly");
    expect(harness.sent).toContainEqual({ kind: "OFFER", targetId: "recipe", sdp: SENDONLY_AUDIO_OFFER_SDP });
  });

  test("receiver-first READY is cached while disabled, deduped, bounded, and consumed once on enable", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    await harness.session.handleRelay(ready("recipe", "RECIPE_KEEPER"), "room-a");
    await harness.session.handleRelay(ready("recipe", "RECIPE_KEEPER", 2), "room-a");
    await harness.session.handleRelay(ready("blind", "BLIND_COOK", 3), "room-a");
    await harness.session.handleRelay(ready("unknown", "RECIPE_KEEPER", 4), "room-a");
    await harness.session.handleRelay(offer("blind"), "room-a");
    expect(harness.connections).toHaveLength(0);

    await harness.session.enable();
    expect(harness.sent.filter((signal) => signal.kind === "OFFER")).toEqual([
      expect.objectContaining({ targetId: "recipe" }),
    ]);
    expect(harness.connections).toHaveLength(1);
  });

  test("READY arriving while publisher is enabling is consumed after microphone activation", async () => {
    const harness = createHarness();
    const microphone = deferred<FakeStream>();
    harness.getUserMedia.mockImplementationOnce(() => microphone.promise);
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    const enabling = harness.session.enable();
    await harness.session.handleRelay(ready("recipe", "RECIPE_KEEPER"), "room-a");
    expect(harness.connections).toHaveLength(0);
    microphone.resolve(harness.stream);
    await expect(enabling).resolves.toBe(true);
    expect(harness.sent.filter((signal) => signal.kind === "OFFER")).toHaveLength(1);
  });

  test("cached READY is cleared on not-READY, identity change, and disable", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    await harness.session.handleRelay(ready("recipe", "RECIPE_KEEPER"), "room-a");
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), false);
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    await harness.session.enable();
    expect(harness.sent.filter((signal) => signal.kind === "OFFER")).toHaveLength(0);

    harness.session.disable();
    await harness.session.handleRelay(ready("recipe", "RECIPE_KEEPER", 2), "room-a");
    harness.session.configure("room-b", "blind-2", { canPublish: true, canReceive: true }, peers(), true);
    await harness.session.enable();
    expect(harness.sent.filter((signal) => signal.kind === "OFFER")).toHaveLength(0);
  });

  test("an enabled receiver answers with explicit recvonly transceivers and never attaches output without permission", async () => {
    const receiver = createHarness();
    receiver.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await receiver.session.enable();
    await receiver.session.handleRelay(offer("blind"), "room-a");
    expect(receiver.connections[0]!.getTransceivers()).toEqual([expect.objectContaining({ direction: "recvonly" })]);
    expect(receiver.sent).toContainEqual({ kind: "ANSWER", targetId: "blind", offerId: "offer-1", sdp: RECVONLY_AUDIO_ANSWER_SDP });
    receiver.connections[0]!.emitTrack(receiver.stream);
    expect(receiver.audio.srcObject).toBe(receiver.stream);

    const silentGuide = createHarness();
    silentGuide.session.configure("room-a", "deaf", { canPublish: false, canReceive: false }, peers(), true);
    await silentGuide.session.enable();
    await silentGuide.session.handleRelay(offer("blind"), "room-a");
    expect(silentGuide.connections).toHaveLength(0);
    expect(silentGuide.getUserMedia).not.toHaveBeenCalled();
    expect(silentGuide.createAudio).not.toHaveBeenCalled();
  });

  test("publisher enabled before peer arrival negotiates after READY and supersedes a reappearing receiver", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, [{ id: "blind", role: "BLIND_COOK" }], false);
    await harness.session.enable();
    expect(harness.getUserMedia).not.toHaveBeenCalled();

    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    await vi.waitFor(() => expect(harness.getUserMedia).toHaveBeenCalledTimes(1));
    await harness.session.handleRelay(ready("recipe", "RECIPE_KEEPER"), "room-a");
    const original = harness.connections[0]!;
    await harness.session.handleRelay(ready("recipe", "RECIPE_KEEPER", 2), "room-a");
    expect(original.close).toHaveBeenCalled();
    expect(harness.connections).toHaveLength(2);
  });

  test("leaving READY tears down media/peers; returning READY re-announces readiness without a new user gesture", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    await harness.session.enable();
    await harness.session.handleRelay(ready("recipe", "RECIPE_KEEPER"), "room-a");
    const connection = harness.connections[0]!;

    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), false);
    expect(connection.close).toHaveBeenCalled();
    expect(harness.stream.track.stop).toHaveBeenCalled();
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    await vi.waitFor(() => expect(harness.getUserMedia).toHaveBeenCalledTimes(2));
    expect(harness.sent.filter((signal) => signal.kind === "READY")).toHaveLength(0);
  });

  test("out-of-order ICE has fixed offer/candidate bounds and replacement cleans old peer output", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    for (let index = 0; index < MAX_PENDING_ICE_OFFERS + 2; index += 1) {
      await harness.session.handleRelay(ice("blind", `offer-${index}`, `candidate:${index}`), "room-a");
    }
    await harness.session.handleRelay({ ...offer("blind"), offerId: "offer-0" }, "room-a");
    expect(harness.connections[0]!.addIceCandidate).not.toHaveBeenCalled();
    harness.connections[0]!.emitTrack(harness.stream);
    const oldAudio = harness.audios[0]!;
    await harness.session.handleRelay(ice("blind", `offer-${MAX_PENDING_ICE_OFFERS + 1}`, "candidate:new"), "room-a");
    await harness.session.handleRelay({ ...offer("blind"), offerId: `offer-${MAX_PENDING_ICE_OFFERS + 1}` }, "room-a");
    expect(harness.connections[0]!.close).toHaveBeenCalled();
    expect(oldAudio.pause).toHaveBeenCalled();
    expect(oldAudio.remove).toHaveBeenCalled();
    expect(harness.connections[1]!.addIceCandidate).toHaveBeenCalledTimes(1);
  });

  test("remote stream count is bounded and subscribers are notified on attach and removal", async () => {
    const harness = createHarness();
    const counts: number[] = [];
    harness.session.subscribe(() => counts.push(harness.session.remoteStreamCount));
    harness.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    await harness.session.handleRelay(offer("blind"), "room-a");
    harness.connections[0]!.emitTrack(harness.stream);
    expect(harness.session.remoteStreamCount).toBe(1);
    await harness.session.handleRelay({ ...offer("blind"), offerId: "offer-2", sequence: 2 }, "room-a");
    expect(harness.session.remoteStreamCount).toBe(0);
    expect(counts).toEqual(expect.arrayContaining([1, 0]));
  });

  test("permission denial is contained and stale room relays are ignored", async () => {
    const harness = createHarness();
    harness.getUserMedia.mockRejectedValueOnce(new Error("denied"));
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    await expect(harness.session.enable()).resolves.toBe(false);
    expect(harness.session.status).toBe("DENIED");
    const count = harness.connections.length;
    await harness.session.handleRelay(offer("blind"), "room-b");
    expect(harness.connections).toHaveLength(count);
  });

  test("disable during deferred setRemoteDescription closes only the stale peer and never answers or fails", async () => {
    const gate = deferred<void>();
    const harness = createHarness((peer) => peer.setRemoteDescription.mockImplementationOnce(() => gate.promise));
    harness.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    const handling = harness.session.handleRelay(offer("blind"), "room-a");
    await vi.waitFor(() => expect(harness.connections[0]!.setRemoteDescription).toHaveBeenCalled());
    harness.session.disable();
    gate.resolve(undefined);
    await handling;
    expect(harness.connections[0]!.close).toHaveBeenCalledTimes(1);
    expect(harness.connections[0]!.createAnswer).not.toHaveBeenCalled();
    expect(harness.sent.filter((signal) => signal.kind === "ANSWER")).toHaveLength(0);
    expect(harness.sent.filter((signal) => signal.kind === "DISABLE")).toHaveLength(1);
    expect(harness.session.status).toBe("DISABLED");
  });

  test("identity change during deferred setRemoteDescription cannot touch the newer peer", async () => {
    const gate = deferred<void>();
    const harness = createHarness((peer, index) => { if (index === 0) peer.setRemoteDescription.mockImplementationOnce(() => gate.promise); });
    harness.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    const stale = harness.session.handleRelay(offer("blind"), "room-a");
    await vi.waitFor(() => expect(harness.connections[0]!.setRemoteDescription).toHaveBeenCalled());
    harness.session.configure("room-b", "recipe-2", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    await harness.session.handleRelay({ ...offer("blind"), offerId: "offer-new" }, "room-b");
    const newer = harness.connections[1]!;
    gate.resolve(undefined);
    await stale;
    expect(harness.connections[0]!.createAnswer).not.toHaveBeenCalled();
    expect(newer.close).not.toHaveBeenCalled();
    expect(harness.session.status).toBe("ENABLED");
  });

  test("identity change during deferred createAnswer cannot signal, mutate, fail, or close the newer peer", async () => {
    const gate = deferred<{ type: "answer"; sdp: string }>();
    const harness = createHarness((peer, index) => { if (index === 0) peer.createAnswer.mockImplementationOnce(() => gate.promise); });
    harness.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    const stale = harness.session.handleRelay(offer("blind"), "room-a");
    await vi.waitFor(() => expect(harness.connections[0]!.createAnswer).toHaveBeenCalled());
    harness.session.configure("room-b", "recipe-2", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    await harness.session.handleRelay({ ...offer("blind"), offerId: "offer-new" }, "room-b");
    const newer = harness.connections[1]!;
    gate.resolve({ type: "answer", sdp: RECVONLY_AUDIO_ANSWER_SDP });
    await stale;
    expect(harness.sent.filter((signal) => signal.kind === "ANSWER" && signal.offerId === "offer-1")).toHaveLength(0);
    expect(newer.close).not.toHaveBeenCalled();
    expect(harness.session.status).toBe("ENABLED");
  });

  test("disable during deferred createAnswer cannot signal or become FAILED", async () => {
    const gate = deferred<{ type: "answer"; sdp: string }>();
    const harness = createHarness((peer) => peer.createAnswer.mockImplementationOnce(() => gate.promise));
    harness.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    const stale = harness.session.handleRelay(offer("blind"), "room-a");
    await vi.waitFor(() => expect(harness.connections[0]!.createAnswer).toHaveBeenCalled());
    harness.session.disable();
    gate.resolve({ type: "answer", sdp: RECVONLY_AUDIO_ANSWER_SDP });
    await stale;
    expect(harness.sent.filter((signal) => signal.kind === "ANSWER")).toHaveLength(0);
    expect(harness.session.status).toBe("DISABLED");
  });

  test("context change during deferred addIceCandidate cannot disturb a newer peer or set FAILED", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    await harness.session.handleRelay(offer("blind"), "room-a");
    const old = harness.connections[0]!;
    const gate = deferred<void>();
    old.addIceCandidate.mockImplementationOnce(() => gate.promise);
    const stale = harness.session.handleRelay(ice("blind", "offer-1", "candidate:old"), "room-a");
    await vi.waitFor(() => expect(old.addIceCandidate).toHaveBeenCalled());
    harness.session.configure("room-b", "recipe-2", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    await harness.session.handleRelay({ ...offer("blind"), offerId: "offer-new" }, "room-b");
    const newer = harness.connections[1]!;
    gate.resolve(undefined);
    await stale;
    expect(old.close).toHaveBeenCalled();
    expect(newer.close).not.toHaveBeenCalled();
    expect(harness.session.status).toBe("ENABLED");
  });

  test("disable during deferred addIceCandidate closes the old peer without becoming FAILED", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    await harness.session.handleRelay(offer("blind"), "room-a");
    const old = harness.connections[0]!;
    const gate = deferred<void>();
    old.addIceCandidate.mockImplementationOnce(() => gate.promise);
    const stale = harness.session.handleRelay(ice("blind", "offer-1", "candidate:old"), "room-a");
    await vi.waitFor(() => expect(old.addIceCandidate).toHaveBeenCalled());
    harness.session.disable();
    gate.resolve(undefined);
    await stale;
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(harness.session.status).toBe("DISABLED");
  });

  test("authoritative DISABLED closes only a known current peer", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "recipe", { canPublish: false, canReceive: true }, peers(), true);
    await harness.session.enable();
    await harness.session.handleRelay(offer("blind"), "room-a");
    const peer = harness.connections[0]!;
    await harness.session.handleRelay({ ...relay("unknown", "BLIND_COOK", 2), kind: "DISABLED" }, "room-a");
    expect(peer.close).not.toHaveBeenCalled();
    await harness.session.handleRelay({ ...relay("blind", "BLIND_COOK", 3), kind: "DISABLED" }, "room-a");
    expect(peer.close).toHaveBeenCalled();
  });

  test("suspend is idempotent, preserves explicit opt-in, and never creates a microphone before enable", async () => {
    const harness = createHarness();
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    harness.session.suspend();
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    expect(harness.getUserMedia).not.toHaveBeenCalled();
    await harness.session.enable();
    expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
    harness.session.suspend();
    harness.session.suspend();
    expect(harness.sent.filter((signal) => signal.kind === "DISABLE")).toHaveLength(0);
    harness.session.configure("room-a", "blind", { canPublish: true, canReceive: true }, peers(), true);
    await vi.waitFor(() => expect(harness.getUserMedia).toHaveBeenCalledTimes(2));
    expect(harness.session.status).toBe("ENABLED");
  });
});

function peers(): VoicePeer[] {
  return [
    { id: "blind", role: "BLIND_COOK" },
    { id: "recipe", role: "RECIPE_KEEPER" },
    { id: "deaf", role: "DEAF_KITCHEN_GUIDE" },
  ];
}
function relay(senderId: string, senderRole: VoiceRelayEnvelope["senderRole"], sequence = 1) {
  return { senderId, senderRole, sequence, timestamp: sequence };
}
function ready(senderId: string, senderRole: VoiceRelayEnvelope["senderRole"], sequence = 1): VoiceRelayEnvelope {
  return { ...relay(senderId, senderRole, sequence), kind: "READY" };
}
function offer(senderId: string): VoiceRelayEnvelope {
  return { ...relay(senderId, senderId === "deaf" ? "DEAF_KITCHEN_GUIDE" : "BLIND_COOK"), kind: "OFFER", offerId: "offer-1", sdp: SENDONLY_AUDIO_OFFER_SDP };
}
function ice(senderId: string, offerId: string, candidate: string): VoiceRelayEnvelope {
  return { ...relay(senderId, senderId === "blind" ? "BLIND_COOK" : "DEAF_KITCHEN_GUIDE"), kind: "ICE", offerId, candidate };
}

class FakeTrack { kind = "audio"; stop = vi.fn(); }
class FakeStream {
  track = new FakeTrack();
  getTracks(): FakeTrack[] { return [this.track]; }
}
class FakeTransceiver {
  direction: RTCRtpTransceiverDirection;
  receiver = { track: { kind: "audio" } };
  constructor(direction: RTCRtpTransceiverDirection) { this.direction = direction; }
}
class FakePeerConnection {
  onicecandidate: ((event: { candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null }) => void) | null = null;
  ontrack: ((event: { streams: FakeStream[] }) => void) | null = null;
  transceivers: FakeTransceiver[] = [];
  addTransceiver = vi.fn((_track: FakeTrack | "audio", init: { direction: RTCRtpTransceiverDirection }) => {
    const transceiver = new FakeTransceiver(init.direction);
    this.transceivers.push(transceiver);
    return transceiver;
  });
  getTransceivers = vi.fn(() => this.transceivers);
  createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: SENDONLY_AUDIO_OFFER_SDP }));
  createAnswer = vi.fn(async () => ({ type: "answer" as const, sdp: RECVONLY_AUDIO_ANSWER_SDP }));
  setLocalDescription = vi.fn(async () => undefined);
  setRemoteDescription = vi.fn(async (description: { type: "offer" | "answer" }) => {
    if (description.type === "offer" && this.transceivers.length === 0) this.transceivers.push(new FakeTransceiver("sendrecv"));
  });
  addIceCandidate = vi.fn(async () => undefined);
  close = vi.fn();
  emitTrack(stream: FakeStream): void { this.ontrack?.({ streams: [stream] }); }
}
function createHarness(configurePeer?: (peer: FakePeerConnection, index: number) => void) {
  const sent: Array<Record<string, unknown>> = [];
  const stream = new FakeStream();
  const getUserMedia = vi.fn(async () => stream);
  const connections: FakePeerConnection[] = [];
  const audios: Array<{ srcObject: unknown; controls: boolean; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }> = [];
  const createAudio = vi.fn(() => {
    const audio = { srcObject: null as unknown, controls: false, play: vi.fn(async () => undefined), pause: vi.fn(), remove: vi.fn() };
    audios.push(audio);
    return audio;
  });
  const dependencies: VoiceSessionDependencies = {
    mediaDevices: { getUserMedia },
    createPeerConnection: () => { const peer = new FakePeerConnection(); configurePeer?.(peer, connections.length); connections.push(peer); return peer; },
    createAudioElement: createAudio,
  };
  const session = new VoiceSession({ sendVoiceSignal: (signal) => sent.push(signal as unknown as Record<string, unknown>) }, dependencies);
  return { session, sent, stream, getUserMedia, connections, audios, get audio() { return audios[0]!; }, createAudio };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
