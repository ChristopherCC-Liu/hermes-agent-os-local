import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packedDir = path.join(root, "src/hermes/packed");
const destDir = path.join(root, "src/hermes");
const index = JSON.parse(await readFile(path.join(packedDir, "index.json"), "utf8"));

for (const [name, files] of Object.entries(index.files)) {
  const b64 = (
    await Promise.all(files.map((file) => readFile(path.join(packedDir, file), "utf8")))
  )
    .join("")
    .replace(/\s+/g, "");
  const bytes = gunzipSync(Buffer.from(b64, "base64"));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expected = index.sha256?.[name];
  if (expected && digest !== expected) {
    console.warn(`checksum warning for ${name}: got ${digest}, expected ${expected}`);
  }
  await writeFile(path.join(destDir, name), bytes);
  console.log(`assembled ${name} (${files.length} chunks, ${bytes.length} bytes)`);
}
