import { DashboardStore } from "./store.js";
import { clearPersistedOrg, loadConnection, loadPersistedOrg } from "./connection.js";

function hasHermesProvenance(org) {
  return (org?.floors || []).some((floor) =>
    floor?.source === "hermes"
    || (floor?.agents || []).some((agent) => agent?.source === "hermes" || agent?.sessionId),
  );
}

function isPersistedLiveOrg(org) {
  return String(org?.dataMode || "").toLowerCase() === "live" || hasHermesProvenance(org);
}

function isLiveStoreState(state) {
  return String(state?.dataMode || "").toLowerCase() === "live"
    || hasHermesProvenance({ floors: state?.floors || [] });
}

// A runtime reload must not hydrate the last live snapshot before the app has
// a chance to render Demo. Clear only a runtime-mode persisted live org; a
// persisted pure Demo/runtime org remains the visual baseline unchanged.
function scrubPersistedLiveOrgForRuntime() {
  if (typeof window === "undefined") return;
  const connection = loadConnection();
  const persisted = loadPersistedOrg();
  if (connection.mode === "runtime" && isPersistedLiveOrg(persisted)) clearPersistedOrg();
}

scrubPersistedLiveOrgForRuntime();

function findFloor(floors, floorId) {
  const wanted = String(floorId || "").replace(/^floor-/, "");
  return floors.find((floor) => {
    const id = String(floor?.id || "").replace(/^floor-/, "");
    return id === wanted || String(floor?.moduleId || "") === wanted;
  }) || null;
}

function findAgent(floors, identity) {
  const wanted = String(identity || "");
  if (!wanted) return { floor: null, agent: null };
  for (const floor of floors) {
    const agent = (floor.agents || []).find((item) =>
      [item?.id, item?.agentId, item?.sessionId, item?.runId].some((value) => String(value || "") === wanted),
    );
    if (agent) return { floor, agent };
  }
  return { floor: null, agent: null };
}

function lifecycleState(event) {
  const eventName = String(event.event || "").toLowerCase();
  const payloadStatus = String(event.status || "").toLowerCase();
  const genericEnvelope = new Set(["run.status", "run.reconciled", "run.updated", "run.lifecycle"]);
  const name = genericEnvelope.has(eventName) && payloadStatus ? payloadStatus : (eventName || payloadStatus);
  if (name === "approval.request" || name === "waiting_for_approval") {
    return { status: "approval", running: true, progress: 68 };
  }
  if (name === "run.failed" || name === "failed" || name === "error") {
    return { status: "escalated", running: false, progress: Number(event.progress) || 70 };
  }
  if (["run.completed", "completed"].includes(name)) {
    return { status: "offline", running: false, progress: 100 };
  }
  if (["run.cancelled", "cancelled", "canceled", "stopped", "stopping"].includes(name)) {
    return { status: "offline", running: false, progress: Number(event.progress) || 80 };
  }
  if (["queued", "starting", "run.started"].includes(name)) {
    return { status: "waiting", running: true, progress: Number(event.progress) || 10 };
  }
  if (name.startsWith("tool.")) {
    return { status: "working", running: true, progress: Number(event.progress) || 46 };
  }
  return { status: "working", running: true, progress: Number(event.progress) || 24 };
}

DashboardStore.prototype.applyOrgSnapshot = function applyLiveSnapshot(org) {
  if (!org || !Array.isArray(org.floors)) return;
  const previousFloorId = this.state.selectedFloorId;
  const previousAgentId = this.state.selectedAgentId;
  const previousDetailsOpen = Boolean(this.state.detailsOpen);
  const nextFloors = org.floors.map((floor, index) => ({ ...floor, number: index + 1 }));

  this.state.floors = nextFloors;
  this.state.dataMode = "live";
  if (Number.isFinite(Number(org.tokenUsage))) this.state.tokenUsage = Number(org.tokenUsage);
  if (Number.isFinite(Number(org.tokenLimit))) this.state.tokenLimit = Number(org.tokenLimit);
  this.state.lastSyncAt = org.fetchedAt || Date.now();
  this.state.lastError = null;
  if (org.hermesMeta !== undefined) this.state.hermesMeta = org.hermesMeta;

  const stableAgent = findAgent(nextFloors, previousAgentId);
  if (stableAgent.agent && stableAgent.floor) {
    this.state.selectedFloorId = stableAgent.floor.id;
    this.state.selectedAgentId = stableAgent.agent.id;
  } else {
    const stableFloor = findFloor(nextFloors, previousFloorId);
    const fallbackFloor = stableFloor || nextFloors[0] || null;
    this.state.selectedFloorId = fallbackFloor?.id || null;
    this.state.selectedAgentId = fallbackFloor?.agents?.[0]?.id || null;
  }
  this.state.detailsOpen = previousDetailsOpen && Boolean(this.state.selectedAgentId);
  this.emit();
};

const originalApplyHermesEvent = DashboardStore.prototype.applyHermesEvent;
DashboardStore.prototype.applyHermesEvent = function applyHermesEventWithRunLifecycle(event) {
  if (event?.type === "org.demo") {
    if (isLiveStoreState(this.state)) {
      this.loadSample();
    } else if (this.state.dataMode !== "demo") {
      this.state.dataMode = "demo";
      this.emit();
    }
    return;
  }
  if (event?.type !== "run.lifecycle") {
    return originalApplyHermesEvent.call(this, event);
  }

  const identity = event.sessionId || event.agentId || event.runId;
  const found = findAgent(this.state.floors, identity);
  if (!found.agent || !found.floor) return;
  const next = lifecycleState(event);
  found.agent.status = next.status;
  found.agent.running = next.running;
  found.agent.progress = Math.max(Number(found.agent.progress) || 0, Math.min(100, next.progress));
  found.agent.runId = event.runId || found.agent.runId || "";
  found.agent.lastRunEvent = event.event || event.status || "";
  if (Array.isArray(event.choices)) found.agent.approvalChoices = event.choices;
  if (event.tool) found.agent.task = `${event.event === "tool.completed" ? "Completed" : "Using"} ${event.tool}`;
  if (event.error) found.agent.task = String(event.error).slice(0, 220);
  if (event.output) {
    found.agent.draft = String(event.output).slice(0, 4000);
    found.agent.task = "Hermes run completed";
  }
  found.agent.activity = [
    { label: String(event.event || event.status || "Hermes run updated"), at: Number(event.timestamp) || Date.now() },
    ...(Array.isArray(found.agent.activity) ? found.agent.activity : []),
  ].slice(0, 12);
  found.floor.openTasks = found.floor.agents.filter((agent) => agent.status !== "offline").length;
  this.state.lastSyncAt = Number(event.timestamp) || Date.now();
  this.emit();
};

const originalLoadSample = DashboardStore.prototype.loadSample;
DashboardStore.prototype.loadSample = function loadTruthfulSample() {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("hermes-agent-os:mode", { detail: { mode: "runtime" } }));
  }
  clearPersistedOrg();
  this.state.dataMode = "demo";
  return originalLoadSample.call(this);
};

const originalResetOrg = DashboardStore.prototype.resetOrg;
DashboardStore.prototype.resetOrg = function resetTruthfulOrg() {
  this.state.dataMode = "none";
  return originalResetOrg.call(this);
};
