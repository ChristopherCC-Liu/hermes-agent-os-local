// @ts-nocheck
export const POD_CAPACITY = 12;
export const BASE_OFFICE_WIDTH = 960;
export const BASE_OFFICE_HEIGHT = 640;

// A deterministic center-out seat order. Existing agents keep their seat index
// as a Pod grows; new employees occupy the next free workstation.
const STABLE_SEATS = [
  { x: 370, y: 380, row: 1, column: 1 },
  { x: 590, y: 380, row: 1, column: 2 },
  { x: 370, y: 210, row: 0, column: 1 },
  { x: 590, y: 210, row: 0, column: 2 },
  { x: 370, y: 550, row: 2, column: 1 },
  { x: 590, y: 550, row: 2, column: 2 },
  { x: 150, y: 380, row: 1, column: 0 },
  { x: 810, y: 380, row: 1, column: 3 },
  { x: 150, y: 210, row: 0, column: 0 },
  { x: 810, y: 210, row: 0, column: 3 },
  { x: 150, y: 550, row: 2, column: 0 },
  { x: 810, y: 550, row: 2, column: 3 },
];

export function resolveSeatLayout(count) {
  const safeCount = Math.max(0, Math.min(POD_CAPACITY, Math.floor(Number(count) || 0)));
  return STABLE_SEATS.slice(0, safeCount).map((seat, index) => ({ ...seat, seatIndex: index }));
}

export function partitionAgents(agents) {
  const source = Array.isArray(agents) ? agents : [];
  if (source.length === 0) return [[]];
  const pods = [];
  for (let index = 0; index < source.length; index += POD_CAPACITY) {
    pods.push(source.slice(index, index + POD_CAPACITY));
  }
  return pods;
}

export function clampPodIndex(index, podCount) {
  const count = Math.max(1, Math.floor(Number(podCount) || 1));
  return Math.max(0, Math.min(count - 1, Math.floor(Number(index) || 0)));
}
