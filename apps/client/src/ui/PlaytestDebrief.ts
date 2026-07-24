import type { PlayerRole } from "@cooking-game/shared";

import {
  PlaytestFeedbackStore,
  type MisunderstoodSignal,
  type ReplayIntent,
} from "../playtest/PlaytestFeedback.js";

export interface PlaytestDebriefContext {
  readonly observationId: string;
  readonly role: PlayerRole;
  readonly roundOutcome: "WON" | "LOST";
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly observedDurationSeconds: number;
}

export class PlaytestDebrief {
  private readonly submittedObservationIds = new Set<string>();
  private renderKey = "";

  constructor(
    private readonly root: HTMLElement,
    private readonly store: PlaytestFeedbackStore,
    private readonly exportFeedback: (json: string) => void = downloadFeedback,
  ) {}

  render(context?: PlaytestDebriefContext): void {
    if (!context) {
      this.root.replaceChildren();
      this.renderKey = "";
      return;
    }
    const renderKey = `${context.observationId}:${context.roundOutcome}`;
    if (renderKey === this.renderKey) return;
    this.renderKey = renderKey;
    this.root.innerHTML = `
      <section class="playtest-debrief" data-playtest-debrief aria-labelledby="playtest-debrief-title">
        <div>
          <p class="eyebrow">Optional local playtest record</p>
          <h2 id="playtest-debrief-title">Round ${context.roundOutcome === "WON" ? "won" : "lost"} debrief</h2>
          <p>Record structured feedback on this device. Nothing is sent automatically.</p>
        </div>
        <form data-feedback-form novalidate>
          ${ratingField("participationRating", "Participation")}
          ${ratingField("communicationClarity", "Communication clarity")}
          ${ratingField("frustration", "Frustration")}
          <fieldset>
            <legend>Replay intent</legend>
            <label>
              Choose one
              <select name="replayIntent" required>
                <option value="">Select</option>
                <option value="YES">Yes</option>
                <option value="MAYBE">Maybe</option>
                <option value="NO">No</option>
              </select>
            </label>
          </fieldset>
          <fieldset class="signal-fieldset">
            <legend>Misunderstood signals</legend>
            ${signalCheckboxes()}
          </fieldset>
          <div class="debrief-actions">
            <button type="submit" data-feedback-submit>Save on this device</button>
            <button type="button" class="secondary" data-feedback-export>Export JSON</button>
            <button type="button" class="secondary" data-feedback-clear>Clear local records</button>
          </div>
        </form>
        <p data-feedback-confirmation aria-live="polite"></p>
      </section>`;

    const form = this.root.querySelector<HTMLFormElement>("[data-feedback-form]")!;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submit(form, context);
    });
    this.root.querySelector<HTMLButtonElement>("[data-feedback-export]")!
      .addEventListener("click", () => {
        try {
          this.exportFeedback(this.store.exportJson());
          this.confirm("Local records exported.");
        } catch {
          this.confirm("Local records could not be exported.");
        }
      });
    this.root.querySelector<HTMLButtonElement>("[data-feedback-clear]")!
      .addEventListener("click", () => {
        try {
          this.store.clear();
          this.confirm("Local playtest records cleared.");
        } catch {
          this.confirm("Local records could not be cleared.");
        }
      });

    if (this.submittedObservationIds.has(context.observationId)) {
      this.disableSubmit();
      this.confirm("Feedback for this round was already saved locally.");
    }
  }

  private submit(form: HTMLFormElement, context: PlaytestDebriefContext): void {
    if (this.submittedObservationIds.has(context.observationId)) return;
    const data = new FormData(form);
    const participationRating = rating(data.get("participationRating"));
    const communicationClarity = rating(data.get("communicationClarity"));
    const frustration = rating(data.get("frustration"));
    const replayIntent = data.get("replayIntent");
    const misunderstoodSignals = data.getAll("misunderstoodSignals");
    if (participationRating === undefined
      || communicationClarity === undefined
      || frustration === undefined
      || !isReplayIntent(replayIntent)
      || !isSignalSelection(misunderstoodSignals)) {
      this.confirm("Complete every structured field before saving.");
      return;
    }

    try {
      this.store.append({
        schemaVersion: 1,
        role: context.role,
        roundOutcome: context.roundOutcome,
        completedSteps: context.completedSteps,
        totalSteps: context.totalSteps,
        observedDurationSeconds: context.observedDurationSeconds,
        participationRating,
        communicationClarity,
        frustration,
        replayIntent,
        misunderstoodSignals,
      });
    } catch {
      this.confirm("Structured feedback could not be saved on this device.");
      return;
    }
    this.submittedObservationIds.add(context.observationId);
    this.disableSubmit();
    this.confirm("Structured feedback saved locally.");
  }

  private disableSubmit(): void {
    this.root.querySelector<HTMLButtonElement>("[data-feedback-submit]")!.disabled = true;
  }

  private confirm(message: string): void {
    this.root.querySelector<HTMLElement>("[data-feedback-confirmation]")!.textContent = message;
  }
}

function ratingField(name: string, legend: string): string {
  return `
    <fieldset>
      <legend>${legend}</legend>
      <label>
        Rating from 1 to 5
        <select name="${name}" required>
          <option value="">Select</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
        </select>
      </label>
    </fieldset>`;
}

function signalCheckboxes(): string {
  const options: readonly [MisunderstoodSignal, string][] = [
    ["POINT", "Point"],
    ["GESTURE", "Gesture"],
    ["EMOTE", "Emote"],
    ["RECIPE_CARD", "Recipe card"],
    ["DRAWING", "Drawing"],
    ["VOICE", "Voice"],
    ["NONE", "None"],
  ];
  return options.map(([value, label]) =>
    `<label><input type="checkbox" name="misunderstoodSignals" value="${value}" /> ${label}</label>`,
  ).join("");
}

function rating(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !/^[1-5]$/.test(value)) return undefined;
  return Number(value);
}

function isReplayIntent(value: FormDataEntryValue | null): value is ReplayIntent {
  return value === "YES" || value === "MAYBE" || value === "NO";
}

function isSignalSelection(
  values: readonly FormDataEntryValue[],
): values is MisunderstoodSignal[] {
  const allowed = new Set<unknown>([
    "POINT", "GESTURE", "EMOTE", "RECIPE_CARD", "DRAWING", "VOICE", "NONE",
  ]);
  return values.length > 0
    && values.every((value) => allowed.has(value))
    && new Set(values).size === values.length
    && (!values.includes("NONE") || values.length === 1);
}

function downloadFeedback(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "cooperative-cooking-playtest-feedback.json";
  link.click();
  URL.revokeObjectURL(url);
}
