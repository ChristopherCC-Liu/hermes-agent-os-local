// @ts-nocheck
const CONFIG_KEY = "hermes-agent-os:connection-v5";
const ORG_KEY = "hermes-agent-os:org-live-v5";

export function defaultConnection() {
  return {
    configured: false,
    mode: "live",
    baseUrl: "http://127.0.0.1:8642",
    apiKey: "",
    pollMs: 5000,
    pruneEmpty: false,
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

export function loadConnection() {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultConnection();
    const parsed = JSON.parse(raw);
    const baseUrl = String(parsed.baseUrl || defaultConnection().baseUrl).trim();
    const mode = parsed.mode === "runtime" ? "runtime" : "live";
    return {
      ...defaultConnection(),
      ...parsed,
      baseUrl,
      pollMs: Math.max(2500, Number(parsed.pollMs) || 5000),
      mode,
    };
  } catch {
    return defaultConnection();
  }
}

export function saveConnection(config) {
  const next = { ...defaultConnection(), ...config, configured: true };
  const baseUrl = String(next.baseUrl || "").trim();
  next.baseUrl = baseUrl || defaultConnection().baseUrl;
  next.mode = next.mode === "live" && next.baseUrl ? "live" : "runtime";
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
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
  };
  window.localStorage.setItem(ORG_KEY, JSON.stringify(payload));
}

export function clearPersistedOrg() {
  window.localStorage.removeItem(ORG_KEY);
}
