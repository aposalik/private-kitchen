import type { Client, Room } from "@colyseus/core";
import { randomUUID } from "node:crypto";

import {
  COMMUNICATION_MESSAGES,
  MAX_ACTIVE_VOICE_EDGES,
  MAX_BOARD_STROKES,
  MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER,
  VOICE_GRANTS,
  canReceiveVisual,
  canSendRecipeContent,
  communicationReadySchema,
  clientDrawingClearSchema,
  clientDrawingStrokeSchema,
  clientRecipeCardSchema,
  clientSignalSchema,
  voiceSignalSchema,
  type ClientDrawingClear,
  type ClientDrawingStroke,
  type ClientRecipeCard,
  type ClientSignal,
  type CommunicationErrorPayload,
  type DrawingStroke,
  type PlayerRole,
  type VoiceSignal,
} from "@cooking-game/shared";

interface CommunicationAuthority {
  roleOf(sessionId: string): PlayerRole | undefined;
  hasObject(objectId: string): boolean;
  isReady(): boolean;
}

interface VoiceEdge {
  offerId: string;
  publisherId: string;
  receiverId: string;
  answered: boolean;
  iceByPeer: Map<string, number>;
  mediaMids: readonly string[];
  timer?: TimerHandle;
}

interface TimerHandle { clear(): void }
interface VoiceReadiness { publisherId: string; receiverId: string; timer: TimerHandle }

export interface VoiceAuthorityOptions {
  pendingEdgeTtlMs?: number;
  establishedEdgeTtlMs?: number;
  readinessTtlMs?: number;
}

const SIGNAL_RATE = { count: 8, windowMs: 1_000 } as const;
const STROKE_RATE = { count: 4, windowMs: 1_000 } as const;
const VOICE_CONTROL_RATE = { count: 12, windowMs: 1_000 } as const;
const ICE_RATE = { count: 64, windowMs: 1_000 } as const;
const BOOTSTRAP_RATE = { count: 4, windowMs: 1_000 } as const;
const DEFAULT_PENDING_EDGE_TTL_MS = 15_000;
const DEFAULT_ESTABLISHED_EDGE_TTL_MS = 5 * 60_000;
const DEFAULT_READINESS_TTL_MS = 10 * 60_000;

export class CommunicationSystem {
  private readonly strokes: DrawingStroke[] = [];
  private readonly lastClientSequence = new Map<string, number>();
  private readonly rateWindows = new Map<string, number[]>();
  private readonly voiceEdges = new Map<string, VoiceEdge>();
  private readonly voiceEdgeByPair = new Map<string, string>();
  private readonly voiceReadiness = new Map<string, VoiceReadiness>();
  private readonly pendingEdgeTtlMs: number;
  private readonly establishedEdgeTtlMs: number;
  private readonly readinessTtlMs: number;
  private serverSequence = 0;

  constructor(
    private readonly room: Room,
    private readonly authority: CommunicationAuthority,
    options: VoiceAuthorityOptions = {},
  ) {
    this.pendingEdgeTtlMs = positiveDuration(options.pendingEdgeTtlMs, DEFAULT_PENDING_EDGE_TTL_MS);
    this.establishedEdgeTtlMs = positiveDuration(options.establishedEdgeTtlMs, DEFAULT_ESTABLISHED_EDGE_TTL_MS);
    this.readinessTtlMs = positiveDuration(options.readinessTtlMs, DEFAULT_READINESS_TTL_MS);
  }

  register(): void {
    this.room.onMessage(COMMUNICATION_MESSAGES.signal, (client, payload: unknown) => this.handleSignal(client, payload));
    this.room.onMessage(COMMUNICATION_MESSAGES.recipeCard, (client, payload: unknown) => this.handleRecipeCard(client, payload));
    this.room.onMessage(COMMUNICATION_MESSAGES.drawingStroke, (client, payload: unknown) => this.handleStroke(client, payload));
    this.room.onMessage(COMMUNICATION_MESSAGES.drawingClear, (client, payload: unknown) => this.handleClear(client, payload));
    this.room.onMessage(COMMUNICATION_MESSAGES.voiceSignal, (client, payload: unknown) => this.handleVoiceSignal(client, payload));
    this.room.onMessage(COMMUNICATION_MESSAGES.ready, (client, payload: unknown) => this.handleBootstrap(client, payload));
  }

  connected(_client: Client): void {}

  disconnected(sessionId: string, _permanent: boolean): void {
    this.clearPeerVoiceState(sessionId);
    this.rateWindows.delete(`${sessionId}:signal`);
    this.rateWindows.delete(`${sessionId}:stroke`);
    this.rateWindows.delete(`${sessionId}:voice`);
    this.rateWindows.delete(`${sessionId}:ice`);
    this.rateWindows.delete(`${sessionId}:bootstrap`);
    // A dropped transport cannot route further actions. Reset its inbound
    // sequence so a fresh browser instance may resume the reserved identity.
    this.lastClientSequence.delete(sessionId);
  }

  roomReadinessChanged(ready: boolean): void {
    if (!ready) this.clearVoiceState();
  }

  dispose(): void {
    this.clearVoiceState();
    this.rateWindows.clear();
    this.lastClientSequence.clear();
  }

  private handleSignal(client: Client, raw: unknown): void {
    const parsed = clientSignalSchema.safeParse(raw);
    if (!parsed.success) return this.error(client, "INVALID_PAYLOAD", "Invalid communication payload.");
    if (!this.acceptSequence(client, parsed.data.clientSequence) || !this.acceptRate(client, "signal", SIGNAL_RATE)) return;
    if (parsed.data.kind === "POINT" && parsed.data.target.kind === "OBJECT" && !this.authority.hasObject(parsed.data.target.objectId)) {
      return this.error(client, "TARGET_NOT_FOUND", "Point target was not found.");
    }
    const { clientSequence: _ignored, ...signal } = parsed.data;
    this.sendVisual(COMMUNICATION_MESSAGES.event, { ...this.envelope(client), ...signal });
  }

  private handleRecipeCard(client: Client, raw: unknown): void {
    const parsed = clientRecipeCardSchema.safeParse(raw);
    if (!parsed.success) return this.error(client, "INVALID_PAYLOAD", "Invalid recipe card payload.");
    if (!this.acceptSequence(client, parsed.data.clientSequence) || !this.acceptRate(client, "signal", SIGNAL_RATE)) return;
    if (!canSendRecipeContent(this.authority.roleOf(client.sessionId) ?? "BLIND_COOK")) {
      return this.error(client, "NOT_AUTHORIZED", "Only the Recipe Keeper may send recipe cards.");
    }
    this.broadcastCard(client, parsed.data);
  }

  private handleStroke(client: Client, raw: unknown): void {
    const parsed = clientDrawingStrokeSchema.safeParse(raw);
    if (!parsed.success) return this.error(client, "INVALID_PAYLOAD", "Invalid drawing stroke payload.");
    if (!this.acceptSequence(client, parsed.data.clientSequence) || !this.acceptRate(client, "stroke", STROKE_RATE)) return;
    if (!canSendRecipeContent(this.authority.roleOf(client.sessionId) ?? "BLIND_COOK")) {
      return this.error(client, "NOT_AUTHORIZED", "Only the Recipe Keeper may draw.");
    }
    this.broadcastStroke(client, parsed.data);
  }

  private handleClear(client: Client, raw: unknown): void {
    const parsed = clientDrawingClearSchema.safeParse(raw);
    if (!parsed.success) return this.error(client, "INVALID_PAYLOAD", "Invalid drawing clear payload.");
    if (!this.acceptSequence(client, parsed.data.clientSequence) || !this.acceptRate(client, "stroke", STROKE_RATE)) return;
    if (!canSendRecipeContent(this.authority.roleOf(client.sessionId) ?? "BLIND_COOK")) {
      return this.error(client, "NOT_AUTHORIZED", "Only the Recipe Keeper may clear drawings.");
    }
    this.strokes.length = 0;
    this.sendVisual(COMMUNICATION_MESSAGES.event, { ...this.envelope(client), kind: "DRAWING_CLEAR" });
  }

  private handleVoiceSignal(client: Client, raw: unknown): void {
    const parsed = voiceSignalSchema.safeParse(raw);
    if (!parsed.success) return this.error(client, "INVALID_PAYLOAD", "Invalid voice signaling payload.");
    const rateChannel = parsed.data.kind === "ICE" ? "ice" : "voice";
    const rate = parsed.data.kind === "ICE" ? ICE_RATE : VOICE_CONTROL_RATE;
    if (!this.acceptSequence(client, parsed.data.clientSequence) || !this.acceptRate(client, rateChannel, rate)) return;
    if (parsed.data.kind === "DISABLE") return this.routeDisable(client);
    const target = this.clientById(parsed.data.targetId);
    if (!target || target.sessionId === client.sessionId) return this.error(client, "TARGET_NOT_FOUND", "Voice target is unavailable.");
    if (parsed.data.kind === "READY") return this.routeReady(client, target);
    if (parsed.data.kind === "OFFER") return this.routeOffer(client, target, parsed.data);
    if (parsed.data.kind === "ANSWER") return this.routeAnswer(client, target, parsed.data);
    this.routeIce(client, target, parsed.data);
  }

  private handleBootstrap(client: Client, raw: unknown): void {
    if (!communicationReadySchema.safeParse(raw).success) return this.error(client, "INVALID_PAYLOAD", "Invalid communication bootstrap payload.");
    if (this.clientById(client.sessionId) !== client || !this.acceptRate(client, "bootstrap", BOOTSTRAP_RATE)) return;
    const role = this.authority.roleOf(client.sessionId);
    if (!role || !this.authority.isReady()) return;
    client.send(COMMUNICATION_MESSAGES.voiceGrant, VOICE_GRANTS[role]);
    if (canReceiveVisual(role)) client.send(COMMUNICATION_MESSAGES.boardSnapshot, this.boardSnapshot());
  }

  private routeReady(receiver: Client, publisher: Client): void {
    const receiverRole = this.authority.roleOf(receiver.sessionId);
    const publisherRole = this.authority.roleOf(publisher.sessionId);
    if (!receiverRole || !publisherRole || !VOICE_GRANTS[receiverRole].canReceive || !VOICE_GRANTS[publisherRole].canPublish) {
      return this.error(receiver, "VOICE_NOT_AUTHORIZED", "Voice readiness is not permitted for these roles.");
    }
    if (!this.authority.isReady()) return this.error(receiver, "VOICE_NOT_READY", "The room is not ready for voice.");
    const pair = voicePair(publisher.sessionId, receiver.sessionId);
    if (!this.voiceReadiness.has(pair) && this.voiceReadiness.size >= MAX_ACTIVE_VOICE_EDGES) {
      return this.error(receiver, "RATE_LIMITED", "Voice readiness limit exceeded.");
    }
    this.voiceReadiness.get(pair)?.timer.clear();
    const readiness = { publisherId: publisher.sessionId, receiverId: receiver.sessionId } as Omit<VoiceReadiness, "timer"> & { timer?: TimerHandle };
    readiness.timer = this.room.clock.setTimeout(() => this.expireReadiness(pair, readiness as VoiceReadiness), this.readinessTtlMs);
    this.voiceReadiness.set(pair, readiness as VoiceReadiness);
    publisher.send(COMMUNICATION_MESSAGES.voiceRelay, { ...this.envelope(receiver), kind: "READY" });
  }

  private routeOffer(client: Client, target: Client, signal: Extract<VoiceSignal, { kind: "OFFER" }>): void {
    const senderRole = this.authority.roleOf(client.sessionId);
    const targetRole = this.authority.roleOf(target.sessionId);
    if (!senderRole || !targetRole || !VOICE_GRANTS[senderRole].canPublish || !VOICE_GRANTS[targetRole].canReceive) {
      return this.error(client, "VOICE_NOT_AUTHORIZED", "Voice connection is not permitted for these roles.");
    }
    if (!this.authority.isReady()) return this.error(client, "VOICE_NOT_READY", "The room is not ready for voice.");
    const media = parseDirectedAudioSdp(signal.sdp, "sendonly");
    if (!media) return this.error(client, "INVALID_PAYLOAD", "Invalid voice offer SDP.");
    const pair = voicePair(client.sessionId, target.sessionId);
    if (!this.voiceReadiness.has(pair)) return this.error(client, "VOICE_NOT_READY", "The receiver has not announced voice readiness.");
    const previousOfferId = this.voiceEdgeByPair.get(pair);
    if (!previousOfferId && this.voiceEdges.size >= MAX_ACTIVE_VOICE_EDGES) {
      return this.error(client, "RATE_LIMITED", "Voice edge limit exceeded.");
    }
    const offerId = randomUUID();
    if (previousOfferId) this.removeEdge(previousOfferId);
    const edge: VoiceEdge = { offerId, publisherId: client.sessionId, receiverId: target.sessionId, answered: false, iceByPeer: new Map(), mediaMids: media.mids };
    this.voiceEdges.set(offerId, edge);
    this.voiceEdgeByPair.set(pair, offerId);
    edge.timer = this.room.clock.setTimeout(() => this.expireEdge(edge), this.pendingEdgeTtlMs);
    target.send(COMMUNICATION_MESSAGES.voiceRelay, { ...this.envelope(client), kind: "OFFER", offerId, sdp: signal.sdp });
  }

  private routeAnswer(client: Client, target: Client, signal: Extract<VoiceSignal, { kind: "ANSWER" }>): void {
    const edge = this.voiceEdges.get(signal.offerId);
    if (!edge || edge.answered || edge.publisherId !== target.sessionId || edge.receiverId !== client.sessionId) {
      return this.error(client, "VOICE_EDGE_NOT_FOUND", "Voice offer is unavailable.");
    }
    const media = parseDirectedAudioSdp(signal.sdp, "recvonly");
    if (!media || media.mids.length !== edge.mediaMids.length || media.mids.some((mid, index) => mid !== edge.mediaMids[index])) return this.error(client, "INVALID_PAYLOAD", "Invalid voice answer SDP.");
    edge.timer?.clear();
    edge.answered = true;
    edge.timer = this.room.clock.setTimeout(() => this.expireEdge(edge), this.establishedEdgeTtlMs);
    target.send(COMMUNICATION_MESSAGES.voiceRelay, { ...this.envelope(client), kind: "ANSWER", offerId: edge.offerId, sdp: signal.sdp });
  }

  private routeDisable(client: Client): void {
    const involved = this.involvedVoicePeers(client.sessionId);
    this.clearPeerVoiceState(client.sessionId);
    for (const peerId of involved) {
      const peer = this.clientById(peerId);
      if (peer) peer.send(COMMUNICATION_MESSAGES.voiceRelay, { ...this.envelope(client), kind: "DISABLED" });
    }
  }

  private routeIce(client: Client, target: Client, signal: Extract<VoiceSignal, { kind: "ICE" }>): void {
    const edge = this.voiceEdges.get(signal.offerId);
    const matches = edge && ((edge.publisherId === client.sessionId && edge.receiverId === target.sessionId) || (edge.receiverId === client.sessionId && edge.publisherId === target.sessionId));
    if (!matches) return this.error(client, "VOICE_EDGE_NOT_FOUND", "Voice connection is unavailable.");
    const candidateCount = edge.iceByPeer.get(client.sessionId) ?? 0;
    if (candidateCount >= MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER) {
      return this.error(client, "RATE_LIMITED", "Voice ICE candidate limit exceeded.");
    }
    edge.iceByPeer.set(client.sessionId, candidateCount + 1);
    target.send(COMMUNICATION_MESSAGES.voiceRelay, {
      ...this.envelope(client),
      kind: "ICE",
      offerId: edge.offerId,
      candidate: signal.candidate,
      ...(signal.sdpMid !== undefined ? { sdpMid: signal.sdpMid } : {}),
      ...(signal.sdpMLineIndex !== undefined ? { sdpMLineIndex: signal.sdpMLineIndex } : {}),
    });
  }

  private broadcastCard(client: Client, payload: ClientRecipeCard): void {
    this.sendVisual(COMMUNICATION_MESSAGES.event, { ...this.envelope(client), kind: "RECIPE_CARD", card: payload.card });
  }

  private broadcastStroke(client: Client, payload: ClientDrawingStroke): void {
    const stroke: DrawingStroke = {
      ...this.envelope(client),
      id: randomUUID(),
      color: payload.color,
      width: payload.width,
      points: payload.points.map((point) => ({ ...point })),
    };
    this.strokes.push(stroke);
    if (this.strokes.length > MAX_BOARD_STROKES) this.strokes.splice(0, this.strokes.length - MAX_BOARD_STROKES);
    this.sendVisual(COMMUNICATION_MESSAGES.drawingStroke, stroke);
  }

  private sendVisual(type: string, payload: unknown): void {
    for (const recipient of this.room.clients) {
      const role = this.authority.roleOf(recipient.sessionId);
      if (role && canReceiveVisual(role)) recipient.send(type, payload);
    }
  }

  private envelope(client: Client): { senderId: string; senderRole: PlayerRole; sequence: number; timestamp: number } {
    const senderRole = this.authority.roleOf(client.sessionId);
    if (!senderRole) throw new Error("Communication sender has no authoritative role");
    this.serverSequence += 1;
    return { senderId: client.sessionId, senderRole, sequence: this.serverSequence, timestamp: Date.now() };
  }

  private acceptSequence(client: Client, sequence: number): boolean {
    const previous = this.lastClientSequence.get(client.sessionId) ?? 0;
    if (sequence <= previous) {
      this.error(client, "STALE_ACTION", "Communication action is stale.");
      return false;
    }
    this.lastClientSequence.set(client.sessionId, sequence);
    return true;
  }

  private acceptRate(client: Client, channel: "signal" | "stroke" | "voice" | "ice" | "bootstrap", limit: { count: number; windowMs: number }): boolean {
    const key = `${client.sessionId}:${channel}`;
    const now = Date.now();
    const recent = (this.rateWindows.get(key) ?? []).filter((timestamp) => now - timestamp < limit.windowMs);
    if (recent.length >= limit.count) {
      this.rateWindows.set(key, recent);
      this.error(client, "RATE_LIMITED", "Communication rate limit exceeded.");
      return false;
    }
    recent.push(now);
    this.rateWindows.set(key, recent);
    return true;
  }

  private clientById(sessionId: string): Client | undefined {
    return this.room.clients.find((client) => client.sessionId === sessionId);
  }

  private error(client: Client, code: CommunicationErrorPayload["code"], message: string): void {
    client.send(COMMUNICATION_MESSAGES.error, { code, message } satisfies CommunicationErrorPayload);
  }

  private removeEdge(offerId: string): void {
    const edge = this.voiceEdges.get(offerId);
    if (!edge) return;
    edge.timer?.clear();
    this.voiceEdges.delete(offerId);
    const pair = voicePair(edge.publisherId, edge.receiverId);
    if (this.voiceEdgeByPair.get(pair) === offerId) this.voiceEdgeByPair.delete(pair);
  }

  private expireEdge(edge: VoiceEdge): void {
    if (this.voiceEdges.get(edge.offerId) !== edge) return;
    this.removeEdge(edge.offerId);
    this.notifyDisabledEndpoints(edge.publisherId, edge.receiverId);
  }

  private clearPeerVoiceState(sessionId: string): void {
    for (const [pair, readiness] of [...this.voiceReadiness]) {
      if (readiness.publisherId === sessionId || readiness.receiverId === sessionId) {
        readiness.timer.clear();
        this.voiceReadiness.delete(pair);
      }
    }
    for (const [offerId, edge] of [...this.voiceEdges]) {
      if (edge.publisherId === sessionId || edge.receiverId === sessionId) this.removeEdge(offerId);
    }
  }

  private clearVoiceState(): void {
    for (const readiness of this.voiceReadiness.values()) readiness.timer.clear();
    for (const edge of this.voiceEdges.values()) edge.timer?.clear();
    this.voiceReadiness.clear();
    this.voiceEdges.clear();
    this.voiceEdgeByPair.clear();
    for (const key of [...this.rateWindows.keys()]) {
      if (key.endsWith(":voice") || key.endsWith(":ice")) this.rateWindows.delete(key);
    }
  }

  private involvedVoicePeers(sessionId: string): Set<string> {
    const peers = new Set<string>();
    for (const readiness of this.voiceReadiness.values()) {
      if (readiness.publisherId === sessionId) peers.add(readiness.receiverId);
      if (readiness.receiverId === sessionId) peers.add(readiness.publisherId);
    }
    for (const edge of this.voiceEdges.values()) {
      if (edge.publisherId === sessionId) peers.add(edge.receiverId);
      if (edge.receiverId === sessionId) peers.add(edge.publisherId);
    }
    return peers;
  }

  private expireReadiness(pair: string, readiness: VoiceReadiness): void {
    if (this.voiceReadiness.get(pair) !== readiness) return;
    this.voiceReadiness.delete(pair);
    const offerId = this.voiceEdgeByPair.get(pair);
    if (offerId) this.removeEdge(offerId);
    this.notifyDisabledEndpoints(readiness.publisherId, readiness.receiverId);
  }

  private notifyDisabledEndpoints(publisherId: string, receiverId: string): void {
    const publisher = this.clientById(publisherId);
    const receiver = this.clientById(receiverId);
    if (!publisher || !receiver) return;
    receiver.send(COMMUNICATION_MESSAGES.voiceRelay, { ...this.envelope(publisher), kind: "DISABLED" });
    publisher.send(COMMUNICATION_MESSAGES.voiceRelay, { ...this.envelope(receiver), kind: "DISABLED" });
  }

  private boardSnapshot(): { strokes: DrawingStroke[] } {
    return { strokes: this.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })) };
  }
}

function voicePair(publisherId: string, receiverId: string): string {
  return `${publisherId}\u0000${receiverId}`;
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseDirectedAudioSdp(sdp: string, requiredDirection: "sendonly" | "recvonly"): { mids: readonly string[] } | undefined {
  if (sdp.length < 1 || sdp.length > 16_384 || sdp.includes("\0")) return undefined;
  const lines = sdp.split(/\r\n|\n|\r/).filter(Boolean);
  if (lines.length > 512 || lines.some((line) => line.length > 2_048)) return undefined;
  if (lines.some((line) => line.startsWith("a=candidate:"))) return undefined;
  const mediaSections: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("m=")) mediaSections.push([line]);
    else mediaSections.at(-1)?.push(line);
  }
  if (mediaSections.length !== 1) return undefined;
  const section = mediaSections[0]!;
  const media = /^m=audio 9 UDP\/TLS\/RTP\/SAVPF (\d+(?: \d+){0,31})$/.exec(section[0]!);
  if (!media) return undefined;
  const payloads = media[1]!.split(" ").map(Number);
  if (payloads.some((payload) => !Number.isInteger(payload) || payload < 0 || payload > 127) || new Set(payloads).size !== payloads.length) return undefined;
  const directions = section.filter((line) => /^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line));
  const mids = section.flatMap((line) => /^a=mid:([^\s]{1,64})$/.exec(line)?.[1] ?? []);
  if (directions.length !== 1 || directions[0] !== `a=${requiredDirection}` || mids.length !== 1) return undefined;
  return { mids };
}
