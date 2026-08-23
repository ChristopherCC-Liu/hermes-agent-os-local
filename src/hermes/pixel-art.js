// @ts-nocheck
const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  agents: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  tasks: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h5"/>',
  approvals: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-5"/>',
  analytics: '<path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-8"/>',
  knowledge: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14z"/><path d="M11.6 16.4 13 21H8l-1.2-6"/>',
  support: '<path d="M4 13a8 8 0 0 1 16 0"/><path d="M4 13v5h4v-6H4M20 13v5h-4v-6h4M16 20c-1 1-2.3 1.5-4 1.5"/>',
  hr: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M14 14h2a5 5 0 0 1 5 5v1"/>',
  operations: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  finance: '<path d="M3 9 12 3l9 6M5 10v9M9 10v9M15 10v9M19 10v9M3 21h18"/>',
  sales: '<path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/><path d="M2 21h22"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  activity: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  collapse: '<path d="m15 18-6-6 6-6"/>',
};

export function icon(name, size = 18, className = '') {
  const body = ICONS[name] ?? ICONS.overview;
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&' + 'amp;')
    .replaceAll('<', '&' + 'lt;')
    .replaceAll('>', '&' + 'gt;')
    .replaceAll('"', '&' + 'quot;')
    .replaceAll("'", '&#039;');
}

const HAIR_SHAPES = [
  '<rect x="8" y="5" width="16" height="4"/><rect x="6" y="9" width="20" height="5"/><rect x="6" y="14" width="4" height="6"/>',
  '<rect x="7" y="6" width="18" height="4"/><rect x="5" y="10" width="22" height="4"/><rect x="5" y="14" width="5" height="8"/><rect x="22" y="14" width="5" height="8"/>',
  '<rect x="9" y="4" width="14" height="4"/><rect x="6" y="8" width="20" height="5"/><rect x="7" y="13" width="4" height="4"/><rect x="21" y="13" width="4" height="4"/>',
  '<rect x="6" y="7" width="20" height="4"/><rect x="4" y="11" width="24" height="5"/><rect x="4" y="16" width="5" height="7"/><rect x="23" y="16" width="5" height="7"/>',
];

function visualSeed(agent) {
  const text = String(agent?.id || agent?.name || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}

export function pixelPerson(agent, { small = false, seated = true } = {}) {
  const visual = agent?.visual ?? {};
  const seed = visualSeed(agent);
  const hairShape = HAIR_SHAPES[(visual.hairStyle ?? seed) % HAIR_SHAPES.length];
  const hair = visual.hair ?? agent?.hair ?? "#2a1f1d";
  const skin = visual.skin ?? agent?.skin ?? "#efb37e";
  const shirt = visual.shirt ?? agent?.shirt ?? "#5d6fe8";
  const accent = visual.accent ?? "#3341a0";
  const glasses = (visual.glasses ?? seed % 5 === 0)
    ? '<rect x="8" y="15" width="6" height="4" fill="none" stroke="#182038" stroke-width="1.5"/><rect x="18" y="15" width="6" height="4" fill="none" stroke="#182038" stroke-width="1.5"/><rect x="14" y="16" width="4" height="1.5" fill="#182038"/>'
    : "";
  return `<svg class="pixel-person ${small ? "pixel-person--small" : ""} ${agent?.status === "offline" ? "is-offline" : ""}" viewBox="0 0 32 48" shape-rendering="crispEdges" role="img" aria-label="${escapeHtml(agent?.name ?? "Agent")}">
    <g fill="${hair}">${hairShape}</g>
    <rect x="8" y="12" width="16" height="13" fill="${skin}"/>
    <rect x="10" y="16" width="3" height="3" fill="#162033"/><rect x="19" y="16" width="3" height="3" fill="#162033"/>
    <rect x="14" y="21" width="4" height="1.5" fill="#9b514d"/>${glasses}
    <rect x="7" y="26" width="18" height="13" fill="${shirt}"/><rect x="12" y="26" width="8" height="4" fill="${accent}" opacity=".75"/>
    <rect x="4" y="28" width="4" height="10" fill="${skin}"/><rect x="24" y="28" width="4" height="10" fill="${skin}"/>
    ${seated
      ? '<rect x="8" y="39" width="7" height="5" fill="#202b48"/><rect x="17" y="39" width="7" height="5" fill="#202b48"/><rect x="7" y="44" width="9" height="3" fill="#11192b"/><rect x="16" y="44" width="9" height="3" fill="#11192b"/>'
      : '<rect x="8" y="39" width="6" height="7" fill="#202b48"/><rect x="18" y="39" width="6" height="7" fill="#202b48"/><rect x="7" y="46" width="8" height="2" fill="#11192b"/><rect x="17" y="46" width="8" height="2" fill="#11192b"/>'}
  </svg>`;
}

export function wingLogo() {
  return `<svg class="brand-mark" viewBox="0 0 54 44" aria-hidden="true">
    <path d="M26.5 10 18 4 4 8l11 7-9 1 12 8 8.5-6V10Z" fill="currentColor"/>
    <path d="m27.5 10 8.5-6 14 4-11 7 9 1-12 8-8.5-6V10Z" fill="currentColor"/>
    <path d="M23 23h8v16l-4 3-4-3V23Z" fill="currentColor"/>
  </svg>`;
}
