import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

describe("Babylon renderer authority boundary", () => {
  test("game3d modules do not import Colyseus or own cooking/recipe outcomes", () => {
    const authoritativeOutcomeAssignment = /\b(?:privateRecipe|roundStatus|outcomeReason)\s*=(?!=)/;
    expect("snapshot.roundStatus === \"RUNNING\"").not.toMatch(authoritativeOutcomeAssignment);
    expect("this.roundStatus = \"RUNNING\"").toMatch(authoritativeOutcomeAssignment);
    const files = [
      "BabylonKitchenWorld",
      "BabylonKitchenScene",
      "CameraController",
      "SnapshotMotion",
      "Presentation",
      "BlindCookVisionEffect",
      "AssetCatalog",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../src/game3d/${file}.ts`, import.meta.url), "utf8");
      expect(source).not.toMatch(/@colyseus|colyseus\.js/i);
      expect(source).not.toMatch(authoritativeOutcomeAssignment);
    }
  });

  test("active gameplay CSS is fullscreen, scroll-free, and reduced-motion safe", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/data-round-phase="RUNNING"[\s\S]*height:\s*100dvh/);
    expect(css).toMatch(/data-round-phase="RUNNING"[\s\S]*overflow:\s*hidden/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/babylon-kitchen-canvas[\s\S]*width:\s*100%[\s\S]*height:\s*100%/);
  });

  test("ships an explicit procedural-only asset and license manifest", () => {
    const manifest = JSON.parse(readFileSync(
      new URL("../public/assets/3d/manifest.json", import.meta.url),
      "utf8",
    )) as {
      externalAssets: unknown[];
      assets: Array<{ provenance: string; license: string }>;
    };
    expect(manifest.externalAssets).toEqual([]);
    expect(manifest.assets.length).toBeGreaterThan(0);
    expect(manifest.assets.every(({ provenance, license }) =>
      provenance === "PROJECT_PROCEDURAL"
      && license === "PROJECT_OWNED")).toBe(true);
  });
});
