import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("legacy browser credentials are scrubbed and future credentials stay out of localStorage", async () => {
  const oldSecret = "test-only-legacy-secret";
  const requests = [];
  const localStorage = new MemoryStorage({
    "hermes-agent-os:connection-v5": JSON.stringify({
      configured: true,
      mode: "live",
      baseUrl: "http://127.0.0.1:8642",
      apiKey: oldSecret,
    }),
  });
  global.window = {
    localStorage,
    location: { hostname: "127.0.0.1" },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ ok: true, apiKeyConfigured: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  };

  const connection = await import(`../../src/hermes/connection.js?test=${Date.now()}`);
  const migrated = connection.loadConnection();
  assert.equal(migrated.apiKey, "");
  assert.equal(localStorage.getItem("hermes-agent-os:connection-v5"), null);
  assert.ok(!localStorage.getItem("hermes-agent-os:connection-v6").includes(oldSecret));
  await window.__HERMES_BACKEND_CONFIG_READY__;
  assert.equal(JSON.parse(requests.at(-1).init.body).apiKey, oldSecret);

  const replacement = "test-only-new-secret";
  connection.saveConnection({
    mode: "live",
    baseUrl: "http://127.0.0.1:18642",
    apiKey: replacement,
  });
  await window.__HERMES_BACKEND_CONFIG_READY__;
  assert.ok(!localStorage.getItem("hermes-agent-os:connection-v6").includes(replacement));
  assert.equal(requests.at(-1).url, "/api/os/config");
  assert.equal(JSON.parse(requests.at(-1).init.body).apiKey, replacement);

  const returned = connection.saveConnection({
    mode: "live",
    baseUrl: "http://127.0.0.1:18642",
    apiKey: "",
  });
  await window.__HERMES_BACKEND_CONFIG_READY__;
  assert.equal(returned.apiKey, "");
  assert.equal(returned.apiKeyConfigured, true);
  assert.equal("apiKey" in JSON.parse(requests.at(-1).init.body), false);
});

test("syncPublicBackendConfig adopts only public health config fields", async () => {
  const localStorage = new MemoryStorage({
    "hermes-agent-os:connection-v6": JSON.stringify({
      configured: true,
      mode: "live",
      baseUrl: "http://127.0.0.1:18643",
      apiKeyConfigured: false,
      pollMs: 10_000,
    }),
  });
  global.window = {
    localStorage,
    location: { hostname: "127.0.0.1" },
    fetch: async (url) => {
      assert.equal(url, "/api/os/health");
      return new Response(JSON.stringify({
        ok: true,
        config: {
          baseUrl: "http://127.0.0.1:18642",
          configured: true,
          apiKeyConfigured: true,
          apiKey: "response-secret-must-not-be-persisted",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  };

  const connection = await import(`../../src/hermes/connection.js?public-sync=${Date.now()}`);
  const synced = await connection.syncPublicBackendConfig();
  const persisted = JSON.parse(localStorage.getItem("hermes-agent-os:connection-v6"));

  assert.equal(synced.baseUrl, "http://127.0.0.1:18642");
  assert.equal(synced.configured, true);
  assert.equal(synced.apiKeyConfigured, true);
  assert.equal(synced.apiKey, "");
  assert.equal(persisted.baseUrl, "http://127.0.0.1:18642");
  assert.equal(persisted.apiKeyConfigured, true);
  assert.equal("apiKey" in persisted, false);
});

test("syncPublicBackendConfig preserves the existing connection on network or HTTP failure", async () => {
  const oldConfig = {
    configured: true,
    mode: "live",
    baseUrl: "http://127.0.0.1:18643",
    apiKeyConfigured: true,
    pollMs: 10_000,
  };
  const localStorage = new MemoryStorage({
    "hermes-agent-os:connection-v6": JSON.stringify(oldConfig),
  });
  global.window = {
    localStorage,
    location: { hostname: "127.0.0.1" },
    fetch: async () => new Response("unavailable", { status: 503 }),
  };

  const connection = await import(`../../src/hermes/connection.js?public-failure=${Date.now()}`);
  connection.loadConnection();
  const persistedBefore = localStorage.getItem("hermes-agent-os:connection-v6");
  const synced = await connection.syncPublicBackendConfig();

  assert.equal(synced.baseUrl, oldConfig.baseUrl);
  assert.equal(synced.configured, oldConfig.configured);
  assert.equal(synced.apiKeyConfigured, oldConfig.apiKeyConfigured);
  assert.equal(localStorage.getItem("hermes-agent-os:connection-v6"), persistedBefore);
});

test("syncPublicBackendConfig aborts a slow health request and preserves the existing connection", async () => {
  const oldConfig = {
    configured: true,
    mode: "live",
    baseUrl: "http://127.0.0.1:18643",
    apiKeyConfigured: true,
    pollMs: 10_000,
  };
  const localStorage = new MemoryStorage({
    "hermes-agent-os:connection-v6": JSON.stringify(oldConfig),
  });
  global.window = {
    localStorage,
    location: { hostname: "127.0.0.1" },
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    }),
  };

  const connection = await import(`../../src/hermes/connection.js?public-timeout=${Date.now()}`);
  connection.loadConnection();
  const persistedBefore = localStorage.getItem("hermes-agent-os:connection-v6");
  const synced = await connection.syncPublicBackendConfig({ timeoutMs: 5 });

  assert.equal(synced.baseUrl, oldConfig.baseUrl);
  assert.equal(localStorage.getItem("hermes-agent-os:connection-v6"), persistedBefore);
});
