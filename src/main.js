import "./hermes/store-patch.js";
import { createShellHTML } from "./hermes/shell.js";
import { mountHermes } from "./hermes/app.js";
import "./hermes/styles.css";
import "./hermes/overrides.css";

window.HERMES_CONFIG = {
  mode: "live",
  baseUrl: "http://127.0.0.1:8642",
  ...(window.HERMES_CONFIG || {}),
};

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Hermes Agent OS requires #root.");
}
root.innerHTML = createShellHTML();
mountHermes(root);
