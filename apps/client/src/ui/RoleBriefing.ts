import { ROLE_LABELS, type PlayerRole } from "@cooking-game/shared";

export type RoleBriefingPhase = "WAITING" | "RUNNING" | "PAUSED" | "WON" | "LOST";

interface RoleBriefingOptions {
  readonly role: PlayerRole;
  readonly phase: RoleBriefingPhase;
}

interface RoleBriefingMetadata {
  readonly operation: string;
  readonly allowed: string;
  readonly blocked: string;
}

const ROLE_BRIEFINGS: Readonly<Record<PlayerRole, RoleBriefingMetadata>> = Object.freeze({
  BLIND_COOK: Object.freeze({
    operation: "Handle ingredients and operate the cooking stations.",
    allowed: "Allowed: kitchen actions, points, gestures, emotes, microphone, and voice output.",
    blocked: "Blocked: recipe cards, drawings, and the private recipe.",
  }),
  RECIPE_KEEPER: Object.freeze({
    operation: "Read the private recipe and relay each needed step.",
    allowed: "Allowed: recipe cards, drawings, points, gestures, emotes, and voice output.",
    blocked: "Blocked: microphone and ingredient manipulation.",
  }),
  DEAF_KITCHEN_GUIDE: Object.freeze({
    operation: "Interpret visual signals and guide the cook.",
    allowed: "Allowed: use the visual communication controls shown below.",
    blocked: "Blocked: recipe cards, drawings, and ingredient manipulation.",
  }),
});

const PHASE_OBJECTIVES: Readonly<Record<RoleBriefingPhase, string>> = Object.freeze({
  WAITING: "Get ready while all three roles join.",
  RUNNING: "Complete the authoritative recipe before time expires.",
  PAUSED: "Waiting for all players to reconnect.",
  WON: "Review the completed round.",
  LOST: "Review the ended round.",
});

export function renderRoleBriefing(
  root: HTMLElement,
  { role, phase }: RoleBriefingOptions,
): void {
  const metadata = ROLE_BRIEFINGS[role];
  const titleId = "role-briefing-title";
  root.innerHTML = `
    <section
      class="role-briefing"
      data-role-briefing
      data-player-role="${role}"
      data-briefing-phase="${phase}"
      aria-labelledby="${titleId}"
    >
      <p class="eyebrow">Your role</p>
      <h2 id="${titleId}">${ROLE_LABELS[role]}</h2>
      <p data-role-objective>${PHASE_OBJECTIVES[phase]} ${metadata.operation}</p>
      <div class="role-communication-guidance" aria-label="Communication guidance">
        <p data-communication-allowed>${metadata.allowed}</p>
        <p data-communication-blocked>${metadata.blocked}</p>
      </div>
    </section>`;
}
