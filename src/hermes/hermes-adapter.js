// @ts-nocheck
import { fetchHermesRun, fetchHermesSnapshot } from "../gateway.js";
import { projectHermesSnapshot } from "./org-engine.js";

const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled", "canceled", "stopped"]);

function normalizeConfig(config = {}) {
  return {
    configured: config.configured === true,
    mode: config.mode === "live" ? "live" : "runtime",
    baseUrl: String(config.baseUrl || ""),
    reconnectMs: Math.max(1000, Number(config.reconnectMs) || 3500),
    pollMs: Math.max(10_000, Number(config.pollMs) || 15_000),
  };
}

function runIdOf(run) {
  return String(run?.runId || run?.run_id || run?.id || "");
}

function sessionIdOf(run) {
  return String(run?.sessionId || run?.session_id || "");
}

function runStatusOf(run) {
  return String(run?.status || run?.event || "").toLowerCase();
}

function normalizeTimestamp(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return number < 10_000_000_000 ? number * 1000 : number;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function lifecycleEvent(payload = {}, eventName = "") {
  return {
    type: "run.lifecycle",
    event: String(payload.event || eventName || payload.status || "run.updated"),
    status: String(payload.status || ""),
    runId: runIdOf(payload),
    sessionId: sessionIdOf(payload),
    timestamp: normalizeTimestamp(payload.timestamp || payload.updatedAt || payload.updated_at),
    progress: Number(payload.progress),
    tool: payload.tool || payload.toolName || payload.tool_name,
    output: payload.output,
    error: payload.error,
    choices: payload.choices,
  };
}

function enrichOrgWithRuns(org, runs = []) {
  const latestBySession = new Map();
  for (const run of runs) {
    const sessionId = sessionIdOf(run);
    if (!sessionId) continue;
    const existing = latestBySession.get(sessionId);
    const updated = normalizeTimestamp(run.updatedAt || run.updated_at || run.timestamp);
    const existingUpdated = existing ? normalizeTimestamp(existing.updatedAt || existing.updated_at || existing.timestamp) : -1;
    if (!existing || updated >= existingUpdated) latestBySession.set(sessionId, run);
  }

  for (const floor of org.floors || []) {
    for (const agent of floor.agents || []) {
      if (!Number.isFinite(Number(agent.progress))) agent.progress = 0;
      const run = latestBySession.get(String(agent.sessionId || agent.agentId || ""));
      if (!run) continue;
      const status = runStatusOf(run);
      agent.runId = runIdOf(run);
      agent.running = !TERMINAL_RUN_STATES.has(status);
      if (status === "waiting_for_approval") agent.status = "approval";
      else if (status === "failed") agent.status = "escalated";
      else if (TERMINAL_RUN_STATES.has(status)) agent.status = "offline";
      else if (["queued", "starting"].includes(status)) agent.status = "waiting";
      else if (status) agent.status = "working";
    }
  }
  return org;
}

class RuntimeHermesAdapter {
  constructor({ onEvent, onConnection }) {
    this.onEvent = onEvent;
    this.onConnection = onConnection;
  }

  start() {
    this.onConnection?.("runtime");
    this.onEvent?.({ type: "org.demo", reason: "runtime-mode" });
  }

  stop() {}
}

class LiveHermesAdapter {
  constructor({ config, onEvent, onConnection }) {
    this.config = config;
    this.onEvent = onEvent;
    this.onConnection = onConnection;
    this.timer = null;
    this.stopped = true;
    this.inFlight = false;
    this.streams = new Map();
    this.onRefresh = () => this.tick();
    this.onRun = (event) => {
      const detail = event?.detail || {};
      if (detail.runId) this.subscribeRun(detail.runId, detail.sessionId);
      this.tick();
    };
    this.onMode = (event) => {
      const mode = String(event?.detail?.mode || "").toLowerCase();
      if (mode === "runtime" || mode === "demo") this.stop();
    };
  }

  start() {
    this.stopped = false;
    this.onConnection?.("connecting");
    this.onEvent?.({
      type: "org.snapshot",
      org: { floors: [], tokenUsage: 0, tokenLimit: 10_000_000, fetchedAt: Date.now() },
      pruneEmpty: true,
    });
    window.addEventListener("hermes-agent-os:refresh", this.onRefresh);
    window.addEventListener("hermes-agent-os:run", this.onRun);
    window.addEventListener("hermes-agent-os:mode", this.onMode);
    this.tick();
    this.timer = window.setInterval(() => this.tick(), this.config.pollMs);
  }

  async tick() {
    if (this.stopped || this.inFlight) return;
    this.inFlight = true;
    try {
      const snapshot = await fetchHermesSnapshot();
      if (this.stopped) return;
      if (!snapshot?.ok) {
        this.onConnection?.("offline");
        this.onEvent?.({
          type: "org.error",
          message: snapshot?.error || "Hermes snapshot failed.",
          code: snapshot?.code,
        });
        return;
      }
      const runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];
      const org = enrichOrgWithRuns(snapshot.org || projectHermesSnapshot(snapshot), runs);
      this.onConnection?.("live");
      this.onEvent?.({ type: "org.snapshot", org, pruneEmpty: true });
      for (const run of runs) {
        const status = runStatusOf(run);
        if (!TERMINAL_RUN_STATES.has(status)) this.subscribeRun(runIdOf(run), sessionIdOf(run));
      }
    } catch (error) {
      if (this.stopped) return;
      this.onConnection?.("offline");
      this.onEvent?.({
        type: "org.error",
        message: error instanceof Error ? error.message : "Hermes sync failed.",
      });
    } finally {
      this.inFlight = false;
    }
  }

  subscribeRun(runId, sessionId = "") {
    if (this.stopped || !runId || this.streams.has(runId)) return;
    const source = new EventSource(`/api/os/runs/${encodeURIComponent(runId)}/events`);
    const handle = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const normalized = lifecycleEvent(
          { ...payload, runId: runIdOf(payload) || runId, sessionId: sessionIdOf(payload) || sessionId },
          event.type === "message" ? "" : event.type,
        );
        this.onEvent?.(normalized);
        const terminal = TERMINAL_RUN_STATES.has(runStatusOf(payload)) || normalized.event.startsWith("run.completed") || normalized.event.startsWith("run.failed") || normalized.event.startsWith("run.cancelled");
        if (terminal) {
          source.close();
          this.streams.delete(runId);
          this.tick();
        }
      } catch {
        this.onEvent?.({ type: "org.error", message: `Invalid run event received for ${runId}.` });
      }
    };
    source.onmessage = handle;
    for (const name of [
      "run.status",
      "run.started",
      "message.delta",
      "tool.started",
      "tool.completed",
      "approval.request",
      "approval.responded",
      "run.completed",
      "run.failed",
      "run.cancelled",
    ]) {
      source.addEventListener(name, handle);
    }
    source.onerror = async () => {
      if (this.stopped) return;
      const status = await fetchHermesRun(runId);
      if (status?.ok) {
        this.onEvent?.(lifecycleEvent({ ...status, runId, sessionId: status.sessionId || sessionId }));
        if (TERMINAL_RUN_STATES.has(runStatusOf(status))) {
          source.close();
          this.streams.delete(runId);
          this.tick();
        }
      }
    };
    this.streams.set(runId, source);
  }

  stop() {
    this.stopped = true;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("hermes-agent-os:refresh", this.onRefresh);
    window.removeEventListener("hermes-agent-os:run", this.onRun);
    window.removeEventListener("hermes-agent-os:mode", this.onMode);
    for (const source of this.streams.values()) source.close();
    this.streams.clear();
  }
}

export function createHermesAdapter({ config, onEvent, onConnection } = {}) {
  const resolved = normalizeConfig(config);
  if (resolved.mode === "live" && resolved.configured) {
    return new LiveHermesAdapter({ config: resolved, onEvent, onConnection });
  }
  return new RuntimeHermesAdapter({ onEvent, onConnection });
}
