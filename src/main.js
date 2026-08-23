import "./hermes/store-patch.js";
import { createShellHTML } from "./hermes/shell.js";
import { mountHermes } from "./hermes/app.js";
import { mountRuntimeBridge } from "./hermes/runtime-bridge.js";
import "./hermes/styles.css";
import "./hermes/overrides.css";

window.HERMES_CONFIG = { ...(window.HERMES_CONFIG || {}) };

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Hermes Agent OS requires #root.");
}
root.innerHTML = createShellHTML();
mountHermes(root);
mountRuntimeBridge(root);
