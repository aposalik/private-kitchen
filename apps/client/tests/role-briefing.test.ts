// @vitest-environment jsdom
import { describe, expect, test } from "vitest";

import {
  renderRoleBriefing,
  type RoleBriefingPhase,
} from "../src/ui/RoleBriefing.js";
import type { PlayerRole } from "@cooking-game/shared";

const ROLES: readonly PlayerRole[] = [
  "BLIND_COOK",
  "RECIPE_KEEPER",
  "DEAF_KITCHEN_GUIDE",
];
const PHASES: readonly RoleBriefingPhase[] = [
  "WAITING",
  "RUNNING",
  "PAUSED",
  "WON",
  "LOST",
];

describe("RoleBriefing", () => {
  test.each(ROLES.flatMap((role) => PHASES.map((phase) => [role, phase] as const)))(
    "renders an accessible, concise %s briefing during %s",
    (role, phase) => {
      const root = document.createElement("section");

      renderRoleBriefing(root, { role, phase });

      const briefing = root.querySelector<HTMLElement>("[data-role-briefing]");
      expect(briefing).not.toBeNull();
      expect(briefing!.dataset.playerRole).toBe(role);
      expect(briefing!.dataset.briefingPhase).toBe(phase);
      const titleId = briefing!.getAttribute("aria-labelledby");
      expect(titleId).toBeTruthy();
      expect(briefing!.querySelector(`#${titleId}`)?.textContent).toBe(
        role === "BLIND_COOK"
          ? "Blind Cook"
          : role === "RECIPE_KEEPER"
            ? "Recipe Keeper"
            : "Deaf Kitchen Guide",
      );
      const objective = briefing!.querySelector("[data-role-objective]");
      expect(objective?.textContent?.trim().length).toBeGreaterThan(0);
      expect(objective?.textContent?.length).toBeLessThanOrEqual(120);
      expect(briefing!.querySelector("[data-communication-allowed]")?.textContent).toMatch(
        /^Allowed:/,
      );
      expect(briefing!.querySelector("[data-communication-blocked]")?.textContent).toMatch(
        /^Blocked:/,
      );
    },
  );

  test.each(["BLIND_COOK", "DEAF_KITCHEN_GUIDE"] as const)(
    "%s briefing contains no Recipe Keeper-only recipe content",
    (role) => {
      const root = document.createElement("section");

      renderRoleBriefing(root, { role, phase: "RUNNING" });

      expect(root.textContent).not.toMatch(/Tomato Soup|ingredient count|recipe steps/i);
      expect(root.querySelector("[data-private-recipe]")).toBeNull();
    },
  );

  test("keeps Deaf Kitchen Guide copy neutral about voice transport", () => {
    const root = document.createElement("section");

    renderRoleBriefing(root, { role: "DEAF_KITCHEN_GUIDE", phase: "RUNNING" });

    expect(root.textContent).not.toMatch(/microphone|voice/i);
    expect(root.textContent).toContain("visual signals");
  });

  test("centralizes phase objectives while keeping role operation distinct", () => {
    const root = document.createElement("section");
    const objectives = new Set<string>();

    for (const phase of PHASES) {
      renderRoleBriefing(root, { role: "BLIND_COOK", phase });
      objectives.add(root.querySelector("[data-role-objective]")!.textContent!);
    }

    expect(objectives.size).toBe(PHASES.length);
  });
});
