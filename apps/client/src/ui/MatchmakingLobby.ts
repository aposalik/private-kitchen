import { Client } from "@colyseus/sdk";

import {
  MATCHMAKING_MESSAGES,
  MATCHMAKING_ROOM_NAME,
  REGIONS,
  REGION_LABELS,
  ROLE_PREFERENCES,
  ROLE_PREFERENCE_LABELS,
  type MatchmakingJoinOptions,
  type MatchmakingServerEvent,
  type Region,
  type RolePreference,
} from "@cooking-game/shared";

export interface MatchmakingResult {
  roomId: string;
  ticket: string;
  displayName: string;
  characterId: string;
}

export interface MatchmakingLobbyOptions {
  endpoint: string;
  displayName: string;
  characterId: string;
  onMatch: (result: MatchmakingResult) => void;
  onCancel: () => void;
}

type Phase =
  | "PREFERENCES"
  | "SEARCHING"
  | "READY_CHECK"
  | "PENALTY";

export class MatchmakingLobby {
  private readonly root: HTMLElement;
  private readonly opts: MatchmakingLobbyOptions;
  private phase: Phase = "PREFERENCES";
  private region: Region = "EU";
  private rolePreference: RolePreference = "ANY";
  private room: Awaited<ReturnType<Client["joinOrCreate"]>> | undefined;
  private readyCheckTimer: ReturnType<typeof setInterval> | undefined;
  private readyCheckDeadline = 0;
  private assignedRole = "";
  private penaltyRemainingMs = 0;

  constructor(root: HTMLElement, opts: MatchmakingLobbyOptions) {
    this.root = root;
    this.opts = opts;
  }

  mount(): void {
    this.render();
  }

  unmount(): void {
    this.cleanup();
    this.root.innerHTML = "";
  }

  private cleanup(): void {
    if (this.readyCheckTimer !== undefined) {
      clearInterval(this.readyCheckTimer);
      this.readyCheckTimer = undefined;
    }
    if (this.room) {
      void this.room.leave(true);
      this.room = undefined;
    }
  }

  private render(): void {
    this.root.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "mm-panel";

    switch (this.phase) {
      case "PREFERENCES":
        panel.appendChild(this.renderPreferences());
        break;
      case "SEARCHING":
        panel.appendChild(this.renderSearching());
        break;
      case "READY_CHECK":
        panel.appendChild(this.renderReadyCheck());
        break;
      case "PENALTY":
        panel.appendChild(this.renderPenalty());
        break;
    }

    this.root.appendChild(panel);
  }

  private renderPreferences(): DocumentFragment {
    const frag = document.createDocumentFragment();

    const title = document.createElement("h2");
    title.textContent = "Quick Match";
    frag.appendChild(title);

    // Region
    const regionLabel = document.createElement("label");
    regionLabel.textContent = "Your region";
    const regionSelect = document.createElement("select");
    for (const r of REGIONS) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = REGION_LABELS[r];
      if (r === this.region) opt.selected = true;
      regionSelect.appendChild(opt);
    }
    regionSelect.addEventListener("change", () => {
      this.region = regionSelect.value as Region;
    });
    regionLabel.appendChild(regionSelect);
    frag.appendChild(regionLabel);

    // Role preference
    const roleLabel = document.createElement("label");
    roleLabel.textContent = "Preferred role";
    const roleSelect = document.createElement("select");
    for (const r of ROLE_PREFERENCES) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = ROLE_PREFERENCE_LABELS[r];
      if (r === this.rolePreference) opt.selected = true;
      roleSelect.appendChild(opt);
    }
    roleSelect.addEventListener("change", () => {
      this.rolePreference = roleSelect.value as RolePreference;
    });
    roleLabel.appendChild(roleSelect);
    frag.appendChild(roleLabel);

    const findBtn = document.createElement("button");
    findBtn.textContent = "Find Match";
    findBtn.addEventListener("click", () => void this.startSearch());
    frag.appendChild(findBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Back";
    cancelBtn.addEventListener("click", () => this.opts.onCancel());
    frag.appendChild(cancelBtn);

    return frag;
  }

  private renderSearching(): DocumentFragment {
    const frag = document.createDocumentFragment();

    const title = document.createElement("h2");
    title.textContent = "Finding players...";
    frag.appendChild(title);

    const info = document.createElement("p");
    info.textContent = `Region: ${REGION_LABELS[this.region]}  |  Role: ${ROLE_PREFERENCE_LABELS[this.rolePreference]}`;
    frag.appendChild(info);

    const spinner = document.createElement("div");
    spinner.className = "mm-spinner";
    frag.appendChild(spinner);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.cancel());
    frag.appendChild(cancelBtn);

    return frag;
  }

  private renderReadyCheck(): DocumentFragment {
    const frag = document.createDocumentFragment();

    const title = document.createElement("h2");
    title.textContent = "Match found!";
    frag.appendChild(title);

    const roleEl = document.createElement("p");
    roleEl.textContent = `Your role: ${this.assignedRole.replace(/_/g, " ")}`;
    frag.appendChild(roleEl);

    const timerEl = document.createElement("p");
    timerEl.dataset["mmTimer"] = "1";
    timerEl.textContent = this.timerText();
    frag.appendChild(timerEl);

    const acceptBtn = document.createElement("button");
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", () => this.confirmReady());
    frag.appendChild(acceptBtn);

    const declineBtn = document.createElement("button");
    declineBtn.textContent = "Decline";
    declineBtn.addEventListener("click", () => this.declineReady());
    frag.appendChild(declineBtn);

    return frag;
  }

  private renderPenalty(): DocumentFragment {
    const frag = document.createDocumentFragment();

    const title = document.createElement("h2");
    title.textContent = "Penalty active";
    frag.appendChild(title);

    const info = document.createElement("p");
    info.dataset["mmPenalty"] = "1";
    info.textContent = `You declined or missed a ready check. Please wait ${Math.ceil(this.penaltyRemainingMs / 1000)}s before queuing again.`;
    frag.appendChild(info);

    const backBtn = document.createElement("button");
    backBtn.textContent = "Back";
    backBtn.addEventListener("click", () => this.opts.onCancel());
    frag.appendChild(backBtn);

    return frag;
  }

  private timerText(): string {
    const remaining = Math.max(0, Math.ceil((this.readyCheckDeadline - Date.now()) / 1000));
    return `Respond within ${remaining}s`;
  }

  private async startSearch(): Promise<void> {
    this.phase = "SEARCHING";
    this.render();

    const client = new Client(this.opts.endpoint);
    const joinOptions: MatchmakingJoinOptions = {
      displayName: this.opts.displayName,
      characterId: this.opts.characterId,
      region: this.region,
      rolePreference: this.rolePreference,
    };

    try {
      this.room = await client.joinOrCreate(MATCHMAKING_ROOM_NAME, joinOptions);
    } catch {
      this.phase = "PREFERENCES";
      this.render();
      return;
    }

    this.room.onMessage(MATCHMAKING_MESSAGES.event, (event: MatchmakingServerEvent) => {
      this.handleServerEvent(event);
    });

    this.room.onLeave(() => {
      if (this.phase === "SEARCHING" || this.phase === "READY_CHECK") {
        this.phase = "PREFERENCES";
        this.render();
      }
    });
  }

  private handleServerEvent(event: MatchmakingServerEvent): void {
    switch (event.type) {
      case "QUEUE_UPDATE":
        break;

      case "READY_CHECK":
        this.phase = "READY_CHECK";
        this.assignedRole = event.assignedRole;
        this.readyCheckDeadline = Date.now() + event.timeoutMs;
        this.render();
        this.readyCheckTimer = setInterval(() => {
          const el = this.root.querySelector<HTMLElement>("[data-mm-timer]");
          if (el) el.textContent = this.timerText();
          if (Date.now() >= this.readyCheckDeadline) {
            clearInterval(this.readyCheckTimer);
            this.readyCheckTimer = undefined;
          }
        }, 500);
        break;

      case "MATCH_READY":
        this.cleanup();
        this.opts.onMatch({
          roomId: event.roomId,
          ticket: event.ticket,
          displayName: this.opts.displayName,
          characterId: this.opts.characterId,
        });
        break;

      case "MATCH_CANCELLED":
        if (this.readyCheckTimer !== undefined) {
          clearInterval(this.readyCheckTimer);
          this.readyCheckTimer = undefined;
        }
        if (event.requeued) {
          this.phase = "SEARCHING";
        } else {
          this.phase = "PREFERENCES";
        }
        this.render();
        break;

      case "PENALTY_ACTIVE":
        this.penaltyRemainingMs = event.remainingMs;
        this.phase = "PENALTY";
        this.cleanup();
        this.render();
        break;
    }
  }

  private confirmReady(): void {
    this.room?.send(MATCHMAKING_MESSAGES.readyConfirm);
    if (this.readyCheckTimer !== undefined) {
      clearInterval(this.readyCheckTimer);
      this.readyCheckTimer = undefined;
    }
    const title = this.root.querySelector("h2");
    if (title) title.textContent = "Waiting for others...";
    const btns = this.root.querySelectorAll("button");
    btns.forEach((b) => b.remove());
  }

  private declineReady(): void {
    this.room?.send(MATCHMAKING_MESSAGES.readyDecline);
    this.cleanup();
    this.penaltyRemainingMs = 60_000;
    this.phase = "PENALTY";
    this.render();
  }

  private cancel(): void {
    this.cleanup();
    this.phase = "PREFERENCES";
    this.render();
  }
}
