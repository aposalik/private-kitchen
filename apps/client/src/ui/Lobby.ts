import {
  BLIND_COOK_INTERACTION,
  REQUIRED_PLAYER_COUNT,
  ROLE_LABELS,
} from "@cooking-game/shared";

import type {
  ConnectionStatus,
  LobbyConnection,
  LobbySnapshot,
} from "../network/RoomClient.js";

export class Lobby {
  private connectionStatus: ConnectionStatus = "DISCONNECTED";
  private resumePending = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly connection: LobbyConnection,
  ) {}

  mount(): void {
    this.root.innerHTML = `
      <section class="lobby-card" aria-labelledby="lobby-title">
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
            <button type="button" data-action="create">Create private room</button>
            <button type="button" class="secondary" data-action="join">Join room</button>
          </div>
          <p class="error" role="alert" hidden></p>
        </div>

        <dl class="room-state" aria-live="polite">
          <div><dt>Connection</dt><dd data-field="connection">Disconnected</dd></div>
          <div><dt>Room ID</dt><dd data-field="room">—</dd></div>
          <div><dt>Your role</dt><dd data-field="role">Assigned on join</dd></div>
          <div><dt>Players</dt><dd data-field="players">0 / ${REQUIRED_PLAYER_COUNT}</dd></div>
          <div><dt>Kitchen</dt><dd data-field="status">Waiting</dd></div>
        </dl>
        <section class="objects-panel" aria-labelledby="objects-title">
          <div class="objects-heading">
            <div>
              <p class="eyebrow">Authoritative kitchen</p>
              <h2 id="objects-title">Objects</h2>
            </div>
            <p class="role-guidance" data-field="interaction-guidance"></p>
          </div>
          <p class="interaction-error" role="alert" hidden></p>
          <ul class="object-list" aria-live="polite"></ul>
        </section>
      </section>`;

    const params = new URLSearchParams(location.search);
    this.nameInput.value = params.get("player") ?? "";
    this.roomInput.value = params.get("room") ?? "";
    this.connection.subscribe((snapshot) => this.render(snapshot));
    this.createButton.addEventListener("click", () => void this.connect("create"));
    this.joinButton.addEventListener("click", () => void this.connect("join"));

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

  private async connect(action: "create" | "join"): Promise<void> {
    const displayName = this.nameInput.value.trim();
    const roomId = this.roomInput.value.trim();
    if (!displayName || (action === "join" && !roomId)) {
      this.showError("Enter your name and, when joining, a room ID.");
      return;
    }

    this.showError();
    this.setDisabled(true);
    try {
      if (action === "create") {
        await this.connection.create(displayName);
      } else {
        await this.connection.join(roomId, displayName);
      }
    } catch {
      this.showError("Unable to connect. Check the room ID and try again.");
    } finally {
      this.updateActionAvailability();
    }
  }

  private render(snapshot: LobbySnapshot): void {
    this.connectionStatus = snapshot.connectionStatus;
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
    this.renderObjects(snapshot);
    const interactionError = this.root.querySelector<HTMLElement>(
      ".interaction-error",
    )!;
    interactionError.textContent = snapshot.interactionError ?? "";
    interactionError.hidden = !snapshot.interactionError;
  }

  private renderObjects(snapshot: LobbySnapshot): void {
    const list = this.root.querySelector<HTMLUListElement>(".object-list")!;
    list.replaceChildren();
    const canInteract = snapshot.role === "BLIND_COOK";
    this.field("interaction-guidance").textContent = canInteract
      ? "You can manipulate one reachable object at a time."
      : "Only the Blind Cook can pick up and drop objects.";

    for (const object of snapshot.objects ?? []) {
      const item = document.createElement("li");
      item.className = "object-row";
      item.dataset.objectId = object.id;

      const description = document.createElement("span");
      const holder = object.heldByMe
        ? "Held by you"
        : object.heldBy
          ? "Held by another player"
          : "Available";
      description.textContent = `${object.label} (${object.x}, ${object.y}) · ${holder}`;
      item.append(description);

      if (canInteract && !object.heldBy) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Pick up";
        button.dataset.pickUp = object.id;
        button.disabled = snapshot.roomStatus !== "READY";
        button.addEventListener("click", () => this.connection.pickUp(object.id));
        item.append(button);
      } else if (canInteract && object.heldByMe) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Drop";
        button.dataset.drop = object.id;
        button.disabled = snapshot.roomStatus !== "READY";
        button.addEventListener("click", () => {
          const x =
            object.x === BLIND_COOK_INTERACTION.originX
              ? BLIND_COOK_INTERACTION.originX + 1
              : BLIND_COOK_INTERACTION.originX;
          this.connection.drop(object.id, x, BLIND_COOK_INTERACTION.originY);
        });
        item.append(button);
      }

      list.append(item);
    }
  }

  private showError(message?: string): void {
    const error = this.root.querySelector<HTMLElement>(".error")!;
    error.textContent = message ?? "";
    error.hidden = !message;
  }

  private setDisabled(disabled: boolean): void {
    this.createButton.disabled = disabled;
    this.joinButton.disabled = disabled;
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
    return this.root.querySelector<HTMLInputElement>("[name=displayName]")!;
  }

  private get roomInput(): HTMLInputElement {
    return this.root.querySelector<HTMLInputElement>("[name=roomId]")!;
  }

  private get createButton(): HTMLButtonElement {
    return this.root.querySelector<HTMLButtonElement>("[data-action=create]")!;
  }

  private get joinButton(): HTMLButtonElement {
    return this.root.querySelector<HTMLButtonElement>("[data-action=join]")!;
  }
}

function formatWords(value: string): string {
  const normalized = value.toLowerCase().replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
