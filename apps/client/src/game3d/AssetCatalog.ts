export interface ProceduralAssetRecord {
  readonly id: string;
  readonly kind: "GEOMETRY" | "MATERIAL" | "UI";
  readonly provenance: "PROJECT_PROCEDURAL";
  readonly license: "PROJECT_OWNED";
  readonly source: string;
}

export const PROCEDURAL_ASSET_MANIFEST: readonly ProceduralAssetRecord[] = [
  {
    id: "toy-kitchen-shell-and-six-stations",
    kind: "GEOMETRY",
    provenance: "PROJECT_PROCEDURAL",
    license: "PROJECT_OWNED",
    source: "BabylonKitchenScene.ts primitive mesh builders",
  },
  {
    id: "three-monkey-role-presenters",
    kind: "GEOMETRY",
    provenance: "PROJECT_PROCEDURAL",
    license: "PROJECT_OWNED",
    source: "BabylonKitchenScene.ts articulated primitive presenters",
  },
  {
    id: "warm-toy-pbr-palette",
    kind: "MATERIAL",
    provenance: "PROJECT_PROCEDURAL",
    license: "PROJECT_OWNED",
    source: "BabylonKitchenScene.ts project-owned color constants",
  },
  {
    id: "minimal-edge-hud-glyphs",
    kind: "UI",
    provenance: "PROJECT_PROCEDURAL",
    license: "PROJECT_OWNED",
    source: "semantic HTML and CSS text glyphs",
  },
] as const;
