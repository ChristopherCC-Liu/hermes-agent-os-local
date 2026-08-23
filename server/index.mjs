#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createBffHandler } from "./bff.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const development = process.argv.includes("--dev");
const host = "127.0.0.1";
const fixedPort = process.env.PORT !== undefined;
let port = Number(process.env.PORT || 4177);
const bff = createBffHandler();
const vite = development
  ? await createViteServer({ root, server: { middlewareMode: true }, appType: "spa" })
  : null;

const MIME = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});

function staticHeaders(type) {
  return {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": type.startsWith("text/html") ? "no-cache" : "public, max-age=3600",
  };
}

async function serveProduction(req, res) {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(req.url || "/", "http://agent-os.invalid").pathname);
  } catch {
    res.writeHead(400, staticHeaders("text/plain; charset=utf-8"));
    res.end("Bad request");
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let target = path.resolve(dist, relative);
  if (!target.startsWith(`${dist}${path.sep}`) && target !== dist) {
    res.writeHead(403, staticHeaders("text/plain; charset=utf-8"));
    res.end("Forbidden");
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    target = path.join(dist, "index.html");
  }
  const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, staticHeaders(type));
  createReadStream(target).on("error", () => res.destroy()).pipe(res);
}

const server = http.createServer((req, res) => {
  Promise.resolve(bff(req, res))
    .then((handled) => {
      if (handled || res.writableEnded) return;
      if (vite) {
        vite.middlewares(req, res, () => {
          if (!res.writableEnded) {
            res.writeHead(404, staticHeaders("text/plain; charset=utf-8"));
            res.end("Not found");
          }
        });
        return;
      }
      void serveProduction(req, res);
    })
    .catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, staticHeaders("text/plain; charset=utf-8"));
        res.end("Local Agent OS server failed.");
      } else {
        res.destroy(error);
      }
    });
});

async function listen(candidate) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(candidate, host);
  });
}

while (true) {
  try {
    await listen(port);
    break;
  } catch (error) {
    if (fixedPort || error?.code !== "EADDRINUSE" || port >= 4187) throw error;
    port += 1;
  }
}

console.log(`Hermes Agent OS: http://${host}:${port}`);
console.log(`Mode: ${development ? "development" : "local production"}`);

async function reportHermesStatus() {
  try {
    const response = await fetch(`http://${host}:${port}/api/os/capabilities`, {
      headers: { "X-Hermes-Agent-OS": "1" },
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.object === "hermes.api_server.capabilities") {
      console.log("Hermes: LIVE (official API Server contract verified)");
      return;
    }
    console.log(`Hermes: ${payload.error?.code || "BLOCKED_INCOMPATIBLE"}`);
  } catch {
    console.log("Hermes: BLOCKED_UNREACHABLE");
  }
}
void reportHermesStatus();

async function close() {
  if (vite) await vite.close();
  await new Promise((resolve) => server.close(resolve));
}

process.once("SIGINT", async () => {
  await close();
  process.exit(0);
});
process.once("SIGTERM", async () => {
  await close();
  process.exit(0);
});
