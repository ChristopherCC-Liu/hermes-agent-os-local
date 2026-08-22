import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const partsRoot = path.join(root, "src/hermes/parts");

async function assembleJs(name) {
  const dir = path.join(partsRoot, name);
  const files = (await readdir(dir)).filter((f) => /^\d+\.part$/.test(f)).sort();
  if (!files.length) return;
  const chunks = [];
  for (const file of files) chunks.push(await readFile(path.join(dir, file), "utf8"));
  const dest = path.join(root, "src/hermes", `${name}.js`);
  await writeFile(dest, chunks.join(""));
  console.log(`assembled ${name}.js (${files.length} parts)`);
}

async function assembleCss() {
  const dir = path.join(partsRoot, "styles");
  const files = (await readdir(dir)).filter((f) => /^\d+\.part$/.test(f)).sort();
  if (!files.length) return;
  const chunks = [];
  for (const file of files) chunks.push(await readFile(path.join(dir, file), "utf8"));
  await writeFile(path.join(root, "src/hermes/styles.css"), chunks.join(""));
  console.log(`assembled styles.css (${files.length} parts)`);
}

const entries = await readdir(partsRoot, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  if (entry.name === "styles") await assembleCss();
  else await assembleJs(entry.name);
}
