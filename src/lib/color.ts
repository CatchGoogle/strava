import type { Theme } from "./types";

const rgbCache = new Map<string, [number, number, number]>();

function rgb(hex: string): [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  const h = hex.replace("#", "");
  const out: [number, number, number] = [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
  rgbCache.set(hex, out);
  return out;
}

export function mixHex(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  const u = clamp01(t);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * u));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function withAlpha(hex: string, alpha: number): string {
  const c = rgb(hex);
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${clamp01(alpha)})`;
}

export function rampColor(theme: Theme, t: number): string {
  const u = clamp01(t);
  if (u < 0.5) return mixHex(theme.ramp[0], theme.ramp[1], u * 2);
  return mixHex(theme.ramp[1], theme.ramp[2], (u - 0.5) * 2);
}

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export const THEMES: Theme[] = [
  {
    id: "ember",
    name: "Ember",
    mode: "dark",
    bg: "#3a2218",
    spot: "rgba(255, 196, 87, 0.34)",
    spot2: "rgba(255, 122, 69, 0.22)",
    vignette: "rgba(90, 36, 18, 0.22)",
    ink: "#fff6ea",
    muted: "#f0d2bc",
    faint: "rgba(255, 246, 234, 0.18)",
    grid: "rgba(255, 220, 180, 0.2)",
    ramp: ["#ffd166", "#ff7a45", "#ffe0c8"],
    glow: "#ff8a4c",
    glowAlpha: 0.85,
    coreMix: 0.62,
    frame: "rgba(246, 241, 232, 0.18)",
  },
  {
    id: "voltage",
    name: "Voltage",
    mode: "dark",
    bg: "#243018",
    spot: "rgba(255, 214, 90, 0.3)",
    spot2: "rgba(140, 210, 80, 0.22)",
    vignette: "rgba(36, 48, 16, 0.2)",
    ink: "#f7ffe8",
    muted: "#d7ecb0",
    faint: "rgba(247, 255, 232, 0.18)",
    grid: "rgba(220, 255, 140, 0.2)",
    ramp: ["#9be15d", "#ffe66d", "#fff6c8"],
    glow: "#ffe66d",
    glowAlpha: 0.8,
    coreMix: 0.55,
    frame: "rgba(214, 255, 74, 0.28)",
  },
  {
    id: "noir",
    name: "Noir",
    mode: "dark",
    bg: "#2a241c",
    spot: "rgba(255, 206, 140, 0.22)",
    spot2: "rgba(255, 160, 90, 0.12)",
    vignette: "rgba(48, 32, 16, 0.22)",
    ink: "#fff8f0",
    muted: "#e4d2be",
    faint: "rgba(255, 248, 240, 0.16)",
    grid: "rgba(255, 230, 200, 0.16)",
    ramp: ["#e8b86d", "#fff1dc", "#ffffff"],
    glow: "#ffd7a8",
    glowAlpha: 0.55,
    coreMix: 0.4,
    frame: "rgba(255, 255, 255, 0.2)",
  },
  {
    id: "tide",
    name: "Tide",
    mode: "dark",
    bg: "#14545c",
    spot: "rgba(255, 214, 120, 0.26)",
    spot2: "rgba(94, 224, 208, 0.22)",
    vignette: "rgba(12, 60, 64, 0.2)",
    ink: "#f3fffb",
    muted: "#c9f3ea",
    faint: "rgba(243, 255, 251, 0.18)",
    grid: "rgba(190, 245, 236, 0.2)",
    ramp: ["#2ec4b6", "#ffd166", "#fff3c4"],
    glow: "#7eefe0",
    glowAlpha: 0.8,
    coreMix: 0.6,
    frame: "rgba(231, 246, 244, 0.18)",
  },
  {
    id: "poster",
    name: "Poster",
    mode: "light",
    bg: "#fff3df",
    spot: "rgba(255, 186, 72, 0.28)",
    spot2: "rgba(255, 248, 230, 0.85)",
    vignette: "rgba(200, 120, 40, 0.08)",
    ink: "#3a2418",
    muted: "#8d6248",
    faint: "rgba(58, 36, 24, 0.12)",
    grid: "rgba(58, 36, 24, 0.12)",
    ramp: ["#ffb703", "#fb8500", "#e85d4c"],
    glow: "#fb8500",
    glowAlpha: 0.22,
    coreMix: 0,
    frame: "rgba(28, 20, 14, 0.2)",
  },
];

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
