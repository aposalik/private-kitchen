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
import { CommunicationPanel } from "./CommunicationPanel.js";

const KITCHEN_POINT_LOCATIONS = [
  { id: "PREP", label: "Prep counter", x: 25, y: 30 },
  { id: "STOVE", label: "Stove", x: 50, y: 30 },
  { id: "PASS", label: "Serving pass", x: 75, y: 30 },
] as const;

export class Lobby {
  private connectionStatus: ConnectionStatus = "DISCONNECTED";
  private kitchenRenderKey = "";
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

        <section data-auth-root></section>

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
        <section class="round-panel" data-round-section aria-labelledby="round-title">
          <div>
            <p class="eyebrow">Server round</p>
            <h2 id="round-title">Round</h2>
          </div>
          <dl class="round-state" aria-live="polite">
            <div><dt>Status</dt><dd data-round-status>Waiting</dd></div>
            <div><dt>Time remaining</dt><dd data-round-timer>--:--</dd></div>
            <div data-round-progress>
              <dt>Progress</dt>
              <dd><span>0 / 0</span><progress value="0" max="1" aria-label="Completed recipe steps"></progress></dd>
            </div>
          </dl>
          <p class="round-guidance" data-round-guidance></p>
        </section>
        <div class="round-result-root" data-round-result-root aria-live="polite"></div>
        <section class="recipe-panel" data-recipe-root aria-live="polite"></section>
        <section class="objects-panel" aria-labelledby="objects-title">
          <div class="objects-heading">
            <div>
              <p class="eyebrow">Authoritative kitchen</p>
              <h2 id="objects-title">Objects</h2>
            </div>
            <p class="role-guidance" data-field="interaction-guidance"></p>
          </div>
          <p class="interaction-error" role="alert" hidden></p>
          <p class="cooking-error" role="alert" hidden></p>
          <ul class="object-list" aria-live="polite"></ul>
          <div data-station-controls role="group" aria-label="Cooking station actions"></div>
          <div data-point-controls role="group" aria-label="Point at a kitchen location"></div>
        </section>
        <section data-communication-root></section>
      </section>`;

    const params = new URLSearchParams(location.search);
    this.nameInput.value = params.get("player") ?? "";
    this.roomInput.value = params.get("room") ?? "";
    this.connection.subscribe((snapshot) => this.render(snapshot));
    new CommunicationPanel(this.root.querySelector<HTMLElement>("[data-communication-root]")!, this.connection).mount();
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

  restoreDisplayName(displayName: string): void {
    if (this.nameInput.value.trim().length === 0) this.nameInput.value = displayName;
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

  private renderRound(snapshot: LobbySnapshot): void {
    const status = this.root.querySelector<HTMLElement>("[data-round-status]")!;
    const timer = this.root.querySelector<HTMLElement>("[data-round-timer]")!;
    const progressContainer = this.root.querySelector<HTMLElement>("[data-round-progress]")!;
    const progressLabel = progressContainer.querySelector<HTMLElement>("span")!;
    const progress = progressContainer.querySelector<HTMLProgressElement>("progress")!;
    const guidance = this.root.querySelector<HTMLElement>("[data-round-guidance]")!;

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
  }

  private renderRoundResult(snapshot: LobbySnapshot): void {
    const root = this.root.querySelector<HTMLElement>("[data-round-result-root]")!;
    root.replaceChildren();
    if (snapshot.roundStatus !== "WON" && snapshot.roundStatus !== "LOST") return;

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
    root.append(result);
  }

  private renderPrivateRecipe(snapshot: LobbySnapshot): void {
    const root = this.root.querySelector<HTMLElement>("[data-recipe-root]")!;
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
    for (const step of snapshot.privateRecipe.steps) {
      const item = document.createElement("li");
      item.dataset.recipeStep = "";
      item.textContent = formatRecipeStep(step);
      steps.append(item);
    }
    panel.append(steps);
    root.append(panel);
  }

  private renderObjects(snapshot: LobbySnapshot): void {
    const list = this.root.querySelector<HTMLUListElement>(".object-list")!;
    list.replaceChildren();
    const isBlindCook = snapshot.role === "BLIND_COOK";
    const canAct = isActionableRound(snapshot);
    const canManipulate = isBlindCook && canAct;
    this.field("interaction-guidance").textContent = isBlindCook
      ? "You can manipulate one reachable object at a time."
      : "Only the Blind Cook can pick up and drop objects.";

    for (const object of snapshot.objects ?? []) {
      const preparation = object.preparation ?? "RAW";
      const location = object.location ?? "COUNTER";
      const item = document.createElement("li");
      item.className = "object-row";
      item.dataset.objectId = object.id;

      const description = document.createElement("span");
      const holder = object.heldByMe
        ? "Held by you"
        : object.heldBy
          ? "Held by another player"
          : "Available";
      description.textContent = `${object.label} (${object.x}, ${object.y}) · ${formatWords(preparation)} · ${formatWords(location)} · ${holder}`;
      item.append(description);

      const point = document.createElement("button");
      point.type = "button";
      point.textContent = "Point";
      point.dataset.pointObject = object.id;
      point.disabled = !canAct;
      point.addEventListener("click", () => this.connection.pointAtObject(object.id));
      item.append(point);

      const canPickUp = location !== "POT" && preparation !== "RUINED";
      if (canManipulate && !object.heldBy && canPickUp) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Pick up";
        button.dataset.pickUp = object.id;
        button.addEventListener("click", () => this.connection.pickUp(object.id));
        item.append(button);
      } else if (canManipulate && object.heldByMe) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Drop";
        button.dataset.drop = object.id;
        button.addEventListener("click", () => {
          const x =
            object.x === BLIND_COOK_INTERACTION.originX
              ? BLIND_COOK_INTERACTION.originX + 1
              : BLIND_COOK_INTERACTION.originX;
          this.connection.drop(object.id, x, BLIND_COOK_INTERACTION.originY);
        });
        item.append(button);

        if (location === "COUNTER" && preparation === "RAW") {
          item.append(
            this.cookButton("Chop", "CHOP", () => this.connection.chop(object.id)),
          );
        } else if (location === "COUNTER" && preparation === "CHOPPED") {
          item.append(
            this.cookButton("Add to pot", "ADD_TO_POT", () =>
              this.connection.addToPot(object.id),
            ),
          );
          const ruin = this.cookButton("Chop again (ruins)", "CHOP", () =>
            this.connection.chop(object.id),
          );
          ruin.classList.add("danger-action");
          item.append(ruin);
        }
      }

      list.append(item);
    }
  }

  private renderStationControls(snapshot: LobbySnapshot): void {
    const controls = this.root.querySelector<HTMLElement>("[data-station-controls]")!;
    controls.replaceChildren();
    if (snapshot.role !== "BLIND_COOK" || !isActionableRound(snapshot)) return;

    const action = terminalActionForProgress(snapshot.completedStepCount);
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
    button.addEventListener("click", invoke);
    return button;
  }

  private renderPointLocations(snapshot: LobbySnapshot): void {
    const controls = this.root.querySelector<HTMLElement>("[data-point-controls]")!;
    controls.replaceChildren();
    for (const location of KITCHEN_POINT_LOCATIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Point: ${location.label}`;
      button.dataset.pointLocation = location.id;
      button.disabled = !isActionableRound(snapshot);
      button.addEventListener("click", () => this.connection.pointAtLocation(location.x, location.y));
      controls.append(button);
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
}

function formatWords(value: string): string {
  const normalized = value.toLowerCase().replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatRemainingTime(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatRecipeStep(
  step: NonNullable<LobbySnapshot["privateRecipe"]>["steps"][number],
): string {
  switch (step.action) {
    case "CHOP":
      return `Chop ${formatWords(step.ingredientKind)}`;
    case "ADD_TO_POT":
      return `Add ${formatWords(step.ingredientKind)} to pot`;
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

function isActionableRound(snapshot: LobbySnapshot): boolean {
  return snapshot.roomStatus === "READY"
    && (snapshot.roundStatus === undefined || snapshot.roundStatus === "RUNNING");
}

function terminalActionForProgress(
  completedStepCount: number | undefined,
): "SEASON" | "BOIL" | "MIX" | "PLATE" | undefined {
  switch (completedStepCount) {
    case 6:
      return "SEASON";
    case 7:
      return "BOIL";
    case 8:
      return "MIX";
    case 9:
      return "PLATE";
    default:
      return undefined;
  }
}
