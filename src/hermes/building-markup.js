// @ts-nocheck
import { FLOOR_THEMES } from "./data.js";
import { icon, pixelPerson } from "./pixel-art.js";

const DEPARTMENT_ICONS = {
  HR: "hr",
  Operations: "operations",
  Finance: "finance",
  Sales: "sales",
  "Content Review": "document",
  SEO: "search",
  Marketing: "megaphone",
  "Customer Support": "support",
  Engineering: "operations",
  "Engineering Annex": "operations",
  Research: "search",
  Browser: "search",
  Automation: "clock",
  CLI: "operations",
  Telegram: "mail",
  Discord: "megaphone",
  Slack: "mail",
  Memory: "knowledge",
  Skills: "knowledge",
  Content: "document",
  "API Server": "activity",
};

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&" + "amp;")
    .replaceAll("<", "&" + "lt;")
    .replaceAll(">", "&" + "gt;")
    .replaceAll('"', "&" + "quot;")
    .replaceAll("'", "&#039;");
}

export function shortTask(value, max = 18) {
  const text = String(value || "Idle");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function departmentIcon(department, theme) {
  return icon(DEPARTMENT_ICONS[department] || "overview", 18);
}

export function facadeAgents(floor, floors) {
  const agents = Array.isArray(floor?.agents) ? [...floor.agents] : [];
  const spawnedFromHere = new Set(
    (floors || []).filter((item) => item.spawnedByFloorId === floor.id).map((item) => item.spawnedByAgentId),
  );
  const spawners = agents.filter((agent) => spawnedFromHere.has(agent.id));
  const rest = agents.filter((agent) => !spawnedFromHere.has(agent.id));
  return [...spawners, ...rest].slice(0, 12);
}

function statusTone(status) {
  if (status === "approval") return "#f2aa17";
  if (status === "escalated") return "#e9414d";
  if (status === "waiting") return "#2785ee";
  if (status === "offline") return "#8792a4";
  return "#28b45e";
}

function floorStats(floor) {
  const agents = floor.agents || [];
  const approvals = agents.filter((agent) => agent.status === "approval").length;
  const escalated = agents.filter((agent) => agent.status === "escalated").length;
  const working = agents.filter((agent) => agent.status === "working").length;
  const parts = [`${agents.length} agents`, `${floor.openTasks ?? working} tasks`];
  if (approvals) parts.push(`${approvals} review`);
  if (escalated) parts.push(`${escalated} urgent`);
  return parts.join(" · ");
}

export function renderFloorsHTML(floors, selectedFloorId, lastNewFloorId, selectedAgentId) {
  const list = Array.isArray(floors) ? floors : [];
  if (!list.length) return "";
  const selected = selectedFloorId || list.find((floor) => floor.id === "engineering")?.id || list[0]?.id;
  return [...list]
    .sort((a, b) => b.number - a.number)
    .map((floor) => {
      const theme = FLOOR_THEMES[floor.theme] || FLOOR_THEMES.violet;
      const isSelected = floor.id === selected;
      const visibleAgents = facadeAgents(floor, list);
      const hasPriority = (floor.agents || []).some((agent) => agent.status === "approval" || agent.status === "escalated");
      const miniAgents = visibleAgents.length
        ? visibleAgents
            .map((agent) => {
              const active = agent.id === selectedAgentId;
              const tone = statusTone(agent.status);
              return `
          <button class="workstation facade-station ${active ? "is-selected" : ""} status-${escapeHTML(agent.status)}" type="button" data-agent-id="${escapeHTML(agent.id)}" style="--status-color:${tone}" title="${escapeHTML(agent.name)} · ${escapeHTML(agent.role)} · ${escapeHTML(agent.task)}">
            <span class="task-bubble"><i class="task-bubble-dot"></i>${escapeHTML(shortTask(agent.task, 22))}</span>
            <span class="station-body">
              <i class="chair"></i>
              <span class="agent-seat">${pixelPerson(agent)}</span>
              <span class="desk-top">
                <i class="desk-plant"></i>
                <span class="computer-button"></span>
                <i class="keyboard"></i>
                <i class="desk-mug"></i>
              </span>
            </span>
          </button>`;
            })
            .join("")
        : '<span class="workstation facade-station is-empty"><span class="task-bubble">Empty pod</span></span>';
      const spawnNote = floor.spawnedByName
        ? `<em class="floor-spawn-note">Spawned by ${escapeHTML(floor.spawnedByName)}</em>`
        : "";

      return `
      <div class="floor-module ${isSelected ? "is-selected" : ""} ${floor.id === lastNewFloorId ? "is-new" : ""}"
        data-floor-id="${escapeHTML(floor.id)}"
        style="--floor-color:${theme.floor};--floor-window:${theme.window};--spawn-shirt:${floor.spawnedByShirt || theme.floor}">
        <span class="floor-window">
          ${floor.spawnedByName ? `<span class="spawn-plaque"><small>SPAWNED BY</small><strong>${escapeHTML(floor.spawnedByName)}</strong></span>` : ""}
          <span class="office-set" aria-hidden="true"><i class="office-shelf"></i><i class="office-art"></i><i class="office-plant"></i></span>
          <span class="mini-agent-row" data-count="${visibleAgents.length}">${miniAgents}</span>
        </span>
        <span class="floor-label">
          <span class="floor-icon">${departmentIcon(floor.department, floor.theme)}</span>
          <span class="floor-copy"><strong>${escapeHTML(floor.department)}</strong><small>${escapeHTML(floorStats(floor))}</small>${spawnNote}</span>
          <span class="floor-status-column"><i class="floor-health-dot ${hasPriority ? "is-pending" : ""}"></i></span>
        </span>
      </div>`;
    })
    .join("");
}

