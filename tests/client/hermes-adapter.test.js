import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() {
    this.values = new Map();
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

global.window = {
  localStorage: new MemoryStorage(),
  location: { hostname: "127.0.0.1" },
  setTimeout,
  clearTimeout,
  dispatchEvent: () => true,
};

await import("../../src/hermes/store-patch.js");
const { DashboardStore } = await import("../../src/hermes/store.js");
const { createDemoFloors } = await import("../../src/hermes/data.js");
const { createHermesAdapter } = await import("../../src/hermes/hermes-adapter.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function startRuntime(store) {
  const adapter = createHermesAdapter({
    config: { mode: "runtime", configured: false },
    onEvent: (event) => store.applyHermesEvent(event),
    onConnection: (status) => store.setConnection(status),
  });
  adapter.start();
  return adapter;
}

test("runtime adapter replaces a live Hermes store with fresh Demo state", () => {
  const liveFloors = createDemoFloors().slice(0, 1);
  liveFloors[0].source = "hermes";
  liveFloors[0].agents[0].source = "hermes";
  liveFloors[0].agents[0].sessionId = "live-session";
  const store = new DashboardStore({ floors: clone(liveFloors) });
  store.state.dataMode = "live";

  const adapter = startRuntime(store);

  assert.equal(store.state.dataMode, "demo");
  assert.equal(store.state.selectedFloorId, "engineering");
  assert.ok(store.state.floors.length > liveFloors.length);
  adapter.stop();
});

test("runtime adapter preserves a pure Demo store and its initial selection", () => {
  const demoFloors = createDemoFloors().slice(0, 2);
  const store = new DashboardStore({ floors: clone(demoFloors) });
  const before = {
    floorIds: store.state.floors.map((floor) => floor.id),
    selectedFloorId: store.state.selectedFloorId,
    selectedAgentId: store.state.selectedAgentId,
  };

  const adapter = startRuntime(store);

  assert.deepEqual(store.state.floors.map((floor) => floor.id), before.floorIds);
  assert.equal(store.state.selectedFloorId, before.selectedFloorId);
  assert.equal(store.state.selectedAgentId, before.selectedAgentId);
  assert.equal(store.state.dataMode, "demo");
  adapter.stop();
});
