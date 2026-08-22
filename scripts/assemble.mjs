import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packed = path.join(root, "src/hermes/packed");
const index = JSON.parse(await readFile(path.join(packed, "index.json"), "utf8"));

// Unique-window repairs for GitHub MCP transcription drift.
const CHUNK_FIXES = {
  "styles.02.b64": [
    ["Fu7dqaw5AMQ9gY0GW7", "Fu7dqaw1AMQ9gY0GW7"],
    ["Kprbj5xmlZBWnbrEc", "Kprbj7xmlZBWnbrEc"],
    ["GLrSBuWPlfz0/sBz4", "GLrSRuWPlfz0/sBz4"],
    ["SXwIHYofSMmsAzmMn", "SXwIHZofSMmsAzmMn"],
  ],
};

function applyFixes(name, text) {
  const pairs = CHUNK_FIXES[name];
  if (!pairs) return text;
  let out = text;
  for (const [from, to] of pairs) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

for (const [name, files] of Object.entries(index)) {
  const b64 = (
    await Promise.all(
      files.map(async (file) => applyFixes(file, await readFile(path.join(packed, file), "utf8"))),
    )
  ).join("");
  const bytes = gunzipSync(Buffer.from(b64.replace(/\s+/g, ""), "base64"));
  await writeFile(path.join(root, "src/hermes", name), bytes);
  console.log(`assembled ${name} (${files.length} chunks, ${bytes.length} bytes)`);
}
