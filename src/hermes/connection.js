// @ts-nocheck
const CONFIG_KEY = "hermes-agent-os:connection-v6";
const LEGACY_CONFIG_KEY = "hermes-agent-os:connection-v5";
const ORG_KEY = "hermes-agent-os:org-live-v5";

export function defaultConnection() {
  return {
    configured: false,
    mode: "live",
    baseUrl: "http://127.0.0.1:8642",
    apiKey: "",
    apiKeyConfigured: false,
    backendManaged: true,
    pollMs: 15_000,
    pruneEmpty: true,
  };
}

export function isLoopbackUrl(url) {
  try {
    const host = new URL(String(url || "").trim()).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0" || host === "::1";
  } catch {
    return /^(https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0|::1)(:|\/|$)/i.test(String(url || ""));
  }
}

export function isLocalAppHost() {
  if (typeof window === "undefined") return false;
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0" || host === "::1";
}

function sanitizedConfig(config) {
  const next = { ...defaultConnection(), ...config };
  delete next.apiKey;
  return {
    configured: Boolean(next.configured),
    mode: next.mode === "runtime" ? "runtime" : "live",
    baseUrl: String(next.baseUrl || defaultConnection().baseUrl).trim() || defaultConnection().baseUrl,
    apiKeyConfigured: Boolean(next.apiKeyConfigured),
    backendManaged: true,
    pollMs: Math.max(10_000, Number(next.pollMs) || 15_000),
    pruneEmpty: next.pruneEmpty !== false,
  };
}

function persistBackendConfig(config) {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return Promise.resolve();
  const body = { baseUrl: String(config.baseUrl || "").trim() };
  if (typeof config.apiKey === "string" && config.apiKey) body.apiKey = config.apiKey;
  const request = window.fetch("/api/os/config", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Hermes-Agent-OS": "1",
    },
    body: JSON.stringify(body),
  }).then(async (response) => {
    if (response.ok) return response.json().catch(() => ({}));
    const payload = await response.json().catch(() => ({}));
    throw new Error(String(payload.message || payload.error?.message || `Configuration failed (${response.status})`));
  });
  window.__HERMES_BACKEND_CONFIG_READY__ = request;
  request.catch(() => {});
  return request;
}

export function loadConnection() {
  try {
    const current = window.localStorage.getItem(CONFIG_KEY);
    const legacy = current ? null : window.localStorage.getItem(LEGACY_CONFIG_KEY);
    const raw = current || legacy;
    if (!raw) return defaultConnection();
    const parsed = JSON.parse(raw);
    const legacyApiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
    const next = sanitizedConfig({ ...parsed, apiKeyConfigured: Boolean(parsed.apiKeyConfigured || legacyApiKey) });
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
    if (legacy) window.localStorage.removeItem(LEGACY_CONFIG_KEY);
    if (legacyApiKey) persistBackendConfig({ ...next, apiKey: legacyApiKey });
    return { ...next, apiKey: "" };
  } catch {
    return defaultConnection();
  }
}

export function saveConnection(config) {
  const submittedApiKey = String(config?.apiKey || "");
  let existingKeyConfigured = false;
  try {
    existingKeyConfigured = Boolean(JSON.parse(window.localStorage.getItem(CONFIG_KEY) || "{}").apiKeyConfigured);
  } catch {
    existingKeyConfigured = false;
  }
  const next = sanitizedConfig({
    ...config,
    configured: true,
    apiKeyConfigured: Boolean(submittedApiKey || existingKeyConfigured),
  });
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  window.localStorage.removeItem(LEGACY_CONFIG_KEY);
  persistBackendConfig({ ...next, ...(submittedApiKey ? { apiKey: submittedApiKey } : {}) });
  return { ...next, apiKey: "" };
}

export function loadPersistedOrg() {
  try {
    const raw = window.localStorage.getItem(ORG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.floors)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePersistedOrg(state) {
  if (!state) return;
  const payload = {
    floors: state.floors,
    selectedFloorId: state.selectedFloorId,
    selectedAgentId: state.selectedAgentId,
    activePodByFloor: state.activePodByFloor,
    autoExpand: state.autoExpand,
    tokenUsage: state.tokenUsage,
    tokenLimit: state.tokenLimit,
    newOffices: state.newOffices,
    viewMode: state.viewMode,
    dataMode: state.dataMode,
  };
  window.localStorage.setItem(ORG_KEY, JSON.stringify(payload));
}

export function clearPersistedOrg() {
  window.localStorage.removeItem(ORG_KEY);
}
