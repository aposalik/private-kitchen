import "./styles.css";

import { RoomClient } from "./network/RoomClient.js";
import { Lobby } from "./ui/Lobby.js";
import { AuthClient } from "./auth/AuthClient.js";
import { AuthPanel } from "./ui/auth/AuthPanel.js";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing application root");
}

const lobby = new Lobby(root, new RoomClient());
lobby.mount();
new AuthPanel(
  root.querySelector<HTMLElement>("[data-auth-root]")!,
  new AuthClient(),
  { onRestoredAccount: (account) => lobby.restoreDisplayName(account.displayName) },
).mount();
