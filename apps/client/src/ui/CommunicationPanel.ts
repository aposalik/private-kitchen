import { RECIPE_CARDS, canReceiveVisual, type VoiceGrant, type VoiceRelayEnvelope } from "@cooking-game/shared";
import type { LobbyConnection, LobbySnapshot } from "../network/RoomClient.js";
import { VoiceSession, type VoiceStatus } from "../voice/VoiceSession.js";
import { DrawingBoard } from "./DrawingBoard.js";
import { GestureWheel, formatEnum } from "./GestureWheel.js";

export interface VoiceController {
  readonly status: VoiceStatus;
  readonly remoteStreamCount: number;
  configure(contextId: string, selfId: string, grant: VoiceGrant, peers: readonly { id: string; role: "BLIND_COOK" | "RECIPE_KEEPER" | "DEAF_KITCHEN_GUIDE" }[], roomReady: boolean): void;
  enable(): Promise<boolean>;
  disable(): void;
  suspend(): void;
  handleRelay(relay: VoiceRelayEnvelope, contextId: string): Promise<void>;
  subscribe(listener: (status: VoiceStatus) => void): () => void;
}

export class CommunicationPanel {
  private readonly voice: VoiceController;
  private currentContext = "";
  private configurationKey = "";
  private renderKey = "";
  private voiceSuspended = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly connection: LobbyConnection,
    createVoice: (connection: LobbyConnection) => VoiceController = (signaling) => new VoiceSession(signaling),
  ) {
    this.voice = createVoice(connection);
  }

  mount(): void {
    this.voice.subscribe((status) => {
      const field = this.root.querySelector<HTMLElement>("[data-voice-status]");
      if (field) field.textContent = formatEnum(status);
      const count = this.root.querySelector<HTMLElement>("[data-voice-stream-count]");
      if (count) count.textContent = `Remote streams: ${this.voice.remoteStreamCount}`;
      const control = this.root.querySelector<HTMLButtonElement>("[data-enable-voice], [data-disable-voice]");
      if (control) control.replaceWith(this.voiceButton(status));
    });
    this.connection.subscribe((snapshot) => this.render(snapshot));
    this.connection.subscribeVoice((relay) => { void this.voice.handleRelay(relay, this.currentContext); });
  }

  private render(snapshot: LobbySnapshot): void {
    const renderKey = communicationRenderKey(snapshot);
    if (renderKey === this.renderKey) return;
    this.renderKey = renderKey;
    this.clearObjectHighlights();
    this.root.replaceChildren();
    if (snapshot.connectionStatus !== "CONNECTED" || !snapshot.role || !snapshot.roomId || !snapshot.sessionId) {
      if (snapshot.connectionStatus === "RECONNECTING") {
        this.voiceSuspended = true;
        this.voice.suspend();
      } else {
        this.currentContext = "";
        this.configurationKey = "";
        this.voiceSuspended = false;
        this.voice.disable();
      }
      return;
    }

    const section = document.createElement("section");
    section.className = "communication-panel";
    section.setAttribute("aria-labelledby", "communication-title");
    const title = document.createElement("h2");
    title.id = "communication-title";
    title.textContent = "Kitchen signals";
    section.append(title, new GestureWheel((gesture) => this.connection.sendGesture(gesture), (emote) => this.connection.sendEmote(emote)).element());

    if (canReceiveVisual(snapshot.role)) {
      const visual = document.createElement("section");
      visual.setAttribute("aria-label", "Visual communication");
      const feed = document.createElement("ol");
      feed.dataset.communicationFeed = "";
      feed.setAttribute("aria-live", "polite");
      for (const event of snapshot.communicationFeed ?? []) {
        const item = document.createElement("li");
        item.textContent = describeEvent(event);
        feed.append(item);
      }
      visual.append(feed);
      visual.append(this.visualSignalStage(snapshot.communicationFeed?.at(-1)));

      if (snapshot.role === "RECIPE_KEEPER") {
        const cards = document.createElement("div");
        cards.setAttribute("role", "group");
        cards.setAttribute("aria-label", "Recipe cards");
        for (const card of RECIPE_CARDS) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.card = card;
          button.textContent = formatEnum(card);
          button.addEventListener("click", () => this.connection.sendRecipeCard(card));
          cards.append(button);
        }
        visual.append(cards);
      }

      const board = new DrawingBoard(snapshot.role === "RECIPE_KEEPER", (color, width, points) => this.connection.sendDrawingStroke(color, width, points));
      board.render(snapshot.drawingStrokes ?? []);
      visual.append(board.canvas);
      if (snapshot.role === "RECIPE_KEEPER") {
        const clear = document.createElement("button");
        clear.type = "button";
        clear.dataset.clearDrawing = "";
        clear.textContent = "Clear drawing";
        clear.addEventListener("click", () => this.connection.clearDrawing());
        visual.append(clear);
      }
      section.append(visual);
    }

    if (snapshot.voiceGrant) section.append(this.voiceControls(snapshot.voiceGrant));
    if (snapshot.communicationError) {
      const error = document.createElement("p");
      error.setAttribute("role", "alert");
      error.textContent = snapshot.communicationError;
      section.append(error);
    }
    this.root.append(section);

    if (snapshot.voiceGrant) {
      const peers = snapshot.players ?? [];
      const roomReady = snapshot.roomStatus === "READY";
      const key = JSON.stringify([snapshot.roomId, snapshot.sessionId, snapshot.voiceGrant, peers, roomReady]);
      this.currentContext = snapshot.roomId;
      if (key !== this.configurationKey || this.voiceSuspended) {
        this.configurationKey = key;
        this.voiceSuspended = false;
        this.voice.configure(snapshot.roomId, snapshot.sessionId, snapshot.voiceGrant, peers, roomReady);
      }
    }
  }

  private voiceControls(grant: VoiceGrant): HTMLElement {
    const section = document.createElement("section");
    section.setAttribute("aria-label", "Voice controls");
    const policy = document.createElement("p");
    policy.dataset.voicePolicy = "";
    policy.textContent = `Microphone ${grant.canPublish ? "on" : "off"} · Voice output ${grant.canReceive ? "on" : "off"}`;
    const status = document.createElement("p");
    status.dataset.voiceStatus = "";
    status.setAttribute("aria-live", "polite");
    status.textContent = formatEnum(this.voice.status);
    const streamCount = document.createElement("p");
    streamCount.dataset.voiceStreamCount = "";
    streamCount.setAttribute("aria-live", "polite");
    streamCount.textContent = `Remote streams: ${this.voice.remoteStreamCount}`;
    section.append(policy, status, streamCount);
    if (grant.canPublish || grant.canReceive) {
      section.append(this.voiceButton(this.voice.status));
    }
    return section;
  }

  private voiceButton(status: VoiceStatus): HTMLButtonElement {
    const control = document.createElement("button");
    control.type = "button";
    if (status === "ENABLED" || status === "ENABLING") {
      control.dataset.disableVoice = "";
      control.textContent = "Disable Voice";
      control.addEventListener("click", () => this.voice.disable());
    } else {
      control.dataset.enableVoice = "";
      control.textContent = "Enable Voice";
      control.addEventListener("click", () => { void this.voice.enable(); });
    }
    return control;
  }

  private visualSignalStage(event: NonNullable<LobbySnapshot["communicationFeed"]>[number] | undefined): HTMLElement {
    const stage = document.createElement("div");
    stage.dataset.visualSignalStage = "";
    stage.setAttribute("aria-live", "polite");
    if (!event) return stage;
    if (event.kind === "GESTURE" && (event.gesture === "NOD" || event.gesture === "SHAKE_HEAD")) {
      const head = document.createElement("span");
      head.dataset.headMotion = event.gesture;
      head.className = event.gesture === "NOD" ? "head-motion head-motion--nod" : "head-motion head-motion--shake";
      head.textContent = event.gesture === "NOD" ? "Nod" : "Shake head";
      stage.append(head);
    } else if (event.kind === "EMOTE") {
      const indicator = document.createElement("span");
      indicator.dataset.emoteIndicator = event.emote;
      const icons = { URGENT: "🚨", CONFUSED: "😕", READY: "✅", CELEBRATE: "🎉" } as const;
      indicator.textContent = `${formatEnum(event.emote)} ${icons[event.emote]}`;
      stage.append(indicator);
    } else if (event.kind === "POINT") {
      const marker = document.createElement("span");
      marker.dataset.pointMarker = "";
      if (event.target.kind === "OBJECT") {
        marker.dataset.pointObject = event.target.objectId;
        marker.textContent = "Pointing at kitchen object";
        for (const element of this.root.ownerDocument.querySelectorAll<HTMLElement>("[data-object-id]")) {
          if (element.dataset.objectId === event.target.objectId) element.classList.add("visual-point-target");
        }
      } else {
        marker.dataset.pointX = String(event.target.x);
        marker.dataset.pointY = String(event.target.y);
        marker.textContent = `Pointing at (${event.target.x}, ${event.target.y})`;
      }
      stage.append(marker);
    }
    return stage;
  }

  private clearObjectHighlights(): void {
    for (const element of this.root.ownerDocument.querySelectorAll<HTMLElement>(".visual-point-target")) element.classList.remove("visual-point-target");
  }
}

function communicationRenderKey(snapshot: LobbySnapshot): string {
  return JSON.stringify([
    snapshot.connectionStatus,
    snapshot.roomId,
    snapshot.sessionId,
    snapshot.role,
    snapshot.roomStatus,
    snapshot.players,
    snapshot.objects,
    snapshot.voiceGrant,
    snapshot.communicationFeed,
    snapshot.drawingStrokes,
    snapshot.communicationError,
  ]);
}

function describeEvent(event: NonNullable<LobbySnapshot["communicationFeed"]>[number]): string {
  if (event.kind === "GESTURE") return `Gesture: ${formatEnum(event.gesture)}`;
  if (event.kind === "EMOTE") return `Emote: ${formatEnum(event.emote)}`;
  if (event.kind === "RECIPE_CARD") return `Recipe card: ${event.card}`;
  if (event.kind === "POINT") return event.target.kind === "OBJECT" ? "Pointed at a kitchen object" : "Pointed at a kitchen location";
  return "Drawing cleared";
}
