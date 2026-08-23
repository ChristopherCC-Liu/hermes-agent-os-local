// @ts-nocheck
import { dispatchHermesAction } from "@/lib/hermes-gateway";
import { loadConnection } from "./connection.js";

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char]);
}

function showToast(root, title, message, duration = 3600) {
  const region = root.querySelector("#toast-region");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<strong>${escapeHTML(title)}</strong>${escapeHTML(message)}`;
  region.append(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 190);
  }, duration);
}

function liveConnection() {
  const connection = loadConnection();
  return connection.mode === "live" && connection.configured === true;
}

function dashboardState() {
  return window.hermesDashboard?.getState?.() || { floors: [] };
}

function findAgent({ floorId, agentId } = {}) {
  const state = dashboardState();
  for (const floor of state.floors || []) {
    if (floorId && String(floor.id) !== String(floorId)) continue;
    const agent = (floor.agents || []).find((item) =>
      !agentId || [item.id, item.agentId, item.sessionId].some((value) => String(value || "") === String(agentId)),
    );
    if (agent) return { floor, agent };
  }
  return { floor: null, agent: null };
}

function selectedAgent() {
  const state = dashboardState();
  return findAgent({ floorId: state.selectedFloorId, agentId: state.selectedAgentId });
}

function sessionIdFrom(result) {
  const payload = result?.data || {};
  const session = payload.session || payload.data || payload;
  return String(session.id || session.session_id || session.sessionId || "");
}

function runFrom(result, fallbackSessionId) {
  const payload = result?.data || {};
  const run = payload.run || payload.data || payload;
  return {
    runId: String(run.runId || run.run_id || run.id || ""),
    sessionId: String(run.sessionId || run.session_id || fallbackSessionId || ""),
  };
}

function announceRun(run) {
  if (!run.runId) return;
  window.dispatchEvent(new CustomEvent("hermes-agent-os:run", { detail: run }));
}

async function startRun({ sessionId, input }) {
  const result = await dispatchHermesAction({
    data: { action: "chat", sessionId, input },
  });
  if (!result.ok) throw new Error(result.error || "Hermes run could not start.");
  const run = runFrom(result, sessionId);
  if (!run.runId) throw new Error("Hermes did not return a run id.");
  announceRun(run);
  return run;
}

async function dispatchLiveTask(root, form, submitter) {
  const taskInput = form.querySelector("#dispatch-task");
  const moduleInput = form.querySelector("#dispatch-module");
  const task = String(taskInput?.value || "").trim();
  const moduleName = String(moduleInput?.value || "Hermes").trim();
  if (!task || !moduleName) {
    form.reportValidity();
    return;
  }

  if (submitter) submitter.disabled = true;
  try {
    const created = await dispatchHermesAction({
      data: { action: "create_session", title: task.slice(0, 120) },
    });
    if (!created.ok) throw new Error(created.error || "Hermes session could not be created.");
    const sessionId = sessionIdFrom(created);
    if (!sessionId) throw new Error("Hermes did not return a session id.");
    const run = await startRun({ sessionId, input: task });
    form.closest("dialog")?.close();
    showToast(root, "Hermes run started", `${moduleName} · ${run.runId.slice(0, 18)}`);
    window.dispatchEvent(new Event("hermes-agent-os:refresh"));
  } catch (error) {
    showToast(root, "Dispatch failed", error instanceof Error ? error.message : "Hermes dispatch failed.", 5200);
  } finally {
    if (submitter) submitter.disabled = false;
  }
}

async function runOrStopSelected(root) {
  const { agent } = selectedAgent();
  if (!agent?.sessionId) {
    showToast(root, "Live session required", "Select a real Hermes session before running work.");
    return;
  }
  try {
    if (agent.running && agent.runId) {
      const stopped = await dispatchHermesAction({ data: { action: "stop_run", runId: agent.runId } });
      if (!stopped.ok) throw new Error(stopped.error || "Hermes run could not be stopped.");
      showToast(root, "Stop requested", `${agent.name} is stopping.`);
      announceRun({ runId: agent.runId, sessionId: agent.sessionId });
      return;
    }
    const run = await startRun({ sessionId: agent.sessionId, input: agent.task || "Continue this Hermes session." });
    showToast(root, "Hermes run started", `${agent.name} · ${run.runId.slice(0, 18)}`);
  } catch (error) {
    showToast(root, "Hermes action failed", error instanceof Error ? error.message : "Hermes action failed.", 5200);
  }
}

async function resolveApproval(root, target) {
  const { agent } = findAgent({ floorId: target.dataset.resolveFloor, agentId: target.dataset.resolveAgent });
  if (!agent?.runId) {
    showToast(root, "No live approval", "This item is not backed by an active Hermes approval.");
    return;
  }
  const result = await dispatchHermesAction({
    data: { action: "approve_run", runId: agent.runId, decision: "approve" },
  });
  if (!result.ok) {
    showToast(root, "Approval failed", result.error || "Hermes did not accept the approval.", 5200);
    return;
  }
  showToast(root, "Approved in Hermes", `${agent.name} is continuing the real run.`);
  announceRun({ runId: agent.runId, sessionId: agent.sessionId });
}

export function mountRuntimeBridge(root) {
  if (!(root instanceof HTMLElement)) return () => {};

  const onSubmit = (event) => {
    if (!liveConnection() || event.target?.id !== "dispatch-form") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void dispatchLiveTask(root, event.target, event.submitter);
  };

  const onClick = (event) => {
    if (!liveConnection()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const resolve = target.closest("[data-resolve-agent]");
    if (resolve) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void resolveApproval(root, resolve);
      return;
    }

    const action = target.closest("[data-action]")?.dataset.action;
    if (action === "run-task") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void runOrStopSelected(root);
      return;
    }
    if (action === "request-approval") {
      event.preventDefault();
      event.stopImmediatePropagation();
      showToast(root, "Hermes owns approvals", "This control updates only when a real Hermes tool requests approval.");
      return;
    }

    const demoOnly = target.closest(
      "#build-floor-button, [data-action='open-module'], #add-agent-button, #remove-agent-button, #approval-event-button, #error-event-button",
    );
    if (demoOnly) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showToast(root, "Unavailable in Live Hermes", "This local simulation control is available in Demo mode only.");
    }
  };

  root.addEventListener("submit", onSubmit, true);
  root.addEventListener("click", onClick, true);
  return () => {
    root.removeEventListener("submit", onSubmit, true);
    root.removeEventListener("click", onClick, true);
  };
}
