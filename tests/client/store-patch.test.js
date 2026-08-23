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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("live reconciliation preserves selection and details state while identities survive", () => {
  const floors = createDemoFloors().slice(0, 2);
  const store = new DashboardStore({ floors: clone(floors) });
  const selectedFloor = floors[1];
  const selectedAgent = selectedFloor.agents[1];
  store.state.selectedFloorId = selectedFloor.id;
  store.state.selectedAgentId = selectedAgent.id;
  store.state.detailsOpen = false;

  store.applyOrgSnapshot({ floors: clone(floors), fetchedAt: 1234 });
  assert.equal(store.state.selectedFloorId, selectedFloor.id);
  assert.equal(store.state.selectedAgentId, selectedAgent.id);
  assert.equal(store.state.detailsOpen, false);
  assert.equal(store.state.dataMode, "live");

  store.state.detailsOpen = true;
  const withoutSelectedAgent = clone(floors);
  withoutSelectedAgent[1].agents = withoutSelectedAgent[1].agents.filter((agent) => agent.id !== selectedAgent.id);
  store.applyOrgSnapshot({ floors: withoutSelectedAgent, fetchedAt: 2345 });
  assert.equal(store.state.selectedFloorId, selectedFloor.id);
  assert.equal(store.state.selectedAgentId, withoutSelectedAgent[1].agents[0].id);
  assert.equal(store.state.detailsOpen, true);
});

test("live reconciliation falls back only when an entity disappears and accepts an empty live org", () => {
  const floors = createDemoFloors().slice(0, 2);
  const store = new DashboardStore({ floors: clone(floors) });
  store.state.selectedFloorId = floors[1].id;
  store.state.selectedAgentId = floors[1].agents[0].id;
  store.state.detailsOpen = true;

  store.applyOrgSnapshot({ floors: [clone(floors[0])], fetchedAt: 3456 });
  assert.equal(store.state.selectedFloorId, floors[0].id);
  assert.equal(store.state.selectedAgentId, floors[0].agents[0].id);
  assert.equal(store.state.detailsOpen, true);

  store.applyOrgSnapshot({ floors: [], fetchedAt: 4567 });
  assert.deepEqual(store.state.floors, []);
  assert.equal(store.state.selectedFloorId, null);
  assert.equal(store.state.selectedAgentId, null);
  assert.equal(store.state.detailsOpen, false);
});

test("generic run envelopes reconcile approval, completion, failure, and stop from payload.status", () => {
  const floors = createDemoFloors().slice(0, 1);
  const statuses = [
    ["waiting_for_approval", "approval", true],
    ["completed", "offline", false],
    ["failed", "escalated", false],
    ["stopped", "offline", false],
  ];

  for (const [payloadStatus, expectedStatus, expectedRunning] of statuses) {
    const seeded = clone(floors);
    seeded[0].agents[0].sessionId = "session-generic-status";
    const store = new DashboardStore({ floors: seeded });
    store.applyHermesEvent({
      type: "run.lifecycle",
      event: "run.reconciled",
      status: payloadStatus,
      sessionId: "session-generic-status",
      runId: "run-generic-status",
      timestamp: 1_700_000_000_000,
    });

    const agent = store.getState().floors[0].agents[0];
    assert.equal(agent.status, expectedStatus, payloadStatus);
    assert.equal(agent.running, expectedRunning, payloadStatus);
    assert.equal(agent.lastRunEvent, "run.reconciled");
  }
});

test("loading Demo replaces live state immediately and clears persisted live org", () => {
  const floors = createDemoFloors().slice(0, 1);
  const staleLive = {
    floors: clone(floors),
    dataMode: "live",
    selectedFloorId: floors[0].id,
    selectedAgentId: floors[0].agents[0].id,
  };
  window.localStorage.setItem("hermes-agent-os:org-live-v5", JSON.stringify(staleLive));

  const store = new DashboardStore({ floors: clone(floors) });
  store.state.dataMode = "live";
  store.loadSample();

  assert.equal(store.state.dataMode, "demo");
  assert.ok(store.state.floors.length > 1);
  assert.notDeepEqual(store.state.floors, staleLive.floors);
  assert.equal(window.localStorage.getItem("hermes-agent-os:org-live-v5"), null);
});
