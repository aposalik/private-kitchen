import "./styles.css";

import { RoomClient } from "./network/RoomClient.js";
import { Lobby } from "./ui/Lobby.js";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing application root");
}

new Lobby(root, new RoomClient()).mount();
