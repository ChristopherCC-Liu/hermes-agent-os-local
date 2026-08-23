const FETCH_TIMEOUT_MS = 12_000;
const MUTATION_HEADER = "X-Hermes-Agent-OS";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function errorMessage(payload, fallback) {
  const record = asRecord(payload);
  const nested = asRecord(record.error);
  return String(record.message || record.detail || nested.message || record.error || fallback);
}

async function waitForBackendConfiguration() {
  if (typeof window === "undefined") return;
  const pending = window.__HERMES_BACKEND_CONFIG_READY__;
  if (pending && typeof pending.then === "function") await pending;
}

async function osFetch(path, init = {}) {
  await waitForBackendConfiguration();
  const headers = new Headers(init.headers || {});
  headers.set("Accept", init.accept || "application/json");
  headers.set(MUTATION_HEADER, "1");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    const response = await fetch(path, {
      method: init.method || "GET",
      headers,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs || FETCH_TIMEOUT_MS),
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text.slice(0, 400) };
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: String(asRecord(data).code || asRecord(asRecord(data).error).code || "OS_REQUEST_FAILED"),
        error: errorMessage(data, `Agent OS returned ${response.status}`),
      };
    }
    return { ok: true, status: response.status, data: asRecord(data) };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      status: 0,
      code: timedOut ? "OS_TIMEOUT" : "OS_UNREACHABLE",
      error: timedOut ? "Local Agent OS timed out." : error instanceof Error ? error.message : "Local Agent OS request failed.",
    };
  }
}

async function configureBackend(data = {}) {
  const body = {
    baseUrl: String(data.baseUrl || "").trim(),
  };
  const apiKey = String(data.apiKey || "");
  if (apiKey) body.apiKey = apiKey;
  if (!body.baseUrl && !apiKey) return { ok: true, skipped: true };
  return osFetch("/api/os/config", { method: "POST", body: JSON.stringify(body) });
}

export async function probeHermes({ data } = {}) {
  const configured = await configureBackend(data);
  if (!configured.ok) return configured;
  const [health, capabilities] = await Promise.all([
    osFetch("/api/os/health"),
    osFetch("/api/os/capabilities"),
  ]);
  if (!health.ok) return health;
  if (!capabilities.ok) return capabilities;
  const healthData = health.data;
  const capabilityData = capabilities.data;
  if (healthData.ok === false || capabilityData.ok === false) {
    const blocked = healthData.ok === false ? healthData : capabilityData;
    return {
      ok: false,
      status: Number(blocked.status || 503),
      code: String(blocked.code || "BLOCKED_INCOMPATIBLE"),
      error: errorMessage(blocked, "Hermes API Server is not ready."),
    };
  }
  return {
    ok: true,
    health: healthData.health || healthData,
    capabilities: capabilityData.capabilities || capabilityData,
    endpoints: ["health", "capabilities"],
    warnings: Array.isArray(capabilityData.warnings) ? capabilityData.warnings : [],
  };
}

export async function fetchHermesSnapshot() {
  const result = await osFetch("/api/os/snapshot", { timeoutMs: 20_000 });
  if (!result.ok) return result;
  if (result.data.ok === false) {
    return {
      ok: false,
      status: Number(result.data.status || 503),
      code: String(result.data.code || "BLOCKED_INCOMPATIBLE"),
      error: errorMessage(result.data, "Hermes snapshot is unavailable."),
    };
  }
  return { ok: true, ...result.data };
}

export async function fetchHermesRun(runId) {
  if (!runId) return { ok: false, status: 400, error: "Missing run id." };
  const result = await osFetch(`/api/os/runs/${encodeURIComponent(runId)}`);
  return result.ok ? { ok: true, ...result.data } : result;
}

export async function dispatchHermesAction({ data } = {}) {
  const action = String(data?.action || "").trim();

  if (action === "create_session") {
    const result = await osFetch("/api/os/sessions", {
      method: "POST",
      body: JSON.stringify({ title: data?.title || "Agent OS task" }),
    });
    return result.ok ? { ok: true, data: result.data, via: "session.create" } : result;
  }

  if (action === "chat") {
    if (!data?.sessionId) return { ok: false, status: 400, error: "Missing session id." };
    if (!String(data?.input || "").trim()) return { ok: false, status: 400, error: "Task prompt is empty." };
    const result = await osFetch(`/api/os/sessions/${encodeURIComponent(data.sessionId)}/chat`, {
      method: "POST",
      body: JSON.stringify({ input: String(data.input) }),
    });
    return result.ok ? { ok: true, data: result.data, via: "runs" } : result;
  }

  if (action === "approve_run") {
    if (!data?.runId) return { ok: false, status: 400, error: "Missing run id." };
    const result = await osFetch(`/api/os/runs/${encodeURIComponent(data.runId)}/approval`, {
      method: "POST",
      body: JSON.stringify({ decision: data.decision || "approve", all: data.all === true }),
    });
    return result.ok ? { ok: true, data: result.data, via: "approval" } : result;
  }

  if (action === "stop_run") {
    if (!data?.runId) return { ok: false, status: 400, error: "Missing run id." };
    const result = await osFetch(`/api/os/runs/${encodeURIComponent(data.runId)}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return result.ok ? { ok: true, data: result.data, via: "stop" } : result;
  }

  return { ok: false, status: 400, error: `Unknown Hermes action: ${action}` };
}
