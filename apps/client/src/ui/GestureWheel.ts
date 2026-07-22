import { EMOTES, GESTURES, type Emote, type Gesture } from "@cooking-game/shared";

export class GestureWheel {
  constructor(
    private readonly sendGesture: (gesture: Gesture) => void,
    private readonly sendEmote: (emote: Emote) => void,
  ) {}

  element(): HTMLElement {
    const section = document.createElement("section");
    section.className = "gesture-wheel";
    section.setAttribute("aria-label", "Gestures and emotes");
    section.append(this.group("Gesture", GESTURES, "gesture", this.sendGesture), this.group("Emote", EMOTES, "emote", this.sendEmote));
    return section;
  }

  private group<T extends string>(label: string, values: readonly T[], dataName: string, send: (value: T) => void): HTMLElement {
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `${label}s`);
    for (const value of values) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset[dataName] = value;
      button.textContent = formatEnum(value);
      button.addEventListener("click", () => send(value));
      group.append(button);
    }
    return group;
  }
}

export function formatEnum(value: string): string {
  const words = value.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
