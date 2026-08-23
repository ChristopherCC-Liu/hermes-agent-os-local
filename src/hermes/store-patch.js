import { DashboardStore } from "./store.js";

DashboardStore.prototype.applyOrgSnapshot = function applyLiveSnapshot(org) {
  if (!org || !Array.isArray(org.floors)) return;
  const nextFloors = org.floors.map((floor, index) => ({ ...floor, number: index + 1 }));
  this.state.floors = nextFloors;
  if (Number.isFinite(Number(org.tokenUsage))) this.state.tokenUsage = Number(org.tokenUsage);
  if (Number.isFinite(Number(org.tokenLimit))) this.state.tokenLimit = Number(org.tokenLimit);
  this.state.lastSyncAt = org.fetchedAt || Date.now();
  this.state.lastError = null;
  this.state.selectedFloorId = nextFloors[0]?.id || null;
  this.state.selectedAgentId = nextFloors[0]?.agents?.[0]?.id || null;
  this.state.detailsOpen = Boolean(this.state.selectedAgentId);
  this.emit();
};
