import {
  REQUIRED_PLAYER_COUNT,
  ROLE_LABELS,
} from "@cooking-game/shared";
import { sfx } from "../audio/SfxManager.js";

import type {
  ConnectionStatus,
  LobbyConnection,
  LobbySnapshot,
} from "../network/RoomClient.js";
import {
  createKitchenWorld,
  type KitchenRendererErrorDetail,
  type KitchenWorldAdapter,
} from "../game/KitchenWorld.js";
import { PlayerInputController } from "../input/PlayerInputController.js";
import { contextualPrompt } from "../game3d/Presentation.js";
import {
  KITCHEN_STATIONS,
  projectKitchenWorld,
} from "../game/KitchenWorldModel.js";
import { PlaytestFeedbackStore } from "../playtest/PlaytestFeedback.js";
import { CommunicationPanel } from "./CommunicationPanel.js";
import { PlaytestDebrief } from "./PlaytestDebrief.js";
import {
  renderRoleBriefing,
  type RoleBriefingPhase,
} from "./RoleBriefing.js";
import { CharacterSelect } from "./CharacterSelect.js";
import { MatchmakingLobby } from "./MatchmakingLobby.js";
import { RoundCountdown } from "./RoundCountdown.js";

export interface LobbyOptions {
  readonly storage?: Storage;
  readonly monotonicNow?: () => number;
  readonly exportFeedback?: (json: string) => void;
  readonly world?: KitchenWorldAdapter;
  readonly input?: PlayerInputController;
  /** Override character selection for tests; defaults to showing CharacterSelect UI. */
  readonly pickCharacter?: () => Promise<{ characterId: string }>;
}

export class Lobby {
  private connectionStatus: ConnectionStatus = "DISCONNECTED";
  private briefingRenderKey = "";
  private kitchenRenderKey = "";
  private resumePending = false;
  private debrief!: PlaytestDebrief;
  private observedRoundStatus: LobbySnapshot["roundStatus"];
  private runningStartedAt: number | undefined;
  private observedRunningMs = 0;
  private terminalObservationCount = 0;
  private terminalObservationId = "";
  private readonly feedbackStore: PlaytestFeedbackStore;
  private readonly monotonicNow: () => number;
  private readonly exportFeedback: ((json: string) => void) | undefined;
  private readonly world: KitchenWorldAdapter;
  private worldMounted = false;
  private readonly input: PlayerInputController;
  private inputMounted = false;
  private unsubscribe: (() => void) | undefined;
  private selectedRecipe: { recipeId?: string; recipeTestToken?: string } | undefined;
  private countdown!: RoundCountdown;
  private acknowledgedRole: string | undefined;
  private timerWarnedAt: number | undefined;
  private readonly storage: Storage;

  private readonly pickCharacter: () => Promise<{ characterId: string }>;

  constructor(
    private readonly root: HTMLElement,
    private readonly connection: LobbyConnection,
    options: LobbyOptions = {},
  ) {
    this.storage = options.storage ?? browserFeedbackStorage();
    this.feedbackStore = new PlaytestFeedbackStore(this.storage);
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.exportFeedback = options.exportFeedback;
    this.world = options.world ?? createKitchenWorld();
    this.input = options.input ?? new PlayerInputController({
      move: (axisX, axisZ) => this.sendMovement(axisX, axisZ),
      interact: () => this.activateContextualAction(),
      pause: () => this.togglePauseOverlay(),
    });
    this.pickCharacter = options.pickCharacter ??
      (() => new CharacterSelect(this.root).show());
  }

  mount(): void {
    this.root.innerHTML = `
      <section class="lobby-card" aria-labelledby="lobby-title">
        <section class="setup-surface" data-setup-surface>
        <div class="brand">
          <p class="eyebrow">Private kitchen</p>
          <h1 id="lobby-title">Three cooks. One impossible dinner.</h1>
          <p class="intro">Create a room or enter an invite code. Roles are assigned by the server.</p>
        </div>

        <div class="join-panel">
          <label for="display-name">Your name</label>
          <input id="display-name" name="displayName" maxlength="32" autocomplete="nickname" placeholder="Player name" />
          <label for="room-id">Invite code</label>
          <input id="room-id" name="roomId" autocomplete="off" spellcheck="false" placeholder="Room ID" />
          <div class="actions">
            <button type="button" data-action="quick-match">Quick Match</button>
            <button type="button" data-action="create">Create private room</button>
            <button type="button" class="secondary" data-action="join">Join room</button>
          </div>
          <div data-matchmaking-root hidden></div>
          <p data-selected-recipe role="status">Recipe: bundled kitchen recipe</p>
          <p class="error" role="alert" hidden></p>
        </div>
        </section>

        <section class="operate-surface" data-operate-surface hidden>
        <div data-countdown-root></div>
        <div class="role-intro-gate" data-role-intro-gate role="dialog" aria-modal="true" aria-labelledby="role-intro-title" hidden>
          <h2 id="role-intro-title" class="role-intro-gate__title"></h2>
          <div class="role-intro-gate__briefing" data-role-intro-briefing></div>
          <button type="button" data-action="acknowledge-role" class="role-intro-gate__ack">I understand my role — let&rsquo;s cook</button>
        </div>
        <section class="waiting-room" data-waiting-room aria-live="polite" hidden>
          <h2 class="waiting-room__title">Waiting for the kitchen to open</h2>
          <p class="waiting-room__player-count" data-waiting-player-count>0 / 3 players ready</p>
          <div class="waiting-room__invite">
            <p class="waiting-room__invite-label">Share this code with friends</p>
            <div class="waiting-room__code-row">
              <span class="waiting-room__code" data-invite-code>—</span>
              <button type="button" class="waiting-room__copy-btn" data-copy-invite aria-label="Copy room code">Copy</button>
            </div>
          </div>
          <ul class="waiting-room__player-list" data-waiting-player-list aria-label="Players in room"></ul>
        </section>
        <div class="reconnection-overlay" data-reconnection-overlay role="status" aria-live="polite" hidden>
          <p class="reconnection-overlay__message">Reconnecting&hellip; please wait</p>
        </div>
        <div class="renderer-marker" data-renderer-marker aria-live="polite">Renderer loading</div>
        <div class="renderer-error" data-renderer-error role="alert" hidden>
          <p data-renderer-error-message></p>
          <button type="button" data-action="reload-renderer" onclick="location.reload()">Reload page</button>
        </div>
        <dl class="room-state" data-status-rail aria-live="polite">
          <div><dt>Connection</dt><dd data-field="connection">Disconnected</dd></div>
          <div><dt>Room ID</dt><dd data-field="room">—</dd></div>
          <div><dt>Your role</dt><dd data-field="role">Assigned on join</dd></div>
          <div><dt>Players</dt><dd data-field="players">0 / ${REQUIRED_PLAYER_COUNT}</dd></div>
          <div><dt>Kitchen</dt><dd data-field="status">Waiting</dd></div>
        </dl>
        <section data-role-briefing-root></section>
        <section class="round-panel" data-game-hud data-round-section aria-labelledby="round-title">
          <div>
            <p class="eyebrow">Server round</p>
            <h2 id="round-title">Round</h2>
            <p class="hud-role" data-hud-role>Role pending</p>
          </div>
          <dl class="round-state" aria-live="polite">
            <div><dt>Status</dt><dd data-round-status>Waiting</dd></div>
            <div><dt>Time remaining</dt><dd data-round-timer>--:--</dd></div>
            <div data-round-progress>
              <dt>Progress</dt>
              <dd><span>0 / 0</span><progress value="0" max="1" aria-label="Completed recipe steps"></progress></dd>
            </div>
          </dl>
          <p class="dish-goal" data-dish-goal hidden></p>
          <p class="round-guidance" data-round-guidance></p>
        </section>
        <div class="round-result-root" data-round-result-root aria-live="polite"></div>
        <section data-playtest-debrief-root></section>
        <section class="role-workspace" data-role-workspace>
        <section class="kitchen-stage" data-kitchen-stage data-kitchen-actions aria-label="2.5D kitchen world">
          <div class="kitchen-world" data-kitchen-world aria-hidden="true"></div>
          <div class="kitchen-hotspots" data-kitchen-hotspots>
            <div data-kitchen-avatars aria-label="Fixed cook stations"></div>
            <ul class="object-list" aria-label="Kitchen objects" aria-live="polite"></ul>
            <div data-station-controls role="group" aria-label="Cooking station actions"></div>
            <div data-point-controls role="group" aria-label="Kitchen stations"></div>
          </div>
          <div class="context-prompt" data-context-prompt role="status" aria-live="polite" hidden>
            <kbd>E</kbd><span data-context-label></span><span aria-hidden="true"> · A</span>
          </div>
        </section>
        <div class="kitchen-live-status">
          <p class="role-guidance" data-field="interaction-guidance"></p>
          <p class="interaction-error" role="alert" hidden></p>
          <p class="cooking-error" role="alert" hidden></p>
        </div>
        <details class="role-drawer recipe-panel" data-recipe-drawer>
          <summary>Private recipe</summary>
          <section data-recipe-root aria-live="polite"></section>
        </details>
        <section class="pause-overlay" data-pause-overlay data-input-modal aria-modal="true" role="dialog" aria-labelledby="pause-title" hidden>
          <p class="eyebrow">Local menu</p>
          <h2 id="pause-title">Kitchen paused on this screen</h2>
          <p>The online round remains server-authoritative.</p>
          <fieldset class="pause-settings">
            <legend>Settings</legend>
            <label class="pause-settings__row">
              <input type="checkbox" data-pause-setting="reducedMotion" />
              Reduced motion
            </label>
            <label class="pause-settings__row">
              <span>Master volume</span>
              <input type="range" data-pause-setting="masterVolume" min="0" max="1" step="0.05" value="1" />
            </label>
            <label class="pause-settings__row">
              <span>Voice volume</span>
              <input type="range" data-pause-setting="voiceVolume" min="0" max="1" step="0.05" value="1" />
            </label>
          </fieldset>
          <button type="button" data-resume-game>Resume</button>
        </section>
        </section>
        <details class="role-drawer" data-role-tools-drawer>
          <summary>Role tools and kitchen signals</summary>
          <section data-communication-root></section>
        </details>
        </section>
        <section class="account-surface" data-account-surface>
          <section data-auth-root></section>
        </section>
      </section>`;

    const params = new URLSearchParams(location.search);
    this.nameInput.value = params.get("player") ?? "";
    this.roomInput.value = params.get("room") ?? "";
    this.debrief = new PlaytestDebrief(
      this.root.querySelector<HTMLElement>("[data-playtest-debrief-root]")!,
      this.feedbackStore,
      this.exportFeedback,
    );
    this.countdown = new RoundCountdown(this.root.querySelector<HTMLElement>("[data-countdown-root]")!);
    this.countdown.mount();
    this.root.querySelector<HTMLButtonElement>("[data-action=acknowledge-role]")!
      .addEventListener("click", () => this.acknowledgeRoleIntro());
    this.unsubscribe = this.connection.subscribe((snapshot) => this.render(snapshot));
    this.root.addEventListener("kitchenrenderererror", this.onRendererError);
    new CommunicationPanel(this.root.querySelector<HTMLElement>("[data-communication-root]")!, this.connection).mount();
    this.createButton.addEventListener("click", () => void this.connect("create"));
    this.joinButton.addEventListener("click", () => void this.connect("join"));
    this.root.querySelector<HTMLButtonElement>("[data-action=quick-match]")!
      .addEventListener("click", () => this.openMatchmaking());
    this.root.querySelector<HTMLButtonElement>("[data-copy-invite]")!
      .addEventListener("click", () => {
        const code = this.root.querySelector<HTMLElement>("[data-invite-code]")!.textContent ?? "";
        void navigator.clipboard.writeText(code).then(() => {
          const btn = this.root.querySelector<HTMLButtonElement>("[data-copy-invite]")!;
          btn.textContent = "Copied!";
          setTimeout(() => { btn.textContent = "Copy"; }, 2000);
        });
      });
    this.root.querySelector<HTMLButtonElement>("[data-resume-game]")!
      .addEventListener("click", () => this.togglePauseOverlay(false));
    this.initSettings();

    if (this.roomInput.value) {
      if (this.nameInput.value) {
        void this.connect("join");
      }
      return;
    }

    this.resumePending = true;
    this.updateActionAvailability();
    void this.connection.resume().then(
      (resumed) => {
        this.resumePending = false;
        if (!resumed && this.nameInput.value && this.roomInput.value) {
          void this.connect("join");
          return;
        }
        this.updateActionAvailability();
      },
      () => {
        this.resumePending = false;
        this.updateActionAvailability();
      },
    );
  }

  restoreDisplayName(displayName: string): void {
    if (this.nameInput.value.trim().length === 0) this.nameInput.value = displayName;
  }

  selectRecipe(
    selection: { recipeId?: string; recipeTestToken?: string },
    title: string,
  ): void {
    this.selectedRecipe = selection;
    const status = this.root.querySelector<HTMLElement>("[data-selected-recipe]");
    if (status) status.textContent = `Recipe selected: ${title}`;
    this.createButton.focus();
  }

  destroy(): void {
    this.root.removeEventListener("kitchenrenderererror", this.onRendererError);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.world.destroy();
    this.worldMounted = false;
    this.input.destroy();
    this.inputMounted = false;
  }

  private readonly onRendererError = (event: Event): void => {
    const detail = (event as CustomEvent<KitchenRendererErrorDetail>).detail;
    if (!detail || typeof detail.reason !== "string") return;
    const alert = this.root.querySelector<HTMLElement>("[data-renderer-error]");
    if (!alert) return;
    const renderer = detail.renderer === "phaser" ? "Phaser rollback" : "Babylon 3D";
    const msg = alert.querySelector<HTMLElement>("[data-renderer-error-message]");
    if (msg) msg.textContent = `${renderer} renderer unavailable: ${detail.reason}`;
    else alert.textContent = `${renderer} renderer unavailable: ${detail.reason}`;
    alert.hidden = false;
  };

  private openMatchmaking(): void {
    const displayName = this.nameInput.value.trim();
    if (!displayName) {
      this.showError("Enter your name before joining Quick Match.");
      return;
    }
    const mmRoot = this.root.querySelector<HTMLElement>("[data-matchmaking-root]")!;
    const joinPanel = this.root.querySelector<HTMLElement>(".join-panel")!;
    joinPanel.hidden = true;
    mmRoot.hidden = false;

    const endpoint = (() => {
      if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL as string;
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      return `${protocol}://${location.hostname}:2567`;
    })();

    const characterId = (this.root.querySelector<HTMLInputElement>("[data-character-id]")?.value) ?? "Rabbit_Blond";

    const mm = new MatchmakingLobby(mmRoot, {
      endpoint,
      displayName,
      characterId,
      onMatch: ({ roomId, ticket, displayName: dn, characterId: cid }) => {
        mmRoot.hidden = true;
        joinPanel.hidden = false;
        void this.connection.joinWithTicket(roomId, dn, cid, ticket);
      },
      onCancel: () => {
        mmRoot.hidden = true;
        joinPanel.hidden = false;
        mm.unmount();
      },
    });
    mm.mount();
  }

  private async connect(action: "create" | "join"): Promise<void> {
    const displayName = this.nameInput.value.trim();
    const roomId = this.roomInput.value.trim();
    if (!displayName || (action === "join" && !roomId)) {
      this.showError("Enter your name and, when joining, a room ID.");
      return;
    }

    this.showError();
    this.setDisabled(true);

    const { characterId } = await this.pickCharacter();
    (window as any).__selectedCharacter = characterId;

    try {
      if (action === "create") {
        if (this.selectedRecipe) {
          await this.connection.create(displayName, { characterId, ...this.selectedRecipe });
        } else {
          await this.connection.create(displayName, { characterId });
        }
      } else {
        await this.connection.join(roomId, displayName, characterId);
      }
    } catch {
      this.showError("Unable to connect. Check the room ID and try again.");
    } finally {
      this.updateActionAvailability();
    }
  }

  private render(snapshot: LobbySnapshot): void {
    this.connectionStatus = snapshot.connectionStatus;
    this.updateRunningObservation(snapshot);
    this.renderPresentationState(snapshot);
    if (snapshot.connectionStatus === "CONNECTED"
      || snapshot.connectionStatus === "RECONNECTING") {
      if (!this.worldMounted) {
        this.world.mount(
          this.root.querySelector<HTMLElement>("[data-kitchen-world]")!,
        );
        this.worldMounted = true;
      }
      this.world.update(snapshot);
      if (!this.inputMounted) {
        this.input.mount();
        this.inputMounted = true;
      }
    } else if (this.inputMounted) {
      this.input.destroy();
      this.inputMounted = false;
    }
    const renderer = this.root.querySelector<HTMLElement>("[data-kitchen-world]")!
      .dataset.renderer ?? "babylon";
    this.root.dataset.renderer = renderer;
    this.root.querySelector<HTMLElement>("[data-renderer-marker]")!.textContent =
      `${renderer === "phaser" ? "Phaser rollback" : "Babylon 3D"} renderer`;
    this.updateActionAvailability();
    this.field("connection").textContent = formatWords(snapshot.connectionStatus);
    this.field("room").textContent = snapshot.roomId ?? "—";
    this.field("role").textContent = snapshot.role
      ? ROLE_LABELS[snapshot.role]
      : "Assigned on join";
    this.field("players").textContent = `${snapshot.connectedCount ?? 0} / ${REQUIRED_PLAYER_COUNT}`;
    this.field("status").textContent = snapshot.roomStatus
      ? formatWords(snapshot.roomStatus)
      : "Waiting";
    this.renderRound(snapshot);
    const kitchenRenderKey = structuralKitchenRenderKey(snapshot);
    if (kitchenRenderKey !== this.kitchenRenderKey) {
      this.kitchenRenderKey = kitchenRenderKey;
      this.renderRoundResult(snapshot);
      this.renderPrivateRecipe(snapshot);
      this.renderObjects(snapshot);
      this.renderStationControls(snapshot);
      this.renderPointLocations(snapshot);
    }
    this.renderWorldAvatars(snapshot);
    this.renderDebrief(snapshot);
    this.renderContextPrompt(snapshot);
    const interactionError = this.root.querySelector<HTMLElement>(
      ".interaction-error",
    )!;
    interactionError.textContent = snapshot.interactionError ?? "";
    interactionError.hidden = !snapshot.interactionError;
    const cookingError = this.root.querySelector<HTMLElement>(
      ".cooking-error",
    )!;
    cookingError.textContent = snapshot.cookingError ?? "";
    cookingError.hidden = !snapshot.cookingError;
  }

  private renderContextPrompt(snapshot: LobbySnapshot): void {
    const root = this.root.querySelector<HTMLElement>("[data-context-prompt]")!;
    const local = snapshot.players?.find(({ id }) => id === snapshot.sessionId);
    const prompt = snapshot.role && local && snapshot.roundStatus
      ? contextualPrompt({
          role: snapshot.role,
          x: local.x,
          z: local.z,
          roundStatus: snapshot.roundStatus,
          hasHeldIngredient: snapshot.objects?.some(({ heldByMe }) => heldByMe) ?? false,
          completedStepCount: snapshot.completedStepCount ?? 0,
          totalStepCount: snapshot.totalStepCount ?? 0,
        })
      : undefined;
    root.hidden = !prompt;
    root.dataset.contextAction = prompt?.action ?? "";
    root.querySelector<HTMLElement>("[data-context-label]")!.textContent =
      prompt?.label ?? "";
  }

  private activateContextualAction(): void {
    const prompt = this.root.querySelector<HTMLElement>("[data-context-prompt]");
    if (!prompt || prompt.hidden) return;
    const action = prompt.dataset.contextAction;
    const selector = action === "PICK_UP"
      ? "[data-pick-up]:not(:disabled)"
      : action === "PLACE"
        ? "[data-drop]:not(:disabled)"
        : action === "CHOP"
          ? '[data-cook-action="CHOP"]:not(:disabled)'
          : action === "COOK"
            ? "[data-station-controls] [data-cook-action]:not(:disabled)"
            : '[data-cook-action="PLATE"]:not(:disabled)';
    this.root.querySelector<HTMLButtonElement>(selector)?.click();
  }

  private sendMovement(axisX: number, axisZ: number): void {
    const sequence = this.connection.move(axisX, axisZ);
    if (sequence !== undefined) {
      this.world.predictMovement?.(axisX, axisZ, sequence);
    }
  }

  private togglePauseOverlay(force?: boolean): void {
    const overlay = this.root.querySelector<HTMLElement>("[data-pause-overlay]");
    if (!overlay) return;
    overlay.hidden = force === undefined ? !overlay.hidden : !force;
    if (!overlay.hidden) {
      this.sendMovement(0, 0);
      overlay.querySelector<HTMLButtonElement>("[data-resume-game]")?.focus();
    }
  }

  private updateRunningObservation(snapshot: LobbySnapshot): void {
    const nextStatus = snapshot.roundStatus;
    const now = this.monotonicNow();
    const wasTerminal = this.observedRoundStatus === "WON" || this.observedRoundStatus === "LOST";
    const isTerminal = nextStatus === "WON" || nextStatus === "LOST";
    if (wasTerminal && !isTerminal) {
      this.observedRunningMs = 0;
      this.runningStartedAt = undefined;
    }
    if (this.observedRoundStatus === "RUNNING"
      && nextStatus !== "RUNNING"
      && this.runningStartedAt !== undefined) {
      this.observedRunningMs += Math.max(0, now - this.runningStartedAt);
      this.runningStartedAt = undefined;
    }
    if (nextStatus === "RUNNING" && this.observedRoundStatus !== "RUNNING") {
      if (this.observedRoundStatus === "WON" || this.observedRoundStatus === "LOST") {
        this.observedRunningMs = 0;
      }
      this.runningStartedAt = now;
      if (this.observedRoundStatus === "NOT_STARTED") {
        this.countdown.start();
      }
    }
    if (isTerminal && !wasTerminal) {
      this.terminalObservationCount += 1;
      this.terminalObservationId = `terminal-${this.terminalObservationCount}`;
    }
    this.observedRoundStatus = nextStatus;
  }

  private renderDebrief(snapshot: LobbySnapshot): void {
    if ((snapshot.roundStatus !== "WON" && snapshot.roundStatus !== "LOST")
      || !snapshot.role) {
      this.debrief.render();
      return;
    }
    this.debrief.render({
      observationId: this.terminalObservationId,
      role: snapshot.role,
      roundOutcome: snapshot.roundStatus,
      completedSteps: snapshot.completedStepCount ?? 0,
      totalSteps: snapshot.totalStepCount ?? 0,
      observedDurationSeconds: Math.floor(this.observedRunningMs / 1_000),
    });
  }

  private renderRoleIntroGate(snapshot: LobbySnapshot): void {
    const gate = this.root.querySelector<HTMLElement>("[data-role-intro-gate]")!;
    const briefing = gate.querySelector<HTMLElement>("[data-role-intro-briefing]")!;
    const role = snapshot.role;
    const roundHasStarted = snapshot.roundStatus !== undefined
      && snapshot.roundStatus !== "NOT_STARTED";
    // Auto-dismiss after the round starts — the gate must not block gameplay or results.
    if (role && roundHasStarted && this.acknowledgedRole !== role) {
      this.acknowledgedRole = role;
    }
    if (!role || this.acknowledgedRole === role || roundHasStarted) {
      gate.hidden = true;
      briefing.replaceChildren();
      return;
    }
    gate.querySelector<HTMLElement>("#role-intro-title")!.textContent = ROLE_LABELS[role];
    renderRoleBriefing(briefing, {
      role,
      phase: briefingPhase(snapshot),
    });
    gate.hidden = false;
  }

  private initSettings(): void {
    const storage = this.storage;
    const reducedMotion = storage.getItem("ck:settings:reducedMotion") === "1";
    const masterVolume = parseFloat(storage.getItem("ck:settings:masterVolume") ?? "1");
    const voiceVolume = parseFloat(storage.getItem("ck:settings:voiceVolume") ?? "1");

    const checkbox = this.root.querySelector<HTMLInputElement>('[data-pause-setting="reducedMotion"]')!;
    const masterRange = this.root.querySelector<HTMLInputElement>('[data-pause-setting="masterVolume"]')!;
    const voiceRange = this.root.querySelector<HTMLInputElement>('[data-pause-setting="voiceVolume"]')!;

    checkbox.checked = reducedMotion;
    masterRange.value = String(masterVolume);
    voiceRange.value = String(voiceVolume);
    this.applyReducedMotion(reducedMotion);
    sfx.setMasterVolume(masterVolume);
    applyVoiceVolume(voiceVolume);

    checkbox.addEventListener("change", () => {
      storage.setItem("ck:settings:reducedMotion", checkbox.checked ? "1" : "0");
      this.applyReducedMotion(checkbox.checked);
    });
    masterRange.addEventListener("input", () => {
      const v = parseFloat(masterRange.value);
      storage.setItem("ck:settings:masterVolume", masterRange.value);
      sfx.setMasterVolume(v);
    });
    voiceRange.addEventListener("input", () => {
      const v = parseFloat(voiceRange.value);
      storage.setItem("ck:settings:voiceVolume", voiceRange.value);
      applyVoiceVolume(v);
    });
  }

  private applyReducedMotion(enabled: boolean): void {
    if (enabled) document.documentElement.dataset.reduceMotion = "";
    else delete document.documentElement.dataset.reduceMotion;
  }

  private acknowledgeRoleIntro(): void {
    const gate = this.root.querySelector<HTMLElement>("[data-role-intro-gate]")!;
    const title = gate.querySelector<HTMLElement>("#role-intro-title")!.textContent;
    const role = Object.entries(ROLE_LABELS).find(([, label]) => label === title)?.[0];
    if (role) this.acknowledgedRole = role;
    gate.hidden = true;
    gate.querySelector<HTMLElement>("[data-role-intro-briefing]")!.replaceChildren();
  }

  private renderWaitingRoom(snapshot: LobbySnapshot): void {
    const count = snapshot.connectedCount ?? 0;
    this.root.querySelector<HTMLElement>("[data-waiting-player-count]")!.textContent =
      `${count} / ${REQUIRED_PLAYER_COUNT} players ready`;
    this.root.querySelector<HTMLElement>("[data-invite-code]")!.textContent =
      snapshot.roomId ?? "—";
    const list = this.root.querySelector<HTMLElement>("[data-waiting-player-list]")!;
    list.replaceChildren();
    for (const player of snapshot.players ?? []) {
      const li = document.createElement("li");
      li.className = player.connected ? "waiting-room__player" : "waiting-room__player waiting-room__player--away";
      li.textContent = player.displayName ?? `Player (${ROLE_LABELS[player.role]})`;
      list.append(li);
    }
  }

  private renderPresentationState(snapshot: LobbySnapshot): void {
    const phase = briefingPhase(snapshot);
    this.root.dataset.connectionState = snapshot.connectionStatus;
    this.root.dataset.roundPhase = phase;
    this.root.dataset.playerRole = snapshot.role ?? "";

    const isOperating = snapshot.connectionStatus === "CONNECTED"
      || snapshot.connectionStatus === "RECONNECTING";
    const isReconnecting = snapshot.connectionStatus === "RECONNECTING";
    const isTerminal = snapshot.roundStatus === "WON" || snapshot.roundStatus === "LOST";
    const isWaiting = isOperating && snapshot.roundStatus === "NOT_STARTED";
    this.root.querySelector<HTMLElement>("[data-setup-surface]")!.hidden = isOperating;
    this.root.querySelector<HTMLElement>("[data-operate-surface]")!.hidden = !isOperating;
    this.root.querySelector<HTMLElement>("[data-account-surface]")!.hidden = isOperating && !isTerminal;
    this.root.querySelector<HTMLElement>("[data-reconnection-overlay]")!.hidden = !isReconnecting;
    this.root.querySelector<HTMLElement>("[data-waiting-room]")!.hidden = !isWaiting;
    this.renderWaitingRoom(snapshot);
    this.renderRoleIntroGate(snapshot);

    const briefingRoot = this.root.querySelector<HTMLElement>("[data-role-briefing-root]")!;
    const briefingRenderKey = snapshot.role ? `${snapshot.role}:${phase}` : "";
    if (briefingRenderKey === this.briefingRenderKey) return;
    this.briefingRenderKey = briefingRenderKey;
    if (!snapshot.role) {
      briefingRoot.replaceChildren();
      return;
    }
    renderRoleBriefing(briefingRoot, { role: snapshot.role, phase });
  }

  private renderRound(snapshot: LobbySnapshot): void {
    const status = this.root.querySelector<HTMLElement>("[data-round-status]")!;
    const timer = this.root.querySelector<HTMLElement>("[data-round-timer]")!;
    const progressContainer = this.root.querySelector<HTMLElement>("[data-round-progress]")!;
    const progressLabel = progressContainer.querySelector<HTMLElement>("span")!;
    const progress = progressContainer.querySelector<HTMLProgressElement>("progress")!;
    const guidance = this.root.querySelector<HTMLElement>("[data-round-guidance]")!;
    const dishGoal = this.root.querySelector<HTMLElement>("[data-dish-goal]")!;
    const role = this.root.querySelector<HTMLElement>("[data-hud-role]")!;

    role.textContent = snapshot.role ? ROLE_LABELS[snapshot.role] : "Role pending";

    if (snapshot.recipeTitle && snapshot.roundStatus === "RUNNING") {
      dishGoal.textContent = `Tonight: ${snapshot.recipeTitle}`;
      dishGoal.hidden = false;
    } else {
      dishGoal.hidden = true;
    }
    status.textContent = snapshot.roundStatus
      ? formatWords(snapshot.roundStatus)
      : "Waiting";
    timer.textContent = snapshot.remainingMs === undefined
      ? "--:--"
      : formatRemainingTime(snapshot.remainingMs);

    const completed = snapshot.completedStepCount ?? 0;
    const total = snapshot.totalStepCount ?? 0;
    progressLabel.textContent = `${completed} / ${total}`;
    progress.value = completed;
    progress.max = Math.max(total, 1);
    guidance.textContent = snapshot.roundStatus === "PAUSED"
      ? "Waiting for all players to reconnect."
      : snapshot.roundStatus === "NOT_STARTED"
        ? "Waiting for the round to start."
        : "";

    if (snapshot.roundStatus === "RUNNING"
      && typeof snapshot.remainingMs === "number"
      && snapshot.remainingMs <= 30_000
      && snapshot.remainingMs > 0
      && this.timerWarnedAt !== this.observedRunningMs) {
      this.timerWarnedAt = this.observedRunningMs;
      sfx.play("timer_warning");
    }
    if (snapshot.roundStatus !== "RUNNING") {
      this.timerWarnedAt = undefined;
    }
  }

  private renderRoundResult(snapshot: LobbySnapshot): void {
    const root = this.root.querySelector<HTMLElement>("[data-round-result-root]")!;
    root.replaceChildren();
    if (snapshot.roundStatus !== "WON" && snapshot.roundStatus !== "LOST") return;
    sfx.play(snapshot.roundStatus === "WON" ? "win" : "lose");

    const result = document.createElement("section");
    result.dataset.roundResult = "";
    result.className = snapshot.roundStatus === "WON"
      ? "round-result round-result--success"
      : "round-result round-result--failure";
    result.setAttribute("aria-labelledby", "round-result-title");
    result.setAttribute("role", "status");

    const title = document.createElement("h2");
    title.id = "round-result-title";
    title.textContent = snapshot.roundStatus === "WON"
      ? "Round won!"
      : snapshot.outcomeReason === "TIME_EXPIRED"
        ? "Time's up"
        : "Round lost";
    result.append(title);

    const message = document.createElement("p");
    message.textContent = snapshot.roundStatus === "WON"
      ? "Dinner is served."
      : snapshot.outcomeReason === "TIME_EXPIRED"
        ? "The round ended because time expired."
        : "The server ended this round.";
    result.append(message);

    const progress = document.createElement("p");
    progress.className = "round-result-progress";
    progress.textContent = `${snapshot.completedStepCount ?? 0} / ${snapshot.totalStepCount ?? 0} steps completed`;
    result.append(progress);

    const actions = document.createElement("div");
    actions.className = "round-result-actions";

    const returnBtn = document.createElement("button");
    returnBtn.type = "button";
    returnBtn.dataset.action = "return-to-menu";
    returnBtn.textContent = "Return to menu";
    returnBtn.addEventListener("click", () => { void this.returnToSetup(); });
    actions.append(returnBtn);

    if (snapshot.roundStatus === "LOST") {
      const playAgainBtn = document.createElement("button");
      playAgainBtn.type = "button";
      playAgainBtn.dataset.action = "play-again";
      playAgainBtn.textContent = "Play again";
      playAgainBtn.addEventListener("click", () => { void this.returnToSetup(); });
      actions.append(playAgainBtn);
    }

    result.append(actions);
    root.append(result);
  }

  private async returnToSetup(): Promise<void> {
    if (this.worldMounted) {
      this.world.destroy();
      this.worldMounted = false;
    }
    if (this.inputMounted) {
      this.input.destroy();
      this.inputMounted = false;
    }
    await this.connection.leave();
  }

  private renderPrivateRecipe(snapshot: LobbySnapshot): void {
    const root = this.root.querySelector<HTMLElement>("[data-recipe-root]")!;
    const drawer = this.root.querySelector<HTMLDetailsElement>(
      "[data-recipe-drawer]",
    )!;
    drawer.hidden = snapshot.role !== "RECIPE_KEEPER";
    root.replaceChildren();
    if (snapshot.role !== "RECIPE_KEEPER") return;

    if (!snapshot.privateRecipe) {
      const waiting = document.createElement("p");
      waiting.textContent = "Waiting for private recipe.";
      root.append(waiting);
      return;
    }

    const panel = document.createElement("div");
    panel.dataset.privateRecipe = "";
    panel.setAttribute("aria-labelledby", "private-recipe-title");

    const title = document.createElement("h2");
    title.id = "private-recipe-title";
    title.textContent = snapshot.privateRecipe.title;
    panel.append(title);

    const ingredientsTitle = document.createElement("h3");
    ingredientsTitle.textContent = "Ingredients";
    panel.append(ingredientsTitle);
    const ingredients = document.createElement("ul");
    for (const ingredient of snapshot.privateRecipe.ingredients) {
      const item = document.createElement("li");
      item.textContent = `${ingredient.count} × ${formatWords(ingredient.kind)}`;
      ingredients.append(item);
    }
    panel.append(ingredients);

    const stepsTitle = document.createElement("h3");
    stepsTitle.textContent = "Steps";
    panel.append(stepsTitle);
    const steps = document.createElement("ol");
    const ingredientCounts = new Map(
      snapshot.privateRecipe.ingredients.map((ingredient) => [ingredient.kind, ingredient.count]),
    );
    for (const step of snapshot.privateRecipe.steps) {
      const item = document.createElement("li");
      item.dataset.recipeStep = "";
      item.textContent = formatRecipeStep(step, ingredientCounts);
      steps.append(item);
    }
    panel.append(steps);
    root.append(panel);
  }

  private renderObjects(snapshot: LobbySnapshot): void {
    const list = this.root.querySelector<HTMLUListElement>(".object-list")!;
    list.replaceChildren();
    const world = projectKitchenWorld(snapshot);
    const isBlindCook = snapshot.role === "BLIND_COOK";
    const canAct = isActionableRound(snapshot);
    const canManipulate = isBlindCook && canAct;
    this.field("interaction-guidance").textContent = isBlindCook
      ? "You can manipulate one reachable object at a time."
      : "Only the Blind Cook can pick up and drop objects.";

    for (const object of world.objects) {
      const preparation = object.preparation ?? "RAW";
      const location = object.location ?? "COUNTER";
      const item = document.createElement("li");
      item.className = "object-row kitchen-object-hotspot";
      item.dataset.objectId = object.id;
      item.style.left = `${object.hotspot.left}%`;
      item.style.top = `${object.hotspot.top}%`;
      item.style.zIndex = String(object.depth);
      item.classList.toggle(
        "kitchen-object-hotspot--lower",
        object.hotspot.top > 60,
      );
      item.classList.toggle(
        "kitchen-object-hotspot--right",
        object.hotspot.left > 72,
      );

      const description = document.createElement("span");
      const holder = object.heldByMe
        ? "Held by you"
        : object.held
          ? "Held by another player"
          : "Available";
      description.textContent = `${object.label} (${object.worldX}, ${object.worldY}) · ${formatWords(preparation)} · ${formatWords(location)} · ${holder}`;
      description.className = "visually-hidden";
      item.append(description);

      const point = document.createElement("button");
      point.type = "button";
      point.textContent = "Point";
      point.dataset.pointObject = object.id;
      point.dataset.kitchenHotspot = "";
      point.dataset.worldLabel = object.label;
      point.className = `kitchen-hotspot kitchen-hotspot--object kitchen-hotspot--${object.kind.toLowerCase()}`;
      point.setAttribute("aria-label", object.ariaLabel);
      point.style.left = `${object.hotspot.left}%`;
      point.style.top = `${object.hotspot.top}%`;
      point.disabled = !canAct;
      point.addEventListener("click", () => {
        this.selectWorldTarget(item);
        this.connection.pointAtObject(object.id);
      });
      installKeyboardActivation(point);
      item.append(point);
      const actionTray = document.createElement("div");
      actionTray.className = "world-action-tray";

      const canPickUp = location !== "POT" && preparation !== "RUINED";
      if (canManipulate && !object.held && canPickUp) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Pick up";
        button.dataset.pickUp = object.id;
        button.dataset.worldAction = "";
        button.addEventListener("click", () => { sfx.play("pick_up"); this.connection.pickUp(object.id); });
        actionTray.append(button);
      } else if (canManipulate && object.heldByMe) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Drop";
        button.dataset.drop = object.id;
        button.dataset.worldAction = "";
        button.addEventListener("click", () => { sfx.play("drop"); this.connection.drop(object.id); });
        actionTray.append(button);

        if (location === "COUNTER" && preparation === "RAW") {
          actionTray.append(
            this.cookButton("Chop", "CHOP", () => { sfx.play("chop"); this.connection.chop(object.id); }),
          );
        } else if (location === "COUNTER" && preparation === "CHOPPED") {
          actionTray.append(
            this.cookButton("Add to pot", "ADD_TO_POT", () => {
              sfx.play("add_to_pot");
              this.connection.addToPot(object.id);
            }),
          );
          const ruin = this.cookButton("Chop again (ruins)", "CHOP", () => {
            sfx.play("chop");
            this.connection.chop(object.id);
          });
          ruin.classList.add("danger-action");
          actionTray.append(ruin);
        }
      }

      item.append(actionTray);
      list.append(item);
    }
  }

  private renderWorldAvatars(snapshot: LobbySnapshot): void {
    const root = this.root.querySelector<HTMLElement>(
      "[data-kitchen-avatars]",
    )!;
    root.replaceChildren();
    if (snapshot.players !== undefined) {
      for (const player of snapshot.players) {
        const label = document.createElement("span");
        label.className = "visually-hidden";
        label.dataset.kitchenAvatar = player.role;
        label.dataset.sessionId = player.id;
        label.dataset.worldX = player.x.toFixed(2);
        label.dataset.worldZ = player.z.toFixed(2);
        label.dataset.locomotion = player.locomotion;
        label.dataset.connected = String(player.connected);
        const name = player.displayName ?? ROLE_LABELS[player.role];
        label.textContent = `${name}, ${ROLE_LABELS[player.role]}, at ${player.x.toFixed(2)}, ${player.z.toFixed(2)}, ${player.locomotion.toLowerCase()}, ${player.connected ? "connected" : "disconnected"}`;
        root.append(label);
      }
      return;
    }
    for (const avatar of projectKitchenWorld(snapshot).avatars) {
      const label = document.createElement("span");
      label.className = "visually-hidden";
      label.dataset.kitchenAvatar = avatar.role;
      label.dataset.stationId = avatar.stationId;
      label.textContent = avatar.label;
      root.append(label);
    }
  }

  private selectWorldTarget(target: HTMLElement): void {
    for (const item of this.root.querySelectorAll<HTMLElement>(
      ".kitchen-object-hotspot, .kitchen-station-hotspot",
    )) {
      item.classList.toggle("is-selected", item === target);
    }
  }

  private renderStationControls(snapshot: LobbySnapshot): void {
    const controls = this.root.querySelector<HTMLElement>("[data-station-controls]")!;
    controls.replaceChildren();
    if (snapshot.role !== "BLIND_COOK" || !isActionableRound(snapshot)) return;

    const action = terminalActionForProgress(
      snapshot.completedStepCount,
      snapshot.totalStepCount,
    );
    if (!action) return;
    const methods = {
      SEASON: () => this.connection.season(),
      BOIL: () => this.connection.boil(),
      MIX: () => this.connection.mix(),
      PLATE: () => this.connection.plate(),
    } as const;
    controls.append(this.cookButton(formatWords(action), action, methods[action]));
  }

  private cookButton(
    label: string,
    action: "CHOP" | "ADD_TO_POT" | "SEASON" | "BOIL" | "MIX" | "PLATE",
    invoke: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.cookAction = action;
    button.dataset.worldAction = "";
    button.addEventListener("click", invoke);
    return button;
  }

  private renderPointLocations(snapshot: LobbySnapshot): void {
    const controls = this.root.querySelector<HTMLElement>("[data-point-controls]")!;
    controls.replaceChildren();
    for (const location of KITCHEN_STATIONS) {
      const wrapper = document.createElement("div");
      wrapper.className = "kitchen-station-hotspot";
      wrapper.style.left = `${location.hotspot.left}%`;
      wrapper.style.top = `${location.hotspot.top}%`;
      wrapper.style.zIndex = String(location.depth + 1);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Point: ${location.label}`;
      button.dataset.pointLocation = location.id;
      button.dataset.kitchenHotspot = "";
      button.dataset.stationId = location.id;
      button.dataset.worldLabel = location.label;
      button.className = "kitchen-hotspot kitchen-hotspot--station";
      button.setAttribute("aria-label", location.label);
      button.style.left = `${location.hotspot.left}%`;
      button.style.top = `${location.hotspot.top}%`;
      button.disabled = !isActionableRound(snapshot);
      button.addEventListener("click", () => {
        this.selectWorldTarget(wrapper);
        this.connection.pointAtLocation(location.worldX, location.worldY);
      });
      installKeyboardActivation(button);
      wrapper.append(button);
      controls.append(wrapper);
    }
  }

  private showError(message?: string): void {
    const error = this.root.querySelector<HTMLElement>(".join-panel .error")!;
    error.textContent = message ?? "";
    error.hidden = !message;
  }

  private setDisabled(disabled: boolean): void {
    this.createButton.disabled = disabled;
    this.joinButton.disabled = disabled;
    this.quickMatchButton.disabled = disabled;
  }

  private updateActionAvailability(): void {
    this.setDisabled(
      this.resumePending || this.connectionStatus !== "DISCONNECTED",
    );
  }

  private field(name: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(`[data-field=${name}]`)!;
  }

  private get nameInput(): HTMLInputElement {
    return this.root.querySelector<HTMLInputElement>(".join-panel [name=displayName]")!;
  }

  private get roomInput(): HTMLInputElement {
    return this.root.querySelector<HTMLInputElement>(".join-panel [name=roomId]")!;
  }

  private get createButton(): HTMLButtonElement {
    return this.root.querySelector<HTMLButtonElement>("[data-action=create]")!;
  }

  private get joinButton(): HTMLButtonElement {
    return this.root.querySelector<HTMLButtonElement>("[data-action=join]")!;
  }

  private get quickMatchButton(): HTMLButtonElement {
    return this.root.querySelector<HTMLButtonElement>("[data-action=quick-match]")!;
  }
}

function formatWords(value: string): string {
  const normalized = value.toLowerCase().replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function briefingPhase(snapshot: LobbySnapshot): RoleBriefingPhase {
  switch (snapshot.roundStatus) {
    case "RUNNING":
    case "PAUSED":
    case "WON":
    case "LOST":
      return snapshot.roundStatus;
    case "NOT_STARTED":
    default:
      return "WAITING";
  }
}

function formatRemainingTime(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatRecipeStep(
  step: NonNullable<LobbySnapshot["privateRecipe"]>["steps"][number],
  ingredientCounts: ReadonlyMap<string, number>,
): string {
  switch (step.action) {
    case "CHOP":
      return `Chop ${formatWords(step.ingredientKind)}${formatStepQuantity(ingredientCounts.get(step.ingredientKind))}`;
    case "ADD_TO_POT":
      return `Add ${formatWords(step.ingredientKind)} to pot${formatStepQuantity(ingredientCounts.get(step.ingredientKind))}`;
    case "SEASON":
      return "Season";
    case "BOIL":
      return "Boil";
    case "MIX":
      return "Mix";
    case "PLATE":
      return "Plate";
  }
}

function formatStepQuantity(count: number | undefined): string {
  return count !== undefined && count > 1 ? ` × ${count}` : "";
}

function structuralKitchenRenderKey(snapshot: LobbySnapshot): string {
  return JSON.stringify([
    snapshot.connectionStatus,
    snapshot.roomId,
    snapshot.sessionId,
    snapshot.role,
    snapshot.roomStatus,
    snapshot.roundStatus,
    snapshot.completedStepCount,
    snapshot.totalStepCount,
    snapshot.outcomeReason,
    snapshot.objects,
    snapshot.privateRecipe,
  ]);
}

function browserFeedbackStorage(): Storage {
  try {
    return window.localStorage;
  } catch {
    return {
      get length() { return 0; },
      clear() { throw new DOMException("Storage unavailable", "SecurityError"); },
      getItem() { return null; },
      key() { return null; },
      removeItem() { throw new DOMException("Storage unavailable", "SecurityError"); },
      setItem() { throw new DOMException("Storage unavailable", "SecurityError"); },
    };
  }
}

function isActionableRound(snapshot: LobbySnapshot): boolean {
  return snapshot.roomStatus === "READY"
    && (snapshot.roundStatus === undefined || snapshot.roundStatus === "RUNNING");
}

function terminalActionForProgress(
  completedStepCount: number | undefined,
  totalStepCount: number | undefined,
): "SEASON" | "BOIL" | "MIX" | "PLATE" | undefined {
  if (completedStepCount === undefined || totalStepCount === undefined || totalStepCount < 4) return undefined;
  switch (completedStepCount - (totalStepCount - 4)) {
    case 0:
      return "SEASON";
    case 1:
      return "BOIL";
    case 2:
      return "MIX";
    case 3:
      return "PLATE";
    default:
      return undefined;
  }
}

function installKeyboardActivation(button: HTMLButtonElement): void {
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    button.click();
  });
}

function applyVoiceVolume(volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((el) => {
    el.volume = clamped;
  });
}
