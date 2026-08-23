import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startFakeHermesServer, FAKE_API_KEY } from "../fixtures/fake-hermes-server.mjs";
import { startBffServer, normalizeRunEvent } from "../../server/bff.mjs";

async function setup(options = {}) {
  const fake = await startFakeHermesServer({ requireAuth: true, ...options });
  const directory = await mkdtemp(path.join(os.tmpdir(), "hermes-bff-"));
  const bff = await startBffServer({
    port: 0,
    configPath: path.join(directory, "config.json"),
    timeoutMs: options.timeoutMs || 500,
    env: { HERMES_API_URL: fake.baseUrl, HERMES_API_KEY: FAKE_API_KEY },
  });
  async function close() {
    await new Promise((resolve) => bff.server.close(resolve));
    await fake.close();
    await rm(directory, { recursive: true, force: true });
  }
  return { fake, bff, close, url: (p) => `http://${bff.host}:${bff.port}${p}` };
}

async function request(ctx, method, route, body) {
  const headers = {};
  if (method !== "GET") headers["x-hermes-agent-os"] = "1";
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(ctx.url(route), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { response, data, text };
}

test("health and capability contract use the official Hermes service", async (t) => {
  const ctx = await setup();
  t.after(ctx.close);
  const health = await request(ctx, "GET", "/api/os/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.data.health.service, "hermes-agent");
  const capabilities = await request(ctx, "GET", "/api/os/capabilities");
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.data.object, "hermes.api_server.capabilities");
  assert.equal(capabilities.response.headers.get("cache-control"), "no-store");
});

test("initialize reads disk config when env and options.config are absent, while preserving explicit priority", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hermes-bff-config-") );
  const configPath = path.join(directory, "config.json");
  await writeFile(configPath, JSON.stringify({ baseUrl: "http://disk.example", apiKey: "disk-test-key" }), { mode: 0o600 });
  t.after(() => rm(directory, { recursive: true, force: true }));

  const launch = async (env, config) => startBffServer({
    port: 0,
    configPath,
    env,
    config,
    fetchImpl: async () => new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  const fromDisk = await launch({}, undefined);
  const diskHealth = await fetch(`http://${fromDisk.host}:${fromDisk.port}/api/os/health`);
  assert.equal(diskHealth.status, 200);
  assert.equal(fromDisk.handler.state.config.baseUrl, "http://disk.example");
  assert.equal(fromDisk.handler.state.config.apiKey, "disk-test-key");
  await new Promise((resolve) => fromDisk.server.close(resolve));

  const fromOptions = await launch({}, { baseUrl: "http://options.example", apiKey: "options-test-key" });
  const optionsHealth = await fetch(`http://${fromOptions.host}:${fromOptions.port}/api/os/health`);
  assert.equal(optionsHealth.status, 200);
  assert.equal(fromOptions.handler.state.config.baseUrl, "http://options.example");
  assert.equal(fromOptions.handler.state.config.apiKey, "options-test-key");
  await new Promise((resolve) => fromOptions.server.close(resolve));

  const fromEnv = await launch(
    { HERMES_API_URL: "http://env.example", HERMES_API_KEY: "env-test-key" },
    { baseUrl: "http://options.example", apiKey: "options-test-key" },
  );
  const envHealth = await fetch(`http://${fromEnv.host}:${fromEnv.port}/api/os/health`);
  assert.equal(envHealth.status, 200);
  assert.equal(fromEnv.handler.state.config.baseUrl, "http://env.example");
  assert.equal(fromEnv.handler.state.config.apiKey, "env-test-key");
  await new Promise((resolve) => fromEnv.server.close(resolve));
});

test("sessions, run creation, status, events, approval and stop are proxied", async (t) => {
  const ctx = await setup();
  t.after(ctx.close);
  assert.equal((await request(ctx, "GET", "/api/os/sessions")).data.data.length, 1);
  const created = await request(ctx, "POST", "/api/os/sessions", { title: "created" });
  assert.equal(created.response.status, 201);
  const run = await request(ctx, "POST", "/api/os/sessions/session-1/chat", { input: "hello" });
  assert.equal(run.response.status, 202);
  assert.equal(run.data.run_id, "run-1");
  assert.equal(ctx.fake.calls.at(-1).path, "/v1/runs");
  assert.equal((await request(ctx, "GET", "/api/os/runs/run-1")).data.status, "running");
  const events = await request(ctx, "GET", "/api/os/runs/run-1/events");
  assert.match(events.text, /"sessionId":"session-1"/);
  assert.match(events.text, /"status":"completed"/);
  const approval = await request(ctx, "POST", "/api/os/runs/run-1/approval", { decision: "approve" });
  assert.equal(approval.response.status, 200);
  assert.equal(ctx.fake.runs.get("run-1").choice, "once");
  const stopped = await request(ctx, "POST", "/api/os/runs/run-1/stop");
  assert.equal(stopped.response.status, 200);
});

test("snapshot is official data and includes tracked run statuses without guessed routes", async (t) => {
  const ctx = await setup();
  t.after(ctx.close);
  await request(ctx, "POST", "/api/os/sessions/session-1/chat", { input: "hello" });
  const snapshot = await request(ctx, "GET", "/api/os/snapshot");
  assert.equal(snapshot.response.status, 200);
  assert.equal(snapshot.data.skills[0].name, "fixture-skill");
  assert.equal(snapshot.data.toolsets[0].name, "fixture-tools");
  assert.equal(snapshot.data.runs[0].runId, "run-1");
  assert.equal(snapshot.data.sessions[0].provenance, "hermes-api-server");
  assert.ok(!ctx.fake.calls.some((call) => call.path === "/api/status" || call.path.startsWith("/api/analytics")));
});

test("wrong service, upstream 401, and timeout are normalized", async (t) => {
  const wrong = await setup({ wrongService: true });
  t.after(async () => wrong.close());
  const blocked = await request(wrong, "GET", "/api/os/capabilities");
  assert.equal(blocked.response.status, 502);
  assert.equal(blocked.data.error.code, "BLOCKED_WRONG_SERVICE");

  const unauthorized = await setup({ apiKey: "fixture-server-key-not-used-by-bff" });
  t.after(async () => unauthorized.close());
  const denied = await request(unauthorized, "GET", "/api/os/health");
  assert.equal(denied.response.status, 401);
  assert.equal(denied.data.error.code, "HERMES_UNAUTHORIZED");

  const slow = await setup({ delayMs: 80, timeoutMs: 10 });
  t.after(async () => slow.close());
  const timedOut = await request(slow, "GET", "/api/os/health");
  assert.equal(timedOut.response.status, 504);
  assert.equal(timedOut.data.error.code, "UPSTREAM_TIMEOUT");
});

test("capability verification requires the exact official method and path", async (t) => {
  const ctx = await setup({ contractMismatch: true });
  t.after(ctx.close);
  const capabilities = await request(ctx, "GET", "/api/os/capabilities");
  assert.equal(capabilities.response.status, 502);
  assert.equal(capabilities.data.error.code, "BLOCKED_INCOMPATIBLE");
  ctx.fake.calls.length = 0;
  const mutation = await request(ctx, "POST", "/api/os/sessions", { title: "must not pass" });
  assert.equal(mutation.response.status, 502);
  assert.equal(mutation.data.error.code, "BLOCKED_INCOMPATIBLE");
  assert.deepEqual(ctx.fake.calls.map((call) => `${call.method} ${call.path}`), ["GET /v1/capabilities"]);
});

test("successful JSON and SSE payloads recursively redact configured keys and bearer tokens", async (t) => {
  const ctx = await setup({ echoSecret: true });
  t.after(ctx.close);
  const capabilities = await request(ctx, "GET", "/api/os/capabilities");
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.data.probe.configured, "[REDACTED]");
  assert.equal(capabilities.data.probe.bearer, "Bearer [REDACTED]");
  const sessions = await request(ctx, "GET", "/api/os/sessions");
  assert.equal(sessions.data.data[0].metadata.api_key, "[REDACTED]");
  assert.equal(sessions.data.data[0].metadata.token, "Bearer [REDACTED]");
  await request(ctx, "POST", "/api/os/sessions/session-1/chat", { input: "hello" });
  const events = await request(ctx, "GET", "/api/os/runs/run-1/events");
  assert.equal(events.text.includes(FAKE_API_KEY), false);
  assert.equal(events.text.includes("Bearer leaked"), false);
  assert.match(events.text, /"tool":\{"api_key":"\[REDACTED\]"/);
  assert.match(events.text, /"choices":\[\{"message":\{"content":"\[REDACTED\]"/);
});

test("missing server configuration stays explicit instead of becoming a transport error", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hermes-bff-empty-"));
  const bff = await startBffServer({
    port: 0,
    configPath: path.join(directory, "config.json"),
    env: {},
  });
  t.after(async () => {
    await new Promise((resolve) => bff.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const ctx = { url: (p) => `http://${bff.host}:${bff.port}${p}` };
  const response = await request(ctx, "GET", "/api/os/health");
  assert.equal(response.response.status, 503);
  assert.equal(response.data.error.code, "HERMES_NOT_CONFIGURED");
});

test("config persists mode 0600 and never returns the API key", async (t) => {
  const ctx = await setup();
  t.after(ctx.close);
  const configured = await request(ctx, "POST", "/api/os/config", { baseUrl: ctx.fake.baseUrl, apiKey: "secret-never-return" });
  assert.equal(configured.response.status, 200);
  assert.equal(configured.data.baseUrl, ctx.fake.baseUrl);
  assert.equal("apiKey" in configured.data, false);
  assert.equal(configured.data.apiKeyConfigured, true);
  assert.equal(configured.text.includes("secret-never-return"), false);
  const configText = await readFile(ctx.bff.handler.configPath, "utf8");
  assert.match(configText, /secret-never-return/);
  assert.equal((await stat(ctx.bff.handler.configPath)).mode & 0o777, 0o600);
});

test("BFF rejects non-loopback hosts and cross-origin or unmarked mutations", async (t) => {
  const ctx = await setup();
  t.after(ctx.close);
  const hostileHost = await new Promise((resolve, reject) => {
    const req = http.request({
      host: ctx.bff.host,
      port: ctx.bff.port,
      path: "/api/os/health",
      headers: { Host: "example.test" },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(hostileHost.status, 403);
  assert.equal(hostileHost.data.error.code, "LOOPBACK_REQUIRED");

  const unmarked = await fetch(ctx.url("/api/os/sessions"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "blocked" }),
  });
  assert.equal(unmarked.status, 403);
  assert.equal((await unmarked.json()).error.code, "SAME_ORIGIN_REQUIRED");

  const crossed = await fetch(ctx.url("/api/os/sessions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hermes-agent-os": "1",
      Origin: "http://attacker.invalid",
    },
    body: JSON.stringify({ title: "blocked" }),
  });
  assert.equal(crossed.status, 403);
  assert.equal((await crossed.json()).error.code, "SAME_ORIGIN_REQUIRED");
});

test("SSE close is reconciled through run status and fields are normalized", async (t) => {
  const ctx = await setup({ closeEvents: true, completeEvents: false });
  t.after(ctx.close);
  await request(ctx, "POST", "/api/os/sessions/session-1/chat", { input: "hello" });
  const events = await request(ctx, "GET", "/api/os/runs/run-1/events");
  assert.match(events.text, /"event":"run.reconciled"/);
  assert.match(events.text, /"status":"running"/);
  assert.deepEqual(normalizeRunEvent({ event: "approval.request", run_id: "r", session_id: "s", progress: 0.5 }), {
    event: "approval.request", runId: "r", sessionId: "s", status: "waiting_for_approval", progress: 50, timestamp: null,
  });
});
