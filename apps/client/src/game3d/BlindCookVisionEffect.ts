import type { PlayerRole } from "@cooking-game/shared";

export const BLIND_COOK_VISION_RESTRICTION_ENABLED = true as const;

export interface BlindCookVisionEffect {
  readonly enabled: boolean;
  readonly role: PlayerRole | undefined;
  apply(): void;
  destroy(): void;
}

const OVERLAY_ID = "blind-cook-vision-overlay";

function ensureStyles(): void {
  if (document.getElementById("blind-cook-vision-styles")) return;
  const s = document.createElement("style");
  s.id = "blind-cook-vision-styles";
  s.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 500;
      background: radial-gradient(
        ellipse 38% 32% at 50% 48%,
        transparent 0%,
        rgba(0,0,0,0.55) 55%,
        rgba(0,0,0,0.82) 75%,
        rgba(0,0,0,0.96) 100%
      );
      backdrop-filter: blur(3px) saturate(0.4);
      -webkit-backdrop-filter: blur(3px) saturate(0.4);
      animation: blind-cook-flicker 6s ease-in-out infinite;
    }
    @keyframes blind-cook-flicker {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.88; }
    }
    @media (prefers-reduced-motion: reduce) {
      #${OVERLAY_ID} { animation: none; }
    }
  `;
  document.head.appendChild(s);
}

export function createBlindCookVisionEffect(
  role: PlayerRole | undefined,
): BlindCookVisionEffect {
  const active = BLIND_COOK_VISION_RESTRICTION_ENABLED && role === "BLIND_COOK";

  return {
    enabled: active,
    role,
    apply(): void {
      if (!active) return;
      if (document.getElementById(OVERLAY_ID)) return;
      ensureStyles();
      const overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.setAttribute("aria-hidden", "true");
      document.body.appendChild(overlay);
    },
    destroy(): void {
      document.getElementById(OVERLAY_ID)?.remove();
    },
  };
}
