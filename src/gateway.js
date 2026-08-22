const FETCH_TIMEOUT_MS = 10_000;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["sessions", "items", "data", "jobs", "skills", "toolsets", "results", "platforms"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function resolveOrigin(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return "/hermes-proxy";
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return trimmed;
  }
}

async function hermesFetch(creds, path, init = {}) {
  const origin = resolveOrigin(creds.baseUrl);
  if (!origin) {
    return { ok: false, status: 400, error: "Enter a Hermes base URL.", path };
  }
  const target = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (creds.apiKey) headers.set("Authorization", `Bearer ${creds.apiKey}`);

  try {
    const response = await fetch(target, {
      method: init.method || "GET",
      headers,
      body: init.body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await response.text();
    let data = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text.slice(0, 400) };
      }
    }
    if (!response.ok) {
      const record = asRecord(data);
      return {
        ok: false,
        status: response.status,
        error: String(record.error || record.message || record.detail || `Hermes returned ${response.status}`),
        path,
      };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "Hermes timed out."
        : error instanceof Error
          ? error.message
          : "Hermes request failed.";
    return { ok: false, status: 0, error: message, path };
  }
}

async function firstOk(creds, paths) {
  const errors = [];
  for (const path of paths) {
    const result = await hermesFetch(creds, path);
    if (result.ok) return { result, errors };
    errors.push({ path: result.path, status: result.status, error: result.error });
  }
  return { result: null, errors };
}

export async function probeHermes({ data } = {}) {
  const creds = { baseUrl: String(data?.baseUrl || ""), apiKey: String(data?.apiKey || "") };
  const health = await firstOk(creds, ["/health", "/v1/health", "/api/status"]);
  if (!health.result) {
    const last = health.errors[health.errors.length - 1];
    return {
      ok: false,
      status: last?.status,
      error:
        last?.error ||
        "Could not reach Hermes. On this computer, start the Hermes API server and use http://127.0.0.1:8642.",
    };
  }
  const capabilities = await firstOk(creds, ["/v1/capabilities"]);
  const status = await firstOk(creds, ["/api/status", "/health/detailed"]);
  const endpoints = [
    health.result ? "health" : "",
    capabilities.result ? "capabilities" : "",
    status.result ? "status" : "",
  ].filter(Boolean);
  const warnings = [];
  if (!creds.apiKey) warnings.push("No API key sent. Private Hermes routes will 401 until you add API_SERVER_KEY.");
  if (!capabilities.result) warnings.push("Capabilities endpoint was not available. Session control may be limited.");
  return {
    ok: true,
    health: health.result.data,
    capabilities: capabilities.result?.data ?? null,
    status: status.result?.data ?? null,
    endpoints,
    warnings,
  };
}

export async function fetchHermesSnapshot({ data } = {}) {
  const creds = { baseUrl: String(data?.baseUrl || ""), apiKey: String(data?.apiKey || "") };
  const [health, capabilities, status, sessions, skills, toolsets, jobs, usage] = await Promise.all([
    firstOk(creds, ["/health/detailed", "/health", "/v1/health"]),
    firstOk(creds, ["/v1/capabilities"]),
    firstOk(creds, ["/api/status"]),
    firstOk(creds, ["/api/sessions?limit=80&include_children=true", "/api/sessions?limit=80", "/api/sessions"]),
    firstOk(creds, ["/v1/skills", "/api/skills"]),
    firstOk(creds, ["/v1/toolsets", "/api/tools/toolsets"]),
    firstOk(creds, ["/api/jobs", "/api/cron/jobs"]),
    firstOk(creds, ["/api/analytics/usage?days=7", "/api/analytics/usage"]),
  ]);

  if (!health.result && !status.result && !sessions.result) {
    const last =
      sessions.errors[sessions.errors.length - 1] ||
      health.errors[health.errors.length - 1] ||
      status.errors[status.errors.length - 1];
    return {
      ok: false,
      error: last?.error || "Hermes did not return a snapshot.",
      status: last?.status ?? 0,
    };
  }

  return {
    ok: true,
    fetchedAt: Date.now(),
    health: health.result?.data ?? null,
    capabilities: capabilities.result?.data ?? null,
    status: status.result?.data ?? null,
    sessions: asList(sessions.result?.data ?? null),
    skills: asList(skills.result?.data ?? null),
    toolsets: asList(toolsets.result?.data ?? null),
    jobs: asList(jobs.result?.data ?? null),
    usage: usage.result?.data ?? null,
    errors: [...sessions.errors, ...skills.errors, ...toolsets.errors, ...jobs.errors, ...usage.errors].filter(
      (item) => item.status !== 404,
    ),
  };
}

export async function dispatchHermesAction({ data } = {}) {
  const creds = { baseUrl: String(data?.baseUrl || ""), apiKey: String(data?.apiKey || "") };
  const action = String(data?.action || "").trim();

  if (action === "create_session") {
    const result = await hermesFetch(creds, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title: data.title || "Agent OS task" }),
    });
    if (!result.ok) return { ok: false, error: result.error, status: result.status };
    return { ok: true, data: result.data, via: "session.create" };
  }

  if (action === "chat") {
    if (!data.sessionId) return { ok: false, error: "Missing session id.", status: 400 };
    if (!data.input) return { ok: false, error: "Task prompt is empty.", status: 400 };
    const chat = await hermesFetch(creds, `/api/sessions/${encodeURIComponent(data.sessionId)}/chat`, {
      method: "POST",
      body: JSON.stringify({ input: data.input }),
    });
    if (chat.ok) return { ok: true, data: chat.data, via: "session.chat" };
    const run = await hermesFetch(creds, "/v1/runs", {
      method: "POST",
      body: JSON.stringify({ input: data.input, session_id: data.sessionId }),
    });
    if (run.ok) return { ok: true, data: run.data, via: "runs" };
    return { ok: false, error: chat.error, status: chat.status };
  }

  if (action === "approve_run") {
    if (!data.runId) return { ok: false, error: "Missing run id.", status: 400 };
    const result = await hermesFetch(creds, `/v1/runs/${encodeURIComponent(data.runId)}/approval`, {
      method: "POST",
      body: JSON.stringify({ decision: data.decision || "approve" }),
    });
    if (!result.ok) return { ok: false, error: result.error, status: result.status };
    return { ok: true, data: result.data, via: "approval" };
  }

  if (action === "stop_run") {
    if (!data.runId) return { ok: false, error: "Missing run id.", status: 400 };
    const result = await hermesFetch(creds, `/v1/runs/${encodeURIComponent(data.runId)}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!result.ok) return { ok: false, error: result.error, status: result.status };
    return { ok: true, data: result.data, via: "stop" };
  }

  return { ok: false, error: `Unknown Hermes action: ${action}`, status: 400 };
}
