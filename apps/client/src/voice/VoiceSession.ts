import {
  MAX_ACTIVE_VOICE_EDGES,
  MAX_ICE_CANDIDATE_LENGTH,
  MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER,
  MAX_PENDING_ICE_OFFERS,
  MAX_SDP_LENGTH,
  VOICE_GRANTS,
  type PlayerRole,
  type VoiceGrant,
  type VoiceRelayEnvelope,
} from "@cooking-game/shared";
import type { VoiceSignalIntent } from "../network/RoomClient.js";

export type VoiceStatus = "DISABLED" | "ENABLING" | "ENABLED" | "DENIED" | "FAILED";
export interface VoicePeer { id: string; role: PlayerRole }
export interface VoiceSignaling { sendVoiceSignal(signal: VoiceSignalIntent): void }
interface MediaTrackLike { kind?: string; stop(): void }
interface MediaStreamLike { getTracks(): MediaTrackLike[] }
interface AudioElementLike {
  srcObject: unknown;
  controls: boolean;
  play(): Promise<void>;
  pause(): void;
  remove(): void;
}
interface TransceiverLike {
  direction: RTCRtpTransceiverDirection;
  receiver: { track: { kind: string } };
}
interface PeerConnectionLike {
  onicecandidate: ((event: { candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null }) => void) | null;
  ontrack: ((event: { streams: MediaStreamLike[] }) => void) | null;
  addTransceiver(trackOrKind: MediaTrackLike | "audio", init: { direction: RTCRtpTransceiverDirection; streams?: MediaStreamLike[] }): TransceiverLike;
  getTransceivers(): TransceiverLike[];
  createOffer(): Promise<{ type: "offer"; sdp?: string }>;
  createAnswer(): Promise<{ type: "answer"; sdp?: string }>;
  setLocalDescription(description: { type: "offer" | "answer"; sdp?: string }): Promise<void>;
  setRemoteDescription(description: { type: "offer" | "answer"; sdp: string }): Promise<void>;
  addIceCandidate(candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }): Promise<void>;
  close(): void;
}
export interface VoiceSessionDependencies {
  mediaDevices: { getUserMedia(constraints: { audio: true }): Promise<MediaStreamLike> };
  createPeerConnection(): PeerConnectionLike;
  createAudioElement(): AudioElementLike;
}

interface PeerState {
  connection: PeerConnectionLike;
  peerId: string;
  offerId?: string;
  queuedLocalIce: Array<{ candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }>;
  contextId: string;
  operation: number;
  closed: boolean;
}
interface PeerOutput { peerId: string; audio: AudioElementLike }

export class VoiceSession {
  status: VoiceStatus = "DISABLED";
  private contextId = "";
  private selfId = "";
  private grant: VoiceGrant = { canPublish: false, canReceive: false };
  private peers = new Map<string, VoicePeer>();
  private connections = new Map<string, PeerState>();
  private pendingRemoteIce = new Map<string, VoiceRelayEnvelope[]>();
  private pendingReadyReceivers = new Map<string, Extract<VoiceRelayEnvelope, { kind: "READY" }>>();
  private localStream: MediaStreamLike | undefined;
  private outputs: PeerOutput[] = [];
  private operation = 0;
  private optedIn = false;
  private roomReady = false;
  private readonly listeners = new Set<(status: VoiceStatus) => void>();

  constructor(
    private readonly signaling: VoiceSignaling,
    private readonly dependencies: VoiceSessionDependencies = browserDependencies(),
  ) {}

  get remoteStreamCount(): number { return Math.min(this.outputs.length, MAX_ACTIVE_VOICE_EDGES); }

  configure(contextId: string, selfId: string, grant: VoiceGrant, peers: readonly VoicePeer[], roomReady = false): void {
    const identityChanged = contextId !== this.contextId || selfId !== this.selfId;
    if (identityChanged) {
      this.optedIn = false;
      this.releaseResources();
      this.setStatus("DISABLED");
    }
    this.contextId = contextId;
    this.selfId = selfId;
    this.grant = { ...grant };
    this.peers = new Map(peers.filter((peer) => peer.id !== selfId).map((peer) => [peer.id, { ...peer }]));
    this.roomReady = roomReady;

    if (!roomReady) {
      this.releaseResources();
      if (this.optedIn) this.setStatus("ENABLED");
      return;
    }
    if (this.optedIn) void this.activate();
  }

  subscribe(listener: (status: VoiceStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  async enable(): Promise<boolean> {
    this.optedIn = true;
    if (!this.roomReady) {
      this.setStatus("ENABLED");
      return true;
    }
    return this.activate();
  }

  async handleRelay(relay: VoiceRelayEnvelope, contextId: string): Promise<void> {
    if (contextId !== this.contextId || !this.roomReady || relay.senderId === this.selfId || !this.validRelayBounds(relay)) return;
    const relayContext = this.contextId;
    const operation = this.operation;
    if (relay.kind === "DISABLED") {
      this.handleDisabled(relay, relayContext, operation);
      return;
    }
    if (relay.kind === "READY" && (this.status === "DISABLED" || this.status === "ENABLING")) {
      this.cacheReady(relay);
      return;
    }
    if (this.status !== "ENABLED") return;
    try {
      if (relay.kind === "READY") await this.handleReady(relay, relayContext, operation);
      else if (relay.kind === "OFFER") await this.handleOffer(relay, relayContext, operation);
      else if (relay.kind === "ANSWER") await this.handleAnswer(relay, relayContext, operation);
      else await this.handleIce(relay, relayContext, operation);
    } catch {
      if (this.isCurrent(relayContext, operation)) {
        this.optedIn = false;
        this.releaseResources();
        this.setStatus("FAILED");
      }
    }
  }

  disable(): void {
    const shouldSignal = this.optedIn && Boolean(this.contextId) && this.roomReady;
    this.optedIn = false;
    if (shouldSignal) this.signaling.sendVoiceSignal({ kind: "DISABLE" });
    this.releaseResources();
    this.setStatus("DISABLED");
  }

  suspend(): void {
    this.releaseResources();
    this.setStatus("DISABLED");
  }

  private async activate(): Promise<boolean> {
    if (!this.optedIn || !this.roomReady) return false;
    const operation = ++this.operation;
    this.setStatus("ENABLING");
    try {
      if (this.grant.canPublish && !this.localStream) {
        const stream = await this.dependencies.mediaDevices.getUserMedia({ audio: true });
        if (operation !== this.operation || !this.optedIn || !this.roomReady) {
          this.stopStream(stream);
          return false;
        }
        this.localStream = stream;
      }
      if (operation !== this.operation || !this.optedIn || !this.roomReady) return false;
      this.setStatus("ENABLED");
      this.announceReadiness();
      await this.consumeReady(operation, this.contextId);
      return operation === this.operation && this.optedIn && this.roomReady;
    } catch {
      if (operation === this.operation) {
        this.optedIn = false;
        this.releaseResources();
        this.setStatus("DENIED");
      }
      return false;
    }
  }

  private announceReadiness(): void {
    if (!this.grant.canReceive || !this.roomReady || this.status !== "ENABLED") return;
    for (const peer of this.peers.values()) {
      if (VOICE_GRANTS[peer.role].canPublish) this.signaling.sendVoiceSignal({ kind: "READY", targetId: peer.id });
    }
  }

  private async handleReady(relay: Extract<VoiceRelayEnvelope, { kind: "READY" }>, contextId: string, operation: number): Promise<void> {
    const receiver = this.peers.get(relay.senderId);
    if (!this.grant.canPublish || !this.localStream || !receiver || receiver.role !== relay.senderRole || !VOICE_GRANTS[receiver.role].canReceive) return;
    await this.createOutgoingOffer(receiver, contextId, operation);
  }

  private cacheReady(relay: Extract<VoiceRelayEnvelope, { kind: "READY" }>): void {
    const receiver = this.peers.get(relay.senderId);
    if (!this.grant.canPublish || !receiver || receiver.role !== relay.senderRole || !VOICE_GRANTS[receiver.role].canReceive) return;
    const eligibleCount = [...this.peers.values()].filter((peer) => VOICE_GRANTS[peer.role].canReceive).length;
    const limit = Math.min(MAX_ACTIVE_VOICE_EDGES, eligibleCount);
    if (!this.pendingReadyReceivers.has(relay.senderId) && this.pendingReadyReceivers.size >= limit) return;
    this.pendingReadyReceivers.set(relay.senderId, relay);
  }

  private async consumeReady(operation: number, contextId: string): Promise<void> {
    const ready = [...this.pendingReadyReceivers.values()];
    this.pendingReadyReceivers.clear();
    for (const relay of ready) {
      if (!this.isCurrent(contextId, operation) || this.status !== "ENABLED" || !this.roomReady) return;
      await this.handleReady(relay, contextId, operation);
      if (!this.isCurrent(contextId, operation)) return;
    }
  }

  private async createOutgoingOffer(peer: VoicePeer, contextId: string, operation: number): Promise<void> {
    if (peer.id === this.selfId || !this.roomReady || !this.grant.canPublish || !VOICE_GRANTS[peer.role].canReceive || !this.isCurrent(contextId, operation) || !this.localStream) return;
    const state = this.createPeer(peer.id, undefined, contextId, operation);
    for (const track of this.localStream.getTracks()) {
      state.connection.addTransceiver(track, { direction: "sendonly", streams: [this.localStream] });
    }
    const offer = await state.connection.createOffer();
    if (!this.isCurrentState(state) || !offer.sdp || offer.sdp.length > MAX_SDP_LENGTH) return this.discardState(state);
    await state.connection.setLocalDescription(offer);
    if (!this.isCurrentState(state)) return this.discardState(state);
    this.signaling.sendVoiceSignal({ kind: "OFFER", targetId: peer.id, sdp: offer.sdp });
  }

  private async handleOffer(relay: Extract<VoiceRelayEnvelope, { kind: "OFFER" }>, contextId: string, operation: number): Promise<void> {
    const sender = this.peers.get(relay.senderId);
    if (!this.grant.canReceive || !sender || !VOICE_GRANTS[sender.role].canPublish) return;
    const state = this.createPeer(sender.id, relay.offerId, contextId, operation);
    await state.connection.setRemoteDescription({ type: "offer", sdp: relay.sdp });
    if (!this.isCurrentState(state)) return this.discardState(state);
    for (const transceiver of state.connection.getTransceivers()) {
      if (transceiver.receiver.track.kind === "audio") transceiver.direction = "recvonly";
    }
    const answer = await state.connection.createAnswer();
    if (!this.isCurrentState(state) || !answer.sdp || answer.sdp.length > MAX_SDP_LENGTH) return this.discardState(state);
    await state.connection.setLocalDescription(answer);
    if (!this.isCurrentState(state)) return this.discardState(state);
    this.signaling.sendVoiceSignal({ kind: "ANSWER", targetId: sender.id, offerId: relay.offerId, sdp: answer.sdp });
    await this.flushRemoteIce(relay.offerId, state, contextId, operation);
  }

  private async handleAnswer(relay: Extract<VoiceRelayEnvelope, { kind: "ANSWER" }>, contextId: string, operation: number): Promise<void> {
    const state = this.connections.get(relay.senderId);
    if (!state || !this.grant.canPublish) return;
    state.offerId = relay.offerId;
    await state.connection.setRemoteDescription({ type: "answer", sdp: relay.sdp });
    if (!this.isCurrentState(state) || !this.isCurrent(contextId, operation)) return this.discardState(state);
    for (const candidate of state.queuedLocalIce.splice(0)) this.sendIce(state, candidate);
    await this.flushRemoteIce(relay.offerId, state, contextId, operation);
  }

  private async handleIce(relay: Extract<VoiceRelayEnvelope, { kind: "ICE" }>, contextId: string, operation: number): Promise<void> {
    if (!this.isCurrent(contextId, operation)) return;
    const state = this.connections.get(relay.senderId);
    if (!state || (state.offerId && state.offerId !== relay.offerId)) {
      let queued = this.pendingRemoteIce.get(relay.offerId);
      if (!queued) {
        while (this.pendingRemoteIce.size >= MAX_PENDING_ICE_OFFERS) {
          const oldest = this.pendingRemoteIce.keys().next().value as string | undefined;
          if (!oldest) break;
          this.pendingRemoteIce.delete(oldest);
        }
        queued = [];
        this.pendingRemoteIce.set(relay.offerId, queued);
      }
      if (queued.length < MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER) queued.push(relay);
      return;
    }
    state.offerId = relay.offerId;
    await state.connection.addIceCandidate({ candidate: relay.candidate, ...(relay.sdpMid !== undefined ? { sdpMid: relay.sdpMid } : {}), ...(relay.sdpMLineIndex !== undefined ? { sdpMLineIndex: relay.sdpMLineIndex } : {}) });
    if (!this.isCurrentState(state)) this.discardState(state);
  }

  private createPeer(peerId: string, offerId: string | undefined, contextId: string, operation: number): PeerState {
    this.cleanupPeer(peerId);
    for (const [pendingOfferId, relays] of this.pendingRemoteIce) {
      if (pendingOfferId !== offerId && relays[0]?.senderId === peerId) this.pendingRemoteIce.delete(pendingOfferId);
    }
    const connection = this.dependencies.createPeerConnection();
    const state: PeerState = { connection, peerId, ...(offerId ? { offerId } : {}), queuedLocalIce: [], contextId, operation, closed: false };
    connection.onicecandidate = ({ candidate }) => {
      if (!candidate || !this.isCurrentState(state) || this.status !== "ENABLED" || !this.roomReady) return;
      if (!state.offerId) {
        if (state.queuedLocalIce.length < MAX_ICE_CANDIDATES_PER_EDGE_AND_PEER) state.queuedLocalIce.push(candidate);
        return;
      }
      this.sendIce(state, candidate);
    };
    connection.ontrack = ({ streams }) => {
      if (!this.isCurrentState(state) || !this.grant.canReceive || this.status !== "ENABLED" || !this.roomReady || !streams[0]) return;
      const audio = this.dependencies.createAudioElement();
      this.cleanupOutputs(peerId);
      audio.controls = true;
      audio.srcObject = streams[0];
      this.outputs.push({ peerId, audio });
      void audio.play().catch(() => undefined);
      this.notify();
    };
    this.connections.set(peerId, state);
    return state;
  }

  private sendIce(state: PeerState, candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }): void {
    if (!this.isCurrentState(state) || !state.offerId || candidate.candidate.length > MAX_ICE_CANDIDATE_LENGTH) return;
    this.signaling.sendVoiceSignal({ kind: "ICE", targetId: state.peerId, offerId: state.offerId, candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex });
  }

  private async flushRemoteIce(offerId: string, state: PeerState, contextId: string, operation: number): Promise<void> {
    const queued = this.pendingRemoteIce.get(offerId) ?? [];
    this.pendingRemoteIce.delete(offerId);
    for (const relay of queued) {
      if (!this.isCurrentState(state)) return;
      if (relay.kind === "ICE") await this.handleIce(relay, contextId, operation);
      if (!this.isCurrentState(state)) return;
    }
  }

  private validRelayBounds(relay: VoiceRelayEnvelope): boolean {
    return (relay.kind !== "OFFER" && relay.kind !== "ANSWER" || relay.sdp.length <= MAX_SDP_LENGTH)
      && (relay.kind !== "ICE" || relay.candidate.length <= MAX_ICE_CANDIDATE_LENGTH);
  }

  private cleanupPeer(peerId: string): void {
    const state = this.connections.get(peerId);
    if (state) this.closeState(state);
    this.connections.delete(peerId);
    this.cleanupOutputs(peerId);
  }

  private discardState(state: PeerState): void {
    this.closeState(state);
    if (this.connections.get(state.peerId) === state) {
      this.connections.delete(state.peerId);
      this.cleanupOutputs(state.peerId);
    }
  }

  private closeState(state: PeerState): void {
    if (state.closed) return;
    state.closed = true;
    state.connection.close();
  }

  private isCurrent(contextId: string, operation: number): boolean {
    return contextId === this.contextId && operation === this.operation;
  }

  private isCurrentState(state: PeerState): boolean {
    return this.isCurrent(state.contextId, state.operation) && this.connections.get(state.peerId) === state && !state.closed;
  }

  private handleDisabled(relay: Extract<VoiceRelayEnvelope, { kind: "DISABLED" }>, contextId: string, operation: number): void {
    const peer = this.peers.get(relay.senderId);
    if (!this.isCurrent(contextId, operation) || !peer || peer.role !== relay.senderRole) return;
    this.cleanupPeer(peer.id);
    this.pendingReadyReceivers.delete(peer.id);
    for (const [offerId, queued] of this.pendingRemoteIce) if (queued[0]?.senderId === peer.id) this.pendingRemoteIce.delete(offerId);
  }

  private cleanupOutputs(peerId: string): void {
    const retained: PeerOutput[] = [];
    let removed = false;
    for (const output of this.outputs) {
      if (output.peerId === peerId) {
        removed = true;
        output.audio.pause();
        output.audio.srcObject = null;
        output.audio.remove();
      } else retained.push(output);
    }
    this.outputs = retained;
    if (removed) this.notify();
  }

  private releaseResources(): void {
    this.operation += 1;
    for (const peerId of [...this.connections.keys()]) this.cleanupPeer(peerId);
    this.pendingRemoteIce.clear();
    this.pendingReadyReceivers.clear();
    if (this.localStream) this.stopStream(this.localStream);
    this.localStream = undefined;
  }

  private stopStream(stream: MediaStreamLike): void { for (const track of stream.getTracks()) track.stop(); }
  private setStatus(status: VoiceStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.notify();
  }
  private notify(): void { for (const listener of this.listeners) listener(this.status); }
}

function browserDependencies(): VoiceSessionDependencies {
  return {
    mediaDevices: navigator.mediaDevices as unknown as VoiceSessionDependencies["mediaDevices"],
    createPeerConnection: () => new RTCPeerConnection() as unknown as PeerConnectionLike,
    createAudioElement: () => document.createElement("audio") as unknown as AudioElementLike,
  };
}
