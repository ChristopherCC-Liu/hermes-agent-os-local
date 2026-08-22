import { createShellHTML } from "./hermes/shell.js";
import { mountHermes } from "./hermes/app.js";
import "./hermes/styles.css";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Hermes Agent OS requires #root.");
}
root.innerHTML = createShellHTML();
mountHermes(root);
