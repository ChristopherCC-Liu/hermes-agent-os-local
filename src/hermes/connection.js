// @ts-nocheck
const CONFIG_KEY = "hermes-agent-os:connection";
const ORG_KEY = "hermes-agent-os:org-demo-v1";

export function defaultConnection() {
  return {
    configured: false,
    mode: "runtime",
    baseUrl: "http://127.0.0.1:8642",
    apiKey: "",
    pollMs: 5000,
    pruneEmpty: false,
  };
}

export function loadConnection() {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultConnection();
    const parsed = JSON.parse(raw);
    return {
      ...defaultConnection(),
      ...parsed,
      pollMs: Math.max(2500, Number(parsed.pollMs) || 5000),
      mode: parsed.mode === "live" ? "live" : "runtime",
    };
  } catch {
    return defaultConnection();
  }
}

export function saveConnection(config) {
  const next = { ...defaultConnection(), ...config, configured: true };
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
