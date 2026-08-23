#!/usr/bin/env node

const baseUrl = String(process.argv[2] || process.env.HERMES_API_URL || process.env.HERMES_URL || "http://127.0.0.1:8642").replace(/\/+$/, "");
const apiKey = process.env.HERMES_API_KEY || process.env.API_SERVER_KEY || "";
const timeoutMs = 3000;

function blocked(code, message) {
  console.log(`${code}: ${message}`);
  process.exitCode = 1;
}

async function fetchJson(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(`${baseUrl}${endpoint}`, { headers, signal: controller.signal });
    let data = null;
    try { data = await response.json(); } catch { /* classify below */ }
    return { response, data };
  } catch (error) {
    return { error };
  } finally {
    clearTimeout(timer);
  }
}

const health = await fetchJson("/health");
if (health.error) {
  blocked(health.error.name === "AbortError" ? "BLOCKED_TIMEOUT" : "BLOCKED_HERMES_UNREACHABLE", "health probe failed");
  process.exit(process.exitCode);
}
if (health.response.status === 401 || health.response.status === 403) {
  blocked("BLOCKED_AUTH", "health endpoint rejected the configured bearer credential");
  process.exit(process.exitCode);
}
if (!health.response.ok) {
  const code = [404, 405].includes(health.response.status) ? "BLOCKED_WRONG_SERVICE" : "BLOCKED_HERMES_UNREACHABLE";
  blocked(code, `health returned HTTP ${health.response.status}`);
  process.exit(process.exitCode);
}

const detailedHealth = await fetchJson("/health/detailed");
if (detailedHealth.error) {
  blocked(detailedHealth.error.name === "AbortError" ? "BLOCKED_TIMEOUT" : "BLOCKED_HERMES_UNREACHABLE", "detailed health probe failed");
  process.exit(process.exitCode);
}
if (detailedHealth.response.status === 401 || detailedHealth.response.status === 403) {
  blocked("BLOCKED_AUTH", "detailed health rejected the configured bearer credential");
  process.exit(process.exitCode);
}
if (!detailedHealth.response.ok) {
  blocked([404, 405].includes(detailedHealth.response.status) ? "BLOCKED_WRONG_SERVICE" : "BLOCKED_ENDPOINT", `detailed health returned HTTP ${detailedHealth.response.status}`);
  process.exit(process.exitCode);
}

const capabilities = await fetchJson("/v1/capabilities");
if (capabilities.error || !capabilities.response.ok) {
  blocked(capabilities.response?.status === 401 || capabilities.response?.status === 403 ? "BLOCKED_AUTH" : "BLOCKED_WRONG_SERVICE", "capabilities probe failed");
  process.exit(process.exitCode);
}
if (capabilities.data?.object !== "hermes.api_server.capabilities") {
  blocked("BLOCKED_WRONG_SERVICE", "capabilities object is not hermes.api_server.capabilities");
  process.exit(process.exitCode);
}

for (const endpoint of ["/api/sessions", "/v1/skills", "/v1/toolsets"]) {
  const result = await fetchJson(endpoint);
  if (result.error) {
    blocked(result.error.name === "AbortError" ? "BLOCKED_TIMEOUT" : "BLOCKED_ENDPOINT", `${endpoint} probe failed`);
    process.exit(process.exitCode);
  }
  if (result.response.status === 401 || result.response.status === 403) {
    blocked("BLOCKED_AUTH", `${endpoint} rejected the configured bearer credential`);
    process.exit(process.exitCode);
  }
  if (!result.response.ok) {
    blocked("BLOCKED_ENDPOINT", `${endpoint} returned HTTP ${result.response.status}`);
    process.exit(process.exitCode);
  }
}

console.log(`HERMES_OK: ${baseUrl}`);
console.log("No run was created; smoke probes are read-only.");
