import "./styles.css";
import "./platform/installWebSocketCompatibility.js";

import { RoomClient } from "./network/RoomClient.js";
import { Lobby } from "./ui/Lobby.js";
import { AuthClient } from "./auth/AuthClient.js";
import { AuthPanel } from "./ui/auth/AuthPanel.js";
import { OrientationGate } from "./ui/OrientationGate.js";
import { TouchControls } from "./input/TouchControls.js";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing application root");
}

const lobby = new Lobby(root, new RoomClient());
lobby.mount();
new OrientationGate(root).mount();
new TouchControls(document.documentElement).mount();
new AuthPanel(
  root.querySelector<HTMLElement>("[data-auth-root]")!,
  new AuthClient(),
  {
    onRestoredAccount: (account) => lobby.restoreDisplayName(account.displayName),
    onLaunchRecipe: (selection, title) => lobby.selectRecipe(selection, title),
  },
).mount();
