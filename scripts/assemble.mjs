import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packed = path.join(root, "src/hermes/packed");
const index = JSON.parse(await readFile(path.join(packed, "index.json"), "utf8"));

for (const [name, files] of Object.entries(index)) {
  const b64 = (await Promise.all(files.map((file) => readFile(path.join(packed, file), "utf8")))).join("");
  const bytes = gunzipSync(Buffer.from(b64.replace(/\s+/g, ""), "base64"));
  await writeFile(path.join(root, "src/hermes", name), bytes);
  console.log(`assembled ${name} (${files.length} chunks, ${bytes.length} bytes)`);
}
