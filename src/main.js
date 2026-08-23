import "./hermes/store-patch.js";
import { createShellHTML } from "./hermes/shell.js";
import { mountHermes } from "./hermes/app.js";
import "./hermes/styles.css";
import "./hermes/overrides.css";

const suppliedHermesConfig = window.HERMES_CONFIG || {};
window.HERMES_CONFIG = {
  ...suppliedHermesConfig,
  mode: "runtime",
  hostUrl: suppliedHermesConfig.hostUrl || "http://127.0.0.1:9119",
};

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Hermes Agent OS requires #root.");
}
root.innerHTML = createShellHTML();
mountHermes(root);
