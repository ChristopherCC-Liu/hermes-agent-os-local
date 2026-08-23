// @ts-nocheck
const CONFIG_KEY = "hermes-agent-os:connection-v6";
const ORG_KEY = "hermes-agent-os:org-live-v5";
const LEGACY_CONNECTION_KEYS = [
  "hermes-agent-os:connection-v1",
  "hermes-agent-os:connection-v2",
  "hermes-agent-os:connection-v3",
  "hermes-agent-os:connection-v4",
  "hermes-agent-os:connection-v5",
];

export const DEFAULT_HERMES_HOST = "http://127.0.0.1:9119";

function normalizeHostUrl(value) {
  try {
    const url = new URL(String(value || DEFAULT_HERMES_HOST).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_HERMES_HOST;
    return url.origin;
  } catch {
    return DEFAULT_HERMES_HOST;
  }
}

export function hermesPluginUrl(value = DEFAULT_HERMES_HOST) {
  const url = new URL(normalizeHostUrl(value));
  url.pathname = "/hermes-agent-os/";
  return url.href;
}

function clearLegacyConnectionConfig() {
  for (const key of LEGACY_CONNECTION_KEYS) window.localStorage.removeItem(key);
}

export function defaultConnection() {
  return {
    configured: false,
    mode: "runtime",
    hostUrl: DEFAULT_HERMES_HOST,
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
    clearLegacyConnectionConfig();
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultConnection();
    const parsed = JSON.parse(raw);
    return {
      ...defaultConnection(),
      configured: parsed.configured === true,
      hostUrl: normalizeHostUrl(parsed.hostUrl),
    };
  } catch {
    return defaultConnection();
  }
}

export function saveConnection(config) {
  clearLegacyConnectionConfig();
  const next = {
    ...defaultConnection(),
    configured: true,
    hostUrl: normalizeHostUrl(config?.hostUrl),
  };
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
