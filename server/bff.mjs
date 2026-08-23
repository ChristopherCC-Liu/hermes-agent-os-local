import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdir, open, readFile, rename, chmod } from "node:fs/promises";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CAPABILITIES_OBJECT = "hermes.api_server.capabilities";
const REQUIRED_CAPABILITY_ENDPOINTS = Object.freeze([
  "health",
  "sessions",
  "session_create",
  "runs",
  "run_status",
  "run_events",
  "run_approval",
  "run_stop",
  "skills",
  "toolsets",
]);
const CAPABILITY_ENDPOINT_MAP = Object.freeze({
  health: "health",
  sessions: "sessions",
  session_create: "createSession",
  runs: "runs",
  run_status: "runStatus",
  run_events: "runEvents",
  run_approval: "runApproval",
  run_stop: "runStop",
  skills: "skills",
  toolsets: "toolsets",
});
const SAFE_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

// This is intentionally the complete upstream surface used by the OS. Keep
// this list explicit: a local dashboard must not become a generic proxy.
export const HERMES_ENDPOINTS = Object.freeze({
  health: ["GET", "/health"],
  capabilities: ["GET", "/v1/capabilities"],
  sessions: ["GET", "/api/sessions"],
  createSession: ["POST", "/api/sessions"],
  skills: ["GET", "/v1/skills"],
  toolsets: ["GET", "/v1/toolsets"],
  runs: ["POST", "/v1/runs"],
  runStatus: ["GET", "/v1/runs/{run_id}"],
  runEvents: ["GET", "/v1/runs/{run_id}/events"],
  runApproval: ["POST", "/v1/runs/{run_id}/approval"],
  runStop: ["POST", "/v1/runs/{run_id}/stop"],
});

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "stopped"]);
const STATUS_ALIASES = new Map([
  ["succeeded", "completed"],
  ["success", "completed"],
  ["done", "completed"],
  ["error", "failed"],
  ["errored", "failed"],
  ["aborted", "cancelled"],
  ["canceled", "cancelled"],
  ["waiting", "waiting_for_approval"],
  ["approval", "waiting_for_approval"],
  ["awaiting_approval", "waiting_for_approval"],
]);

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonText(value) {
  return JSON.stringify(value, (_key, item) => (item === undefined ? null : item));
}

function redactText(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (secret) text = text.split(String(secret)).join("[REDACTED]");
  }
  return text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
}

function redactValue(value, secrets = []) {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets)]));
  }
  return value;
}

function errorPayload(code, message, extra = {}) {
  return { error: { code, message, ...extra } };
}

function sendJson(res, status, body, headers = {}, secrets = []) {
  if (res.headersSent) return;
  const payload = jsonText(redactValue(body, secrets));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...SAFE_RESPONSE_HEADERS,
    ...headers,
  });
  res.end(payload);
}

function normalizeBaseUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("baseUrl must be an absolute http(s) URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("baseUrl must use http or https");
  }
  if (url.username || url.password) throw new Error("baseUrl must not contain credentials");
  return url.toString().replace(/\/+$/, "");
}

function defaultConfigPath(env = process.env) {
  if (env.HERMES_AGENT_OS_CONFIG_PATH) return env.HERMES_AGENT_OS_CONFIG_PATH;
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "hermes-agent-os", "config.json");
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "hermes-agent-os", "config.json");
}

async function readStoredConfig(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return {
      baseUrl: normalizeBaseUrl(parsed.baseUrl || ""),
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { baseUrl: "", apiKey: "" };
    return { baseUrl: "", apiKey: "" };
  }
}

async function persistConfig(filePath, config) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${jsonText({ baseUrl: config.baseUrl, apiKey: config.apiKey })}\n`, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
  await chmod(filePath, 0o600);
}

function envConfig(env) {
  return {
    baseUrl: env.HERMES_API_URL || env.HERMES_URL || "",
    apiKey: env.HERMES_API_KEY || env.API_SERVER_KEY || "",
  };
}

function publicConfig(config) {
  return {
    configured: Boolean(config.baseUrl),
    baseUrl: config.baseUrl,
    apiKeyConfigured: Boolean(config.apiKey),
  };
}

function listData(payload) {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  for (const key of ["data", "items", "sessions", "skills", "toolsets", "results"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

function isoTimestamp(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSession(value) {
  const session = asRecord(value);
  const startedAt = isoTimestamp(session.started_at || session.created_at);
  const updatedAt = isoTimestamp(session.last_active || session.updated_at || session.started_at || session.created_at);
  const endedAt = isoTimestamp(session.ended_at);
  return {
    ...session,
    ...(startedAt ? { started_at: startedAt } : {}),
    ...(updatedAt ? { updated_at: updatedAt } : {}),
    ...(endedAt ? { ended_at: endedAt } : {}),
    message_count: Number.isFinite(Number(session.message_count)) ? Number(session.message_count) : 0,
    tool_call_count: Number.isFinite(Number(session.tool_call_count)) ? Number(session.tool_call_count) : 0,
    provenance: "hermes-api-server",
  };
}

function cleanStatus(value) {
  const normalized = String(value ?? "unknown").trim().toLowerCase().replace(/[ -]+/g, "_");
  return STATUS_ALIASES.get(normalized) || normalized || "unknown";
}

function statusForEvent(eventName, fallback) {
  if (fallback) return cleanStatus(fallback);
  const eventStatuses = {
    "run.started": "running",
    "run.running": "running",
    "run.completed": "completed",
    "run.failed": "failed",
    "run.cancelled": "cancelled",
    "run.canceled": "cancelled",
    "run.stopping": "stopping",
    "approval.request": "waiting_for_approval",
    "approval.requested": "waiting_for_approval",
    "approval.responded": "running",
  };
  return cleanStatus(eventStatuses[eventName] || eventName.replace(/^run\./, ""));
}

function progressValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number <= 1 && number >= 0 ? number * 100 : number));
}

/** Normalize either a Hermes run status object or one lifecycle event. */
export function normalizeRunEvent(value, fallback = {}) {
  const source = asRecord(value);
  const eventName = String(source.event || source.type || source.name || fallback.event || "run.status");
  const status = statusForEvent(eventName, source.status || source.state || fallback.status);
  const sessionId = source.sessionId ?? source.session_id ?? source.session ?? fallback.sessionId ?? null;
  const runId = source.runId ?? source.run_id ?? fallback.runId ?? null;
  const progress = progressValue(
    source.progress ?? source.progress_percent ?? source.percent ?? source.completion ?? fallback.progress,
  );
  const normalized = {
    event: eventName,
    runId,
    sessionId,
    status,
    progress,
    timestamp: source.timestamp ?? source.created_at ?? source.updated_at ?? fallback.timestamp ?? null,
  };
  for (const key of ["error", "output", "choice", "resolved", "usage", "tool", "preview", "choices", "delta", "text"]) {
    if (source[key] !== undefined) normalized[key] = source[key];
  }
  return normalized;
}

export function normalizeRunStatus(value, fallback = {}) {
  return normalizeRunEvent({ ...asRecord(value), event: "run.status" }, fallback);
}

export async function reconcileRun(fetchStatus, runId, fallback = {}) {
  try {
    const result = await fetchStatus(runId);
    if (result?.ok) return normalizeRunStatus(result.data, { ...fallback, runId });
  } catch {
    // The stream's last lifecycle frame remains the best available evidence.
  }
  return normalizeRunEvent(fallback, { ...fallback, runId });
}

function approvalChoice(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const aliases = { approve: "once", approved: "once", allow: "once", reject: "deny", decline: "deny" };
  const choice = aliases[raw] || raw;
  return ["once", "session", "always", "deny"].includes(choice) ? choice : null;
}

function routeMatch(method, pathname) {
  if (method === "GET" && pathname === "/api/os/health") return { kind: "health" };
  if (method === "GET" && pathname === "/api/os/capabilities") return { kind: "capabilities" };
  if (method === "GET" && pathname === "/api/os/snapshot") return { kind: "snapshot" };
  if (method === "POST" && pathname === "/api/os/config") return { kind: "config" };
  if (method === "GET" && pathname === "/api/os/sessions") return { kind: "sessions" };
  if (method === "POST" && pathname === "/api/os/sessions") return { kind: "createSession" };
  let match = pathname.match(/^\/api\/os\/sessions\/([^/]+)\/chat$/);
  if (method === "POST" && match) return { kind: "chat", id: decodeURIComponent(match[1]) };
  match = pathname.match(/^\/api\/os\/runs\/([^/]+)\/events$/);
  if (method === "GET" && match) return { kind: "events", id: decodeURIComponent(match[1]) };
  match = pathname.match(/^\/api\/os\/runs\/([^/]+)\/approval$/);
  if (method === "POST" && match) return { kind: "approval", id: decodeURIComponent(match[1]) };
  match = pathname.match(/^\/api\/os\/runs\/([^/]+)\/stop$/);
  if (method === "POST" && match) return { kind: "stop", id: decodeURIComponent(match[1]) };
  match = pathname.match(/^\/api\/os\/runs\/([^/]+)$/);
  if (method === "GET" && match) return { kind: "runStatus", id: decodeURIComponent(match[1]) };
  return null;
}

function routeError(error, secrets = []) {
  if (error?.code === "UPSTREAM_TIMEOUT") return { status: 504, body: errorPayload("UPSTREAM_TIMEOUT", "Hermes request timed out.") };
  if (error?.code === "UPSTREAM_UNAVAILABLE") return { status: 502, body: errorPayload("UPSTREAM_UNAVAILABLE", "Hermes request failed.") };
  if (error?.code === "BLOCKED_WRONG_SERVICE") return { status: 502, body: errorPayload(error.code, error.message) };
  const status = Number.isInteger(error?.status) && error.status >= 400 ? error.status : 502;
  const code = status === 401 ? "HERMES_UNAUTHORIZED" : error?.code || "HERMES_REQUEST_FAILED";
  return {
    status,
    body: errorPayload(code, redactText(error?.message || "Hermes request failed.", secrets), {
      upstreamStatus: error?.status,
    }),
  };
}

function createRequestError(status, data, secrets) {
  const record = asRecord(data);
  const nested = asRecord(record.error);
  const error = new Error(redactText(nested.message || record.message || record.detail || `Hermes returned ${status}.`, secrets));
  error.status = status;
  error.code = nested.code || record.code || (status === 401 ? "HERMES_UNAUTHORIZED" : "HERMES_REQUEST_FAILED");
  return error;
}

export function createBffHandler(options = {}) {
  const env = options.env || process.env;
  const configPath = options.configPath || defaultConfigPath(env);
  const fetchImpl = options.fetchImpl || options.fetch || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const stored = options.config || null;
  const state = {
    config: {
      ...envConfig(env),
      ...(stored || {}),
    },
    runs: new Map(),
    capabilities: null,
    initialized: false,
  };
  let initPromise;
  async function initialize() {
    if (state.initialized) return;
    if (!initPromise) {
      initPromise = (async () => {
        const file = await readStoredConfig(configPath);
        const environment = envConfig(env);
        state.config = {
          ...file,
          ...state.config,
          ...(environment.baseUrl ? { baseUrl: environment.baseUrl } : {}),
          ...(environment.apiKey ? { apiKey: environment.apiKey } : {}),
        };
        state.config.baseUrl = normalizeBaseUrl(state.config.baseUrl || "");
        state.config.apiKey = String(state.config.apiKey || "");
        state.initialized = true;
      })();
    }
    return initPromise;
  }

  async function readBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        const error = new Error("Request body is too large");
        error.status = 413;
        error.code = "REQUEST_TOO_LARGE";
        throw error;
      }
      chunks.push(chunk);
    }
    if (!total) return {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body must be an object");
      return parsed;
    } catch {
      const error = new Error("Request body must be valid JSON");
      error.status = 400;
      error.code = "INVALID_JSON";
      throw error;
    }
  }

  function upstreamUrl(endpoint) {
    if (!state.config.baseUrl) {
      const error = new Error("Hermes base URL is not configured");
      error.status = 503;
      error.code = "HERMES_NOT_CONFIGURED";
      throw error;
    }
    const base = state.config.baseUrl.endsWith("/") ? state.config.baseUrl : `${state.config.baseUrl}/`;
    return new URL(String(endpoint).replace(/^\/+/, ""), base).toString();
  }

  async function upstream(endpoint, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = init.signal;
    const abortFromCaller = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
    const headers = new Headers(init.headers || {});
    headers.set("Accept", init.accept || headers.get("Accept") || "application/json");
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    if (state.config.apiKey) headers.set("Authorization", `Bearer ${state.config.apiKey}`);
    const url = upstreamUrl(endpoint);
    let response;
    try {
      response = await fetchImpl(url, {
        method: init.method || "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeout = new Error("Hermes request timed out");
        timeout.code = "UPSTREAM_TIMEOUT";
        throw timeout;
      }
      const unavailable = new Error("Hermes request failed");
      unavailable.code = "UPSTREAM_UNAVAILABLE";
      unavailable.cause = error;
      throw unavailable;
    } finally {
      clearTimeout(timer);
    }
    const streaming = String(init.accept || "").includes("text/event-stream");
    if (streaming && response.ok) {
      return { ok: true, status: response.status, data: null, text: "", body: response.body, headers: response.headers };
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) throw createRequestError(response.status, data, [state.config.apiKey]);
    return { ok: true, status: response.status, data, text, headers: response.headers };
  }

  async function fetchCapabilities() {
    if (state.capabilities) return state.capabilities;
    const result = await upstream("/v1/capabilities");
    const payload = asRecord(result.data);
    if (payload.object !== CAPABILITIES_OBJECT) {
      const error = new Error("The configured service is not Hermes API server");
      error.code = "BLOCKED_WRONG_SERVICE";
      throw error;
    }
    const endpoints = asRecord(payload.endpoints);
    const invalid = REQUIRED_CAPABILITY_ENDPOINTS.filter((name) => {
      const actual = asRecord(endpoints[name]);
      const expected = HERMES_ENDPOINTS[CAPABILITY_ENDPOINT_MAP[name]];
      return !expected || actual.method !== expected[0] || actual.path !== expected[1];
    });
    if (invalid.length) {
      const error = new Error(`Hermes API Server capability contract mismatch: ${invalid.join(", ")}`);
      error.code = "BLOCKED_INCOMPATIBLE";
      error.status = 502;
      throw error;
    }
    state.capabilities = payload;
    return payload;
  }

  async function requireCapabilities() {
    return fetchCapabilities();
  }

  async function statusForRun(runId) {
    const result = await upstream(`/v1/runs/${encodeURIComponent(runId)}`);
    const existing = state.runs.get(runId) || {};
    const normalized = normalizeRunStatus(result.data, { runId, sessionId: existing.sessionId });
    state.runs.set(runId, { ...existing, status: normalized });
    return { ...result, data: normalized };
  }

  async function sendFailure(res, error) {
    const normalized = routeError(error, [state.config.apiKey]);
    sendJson(res, normalized.status, normalized.body, {}, [state.config.apiKey]);
  }

  async function proxySse(req, res, runId) {
    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.once("close", onClose);
    let upstreamResponse;
    let last = { event: "run.events", runId, status: "unknown", sessionId: null, progress: null };
    let terminal = false;
    try {
      upstreamResponse = await upstream(`/v1/runs/${encodeURIComponent(runId)}/events`, {
        accept: "text/event-stream",
        signal: controller.signal,
      });
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      const emit = (raw) => {
        const normalized = normalizeRunEvent(raw, { ...last, runId });
        last = { ...last, ...normalized, runId };
        terminal = TERMINAL_STATUSES.has(normalized.status);
        if (normalized.status !== "unknown") {
          state.runs.set(runId, { ...state.runs.get(runId), status: normalized });
        }
        if (!res.destroyed) res.write(`data: ${jsonText(redactValue(normalized, [state.config.apiKey]))}\n\n`);
      };
      if (upstreamResponse.text && !upstreamResponse.text.includes("data:")) {
        if (upstreamResponse.data) emit(upstreamResponse.data);
      } else {
        let buffer = "";
        for await (const chunk of upstreamResponse.body || []) {
          buffer += Buffer.from(chunk).toString("utf8");
          let boundary;
          while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + (buffer[boundary] === "\r" ? 4 : 2));
            const dataLines = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
            if (!dataLines.length) continue;
            const raw = dataLines.join("\n");
            try { emit(JSON.parse(raw)); } catch { /* Ignore malformed upstream frames. */ }
          }
        }
        if (buffer.trim()) {
          const dataLines = buffer.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
          if (dataLines.length) {
            try { emit(JSON.parse(dataLines.join("\n"))); } catch { /* Ignore malformed tail. */ }
          }
        }
      }
      if (!terminal && !controller.signal.aborted) {
        const reconciled = await reconcileRun(async (id) => {
          try { return await statusForRun(id); } catch { return { ok: false }; }
        }, runId, last);
        emit({ ...reconciled, event: "run.reconciled" });
      }
      if (!res.destroyed) res.end();
    } catch (error) {
      if (controller.signal.aborted || req.destroyed) return;
      if (res.headersSent) {
        const reconciled = await reconcileRun(async (id) => {
          try { return await statusForRun(id); } catch { return { ok: false }; }
        }, runId, last);
        if (!res.destroyed) {
          res.write(`data: ${jsonText(redactValue({ ...reconciled, event: "run.reconciled" }, [state.config.apiKey]))}\n\n`);
          res.end();
        }
      } else {
        await sendFailure(res, error);
      }
    } finally {
      req.removeListener("close", onClose);
    }
  }

  async function handler(req, res) {
    const parsed = new URL(req.url || "/", "http://bff.invalid");
    if (!parsed.pathname.startsWith("/api/os/")) return false;
    const hostHeader = String(req.headers.host || "");
    const hostName = hostHeader.startsWith("[")
      ? hostHeader.slice(1, hostHeader.indexOf("]"))
      : hostHeader.split(":")[0];
    if (!["127.0.0.1", "localhost", "::1"].includes(hostName.toLowerCase())) {
      sendJson(res, 403, errorPayload("LOOPBACK_REQUIRED", "Agent OS API is available on loopback only."));
      return true;
    }
    if (req.method === "OPTIONS") {
      sendJson(res, 405, errorPayload("CORS_DISABLED", "Cross-origin requests are not supported."));
      return true;
    }
    const route = routeMatch(req.method || "GET", parsed.pathname);
    if (!route) {
      sendJson(res, 404, errorPayload("OS_ROUTE_NOT_FOUND", "Agent OS route was not found."));
      return true;
    }
    if (req.method !== "GET") {
      if (req.headers["x-hermes-agent-os"] !== "1") {
        sendJson(res, 403, errorPayload("SAME_ORIGIN_REQUIRED", "Missing Agent OS same-origin request marker."));
        return true;
      }
      const origin = String(req.headers.origin || "");
      if (origin) {
        let originHost = "";
        try { originHost = new URL(origin).host; } catch { /* rejected below */ }
        if (!originHost || originHost !== hostHeader) {
          sendJson(res, 403, errorPayload("SAME_ORIGIN_REQUIRED", "Cross-origin Agent OS mutations are not allowed."));
          return true;
        }
      }
      if (req.headers["content-type"] && !String(req.headers["content-type"]).toLowerCase().startsWith("application/json")) {
        sendJson(res, 415, errorPayload("JSON_REQUIRED", "Agent OS mutations require application/json."));
        return true;
      }
    }
    await initialize();
    try {
      if (route.kind === "config") {
        const body = await readBody(req);
        const next = { ...state.config };
        if (Object.prototype.hasOwnProperty.call(body, "baseUrl")) {
          try {
            next.baseUrl = normalizeBaseUrl(body.baseUrl);
          } catch (error) {
            error.status = 400;
            error.code = "INVALID_CONFIG";
            throw error;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, "apiKey")) next.apiKey = String(body.apiKey || "");
        await persistConfig(configPath, next);
        state.config = next;
        state.capabilities = null;
        sendJson(res, 200, publicConfig(next), {}, [state.config.apiKey]);
        return true;
      }
      if (route.kind === "health") {
        const result = await upstream("/health");
        sendJson(res, 200, { ok: true, health: result.data, config: publicConfig(state.config) }, {}, [state.config.apiKey]);
        return true;
      }
      if (route.kind === "capabilities") {
        sendJson(res, 200, await fetchCapabilities(), {}, [state.config.apiKey]);
        return true;
      }
      if (route.kind === "sessions" || route.kind === "skills" || route.kind === "toolsets") {
        await requireCapabilities();
        const endpoint = route.kind === "sessions" ? "/api/sessions" : route.kind === "skills" ? "/v1/skills" : "/v1/toolsets";
        const result = await upstream(endpoint);
        sendJson(res, 200, result.data, {}, [state.config.apiKey]);
        return true;
      }
      if (route.kind === "createSession") {
        await requireCapabilities();
        const result = await upstream("/api/sessions", { method: "POST", body: await readBody(req) });
        sendJson(res, result.status || 201, result.data, {}, [state.config.apiKey]);
        return true;
      }
      if (route.kind === "snapshot") {
        const verifiedCapabilities = await requireCapabilities();
        const responses = await Promise.allSettled([
          upstream("/health"),
          upstream("/api/sessions"),
          upstream("/v1/skills"),
          upstream("/v1/toolsets"),
        ]);
        const [health, sessions, skills, toolsets] = responses;
        if (sessions.status === "rejected") throw sessions.reason;
        const errors = responses.map((item, index) => item.status === "rejected" ? { source: ["health", "sessions", "skills", "toolsets"][index], ...routeError(item.reason, [state.config.apiKey]).body.error } : null).filter(Boolean);
        if (health.status === "rejected" && sessions.status === "rejected") {
          const error = health.reason || sessions.reason;
          error.code ||= "HERMES_SNAPSHOT_FAILED";
          throw error;
        }
        sendJson(res, 200, {
          ok: true,
          degraded: errors.length > 0,
          fetchedAt: Date.now(),
          health: health.status === "fulfilled" ? health.value.data : null,
          capabilities: verifiedCapabilities,
          sessions: sessions.status === "fulfilled" ? listData(sessions.value.data).map(normalizeSession) : [],
          skills: skills.status === "fulfilled" ? listData(skills.value.data) : [],
          toolsets: toolsets.status === "fulfilled" ? listData(toolsets.value.data) : [],
          runs: [...state.runs.values()].map((item) => item.status).filter(Boolean),
          errors,
        }, {}, [state.config.apiKey]);
        return true;
      }
      if (route.kind === "chat") {
        await requireCapabilities();
        const body = await readBody(req);
        const input = body.input ?? body.message ?? body.text;
        if (typeof input !== "string" || !input.trim()) {
          const error = new Error("input must be a non-empty string");
          error.status = 400;
          error.code = "INVALID_INPUT";
          throw error;
        }
        const runBody = { ...body, input, session_id: route.id };
        delete runBody.sessionId;
        const result = await upstream("/v1/runs", { method: "POST", body: runBody });
        const runId = asRecord(result.data).run_id || asRecord(result.data).runId;
        if (!runId) {
          const error = new Error("Hermes did not return run_id");
          error.code = "INVALID_UPSTREAM_RESPONSE";
          error.status = 502;
          throw error;
        }
        state.runs.set(String(runId), { sessionId: route.id, status: normalizeRunStatus(result.data, { runId, sessionId: route.id }) });
        sendJson(res, result.status || 202, { run_id: runId }, {}, [state.config.apiKey]);
        return true;
      }
      if (route.kind === "runStatus") {
        await requireCapabilities();
        const result = await statusForRun(route.id);
        sendJson(res, result.status || 200, result.data, {}, [state.config.apiKey]);
        return true;
      }
      if (route.kind === "events") {
        await requireCapabilities();
        await proxySse(req, res, route.id);
        return true;
      }
      if (route.kind === "approval") {
        await requireCapabilities();
        const body = await readBody(req);
        const choice = approvalChoice(body.decision ?? body.choice);
        if (!choice) {
          const error = new Error("decision must be approve, deny, once, session, or always");
          error.status = 400;
          error.code = "INVALID_APPROVAL_DECISION";
          throw error;
        }
        const result = await upstream(`/v1/runs/${encodeURIComponent(route.id)}/approval`, { method: "POST", body: { choice, ...(body.all !== undefined ? { all: Boolean(body.all) } : {}) } });
        sendJson(res, result.status || 200, result.data, {}, [state.config.apiKey]);
        return true;
      }
      if (route.kind === "stop") {
        await requireCapabilities();
        const result = await upstream(`/v1/runs/${encodeURIComponent(route.id)}/stop`, { method: "POST", body: {} });
        sendJson(res, result.status || 200, result.data, {}, [state.config.apiKey]);
        return true;
      }
    } catch (error) {
      await sendFailure(res, error);
      return true;
    }
    return true;
  }

  handler.state = state;
  handler.configPath = configPath;
  handler.getConfig = () => publicConfig(state.config);
  return handler;
}

export async function startBffServer(options = {}) {
  const handler = options.handler || createBffHandler(options);
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) sendJson(res, 500, errorPayload("BFF_INTERNAL_ERROR", "BFF request failed."));
    });
  });
  const host = options.host || "127.0.0.1";
  const port = options.port === undefined ? 4178 : Number(options.port);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return { server, handler, host, port: server.address()?.port || port };
}

export const createRequestHandler = createBffHandler;

export default createBffHandler;
