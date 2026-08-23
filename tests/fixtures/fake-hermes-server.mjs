import http from "node:http";
import { fileURLToPath } from "node:url";

export const FAKE_API_KEY = "fixture-hermes-key";
export const CAPABILITIES = {
  object: "hermes.api_server.capabilities",
  platform: "hermes-agent",
  auth: { type: "bearer", required: true },
  features: { run_submission: true, run_status: true, run_events_sse: true, run_approval_response: true, run_stop: true },
  endpoints: {
    health: { method: "GET", path: "/health" },
    sessions: { method: "GET", path: "/api/sessions" },
    session_create: { method: "POST", path: "/api/sessions" },
    skills: { method: "GET", path: "/v1/skills" },
    toolsets: { method: "GET", path: "/v1/toolsets" },
    runs: { method: "POST", path: "/v1/runs" },
    run_status: { method: "GET", path: "/v1/runs/{run_id}" },
    run_events: { method: "GET", path: "/v1/runs/{run_id}/events" },
    run_approval: { method: "POST", path: "/v1/runs/{run_id}/approval" },
    run_stop: { method: "POST", path: "/v1/runs/{run_id}/stop" },
  },
};

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export async function startFakeHermesServer(options = {}) {
  const key = options.apiKey ?? FAKE_API_KEY;
  const runs = new Map();
  const calls = [];
  const sessions = [...(options.sessions || [{
    id: "session-1",
    source: "api_server",
    title: "Fixture session",
    preview: "Inspect the real Hermes contract",
    started_at: Date.now() / 1000,
    last_active: Date.now() / 1000,
    message_count: 2,
    tool_call_count: 1,
  }])];
  let nextRun = 1;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake-hermes.invalid");
    calls.push({ method: req.method, path: url.pathname, headers: req.headers });
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (options.requireAuth && req.headers.authorization !== `Bearer ${key}`) {
      json(res, 401, { error: { code: "unauthorized", message: "invalid bearer" } });
      return;
    }
    if (options.wrongService && url.pathname === "/v1/capabilities") {
      json(res, 200, { object: "not.hermes.capabilities", platform: "other-service" });
      return;
    }
    if (url.pathname === "/health" && req.method === "GET") {
      json(res, 200, { status: "ok", service: "hermes-agent", version: "fixture" });
      return;
    }
    if (url.pathname === "/v1/capabilities" && req.method === "GET") {
      const capabilities = JSON.parse(JSON.stringify(CAPABILITIES));
      if (options.contractMismatch) capabilities.endpoints.run_stop = { method: "GET", path: "/v1/runs/{run_id}/stop" };
      if (options.echoSecret) capabilities.probe = { configured: key, bearer: "Bearer leaked-capability-token" };
      json(res, 200, capabilities);
      return;
    }
    if (url.pathname === "/v1/skills" && req.method === "GET") {
      json(res, 200, { object: "list", data: [{ name: "fixture-skill", description: "Fixture skill" }] });
      return;
    }
    if (url.pathname === "/v1/toolsets" && req.method === "GET") {
      json(res, 200, { object: "list", data: [{ name: "fixture-tools", tools: ["fixture_tool"] }] });
      return;
    }
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      const responseSessions = options.echoSecret
        ? sessions.map((session) => ({ ...session, metadata: { api_key: key, token: "Bearer leaked-session-token" } }))
        : sessions;
      json(res, 200, { object: "list", data: responseSessions });
      return;
    }
    if (url.pathname === "/api/sessions" && req.method === "POST") {
      const input = await body(req);
      const session = {
        id: input.id || `session-created-${sessions.length}`,
        source: "api_server",
        title: input.title || null,
        preview: input.title || "New Agent OS session",
        started_at: Date.now() / 1000,
        last_active: Date.now() / 1000,
        message_count: 0,
        tool_call_count: 0,
      };
      sessions.push(session);
      json(res, 201, { object: "hermes.session", session });
      return;
    }
    const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)(?:\/(events|approval|stop))?$/);
    if (url.pathname === "/v1/runs" && req.method === "POST") {
      const input = await body(req);
      const runId = `run-${nextRun++}`;
      runs.set(runId, { run_id: runId, session_id: input.session_id, input: input.input, status: "running", progress: 10 });
      json(res, 202, { run_id: runId, status: "started" });
      return;
    }
    if (runMatch) {
      const runId = decodeURIComponent(runMatch[1]);
      const action = runMatch[2];
      const run = runs.get(runId);
      if (!run) { json(res, 404, { error: { code: "run_not_found", message: "missing run" } }); return; }
      if (!action && req.method === "GET") { json(res, 200, run); return; }
      if (action === "approval" && req.method === "POST") {
        const input = await body(req);
        run.status = "running";
        run.approved = true;
        run.choice = input.choice;
        json(res, 200, { object: "hermes.run.approval_response", run_id: runId, choice: input.choice, resolved: 1 });
        return;
      }
      if (action === "stop" && req.method === "POST") {
        run.status = "stopped";
        json(res, 200, { run_id: runId, status: "stopping" });
        return;
      }
      if (action === "events" && req.method === "GET") {
        if (options.closeEvents) { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.end(); return; }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        const started = { event: "run.started", run_id: runId, session_id: run.session_id, status: "running", progress: 10 };
        if (options.echoSecret) started.tool = { api_key: key, authorization: "Bearer leaked-event-token" };
        res.write(`data: ${JSON.stringify(started)}\n\n`);
        if (/approval/i.test(String(run.input || "")) && !run.approved) {
          run.status = "waiting_for_approval";
          run.progress = 68;
          const approval = { event: "approval.request", run_id: runId, session_id: run.session_id, status: run.status, progress: 68, choices: ["once", "deny"] };
          if (options.echoSecret) approval.choices.push(key, "Bearer leaked-approval-token");
          res.write(`data: ${JSON.stringify(approval)}\n\n`);
        } else if (!/stop/i.test(String(run.input || "")) && options.completeEvents !== false) {
          run.status = "completed";
          run.progress = 100;
          const completed = { event: "run.completed", run_id: runId, session_id: run.session_id, status: "completed", progress: 100 };
          if (options.echoSecret) completed.choices = [{ message: { content: key }, token: "Bearer leaked-completed-token" }];
          res.write(`data: ${JSON.stringify(completed)}\n\n`);
        }
        res.end();
        return;
      }
    }
    json(res, 404, { error: { code: "not_found", message: "fixture route not found" } });
  });
  const host = options.host || "127.0.0.1";
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port || 0, host, resolve);
  });
  return {
    server,
    baseUrl: `http://${host}:${server.address().port}`,
    calls,
    runs,
    sessions,
    async close() { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.FAKE_HERMES_PORT || 18642);
  const now = Date.now() / 1000;
  const fixture = await startFakeHermesServer({
    port,
    requireAuth: true,
    sessions: [
      { id: "session-1", source: "api_server", title: "Fixture session", preview: "Inspect the real Hermes contract", started_at: now - 120, last_active: now - 10, message_count: 2, tool_call_count: 1 },
      { id: "session-2", source: "api_server", title: "Persistent selection", preview: "Remain selected through reconciliation", started_at: now - 240, last_active: now - 20, message_count: 3, tool_call_count: 2 },
    ],
  });
  console.log(`Fake Hermes API Server: ${fixture.baseUrl}`);
}
