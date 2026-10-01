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
    bg: "#0e0d0c",
    spot: "rgba(255, 92, 57, 0.22)",
    spot2: "rgba(48, 72, 140, 0.28)",
    vignette: "rgba(0, 0, 0, 0.55)",
    ink: "#f6f1e8",
    muted: "#a39b90",
    faint: "rgba(246, 241, 232, 0.14)",
    grid: "rgba(255, 236, 220, 0.16)",
    ramp: ["#3c4d86", "#ff5c39", "#ffe1c4"],
    glow: "#ff5c39",
    glowAlpha: 0.85,
    coreMix: 0.62,
    frame: "rgba(246, 241, 232, 0.18)",
  },
  {
    id: "voltage",
    name: "Voltage",
    mode: "dark",
    bg: "#080908",
    spot: "rgba(214, 255, 74, 0.14)",
    spot2: "rgba(20, 60, 28, 0.45)",
    vignette: "rgba(0, 0, 0, 0.58)",
    ink: "#f3ffd8",
    muted: "#9aaa86",
    faint: "rgba(243, 255, 216, 0.14)",
    grid: "rgba(214, 255, 74, 0.14)",
    ramp: ["#1b3d28", "#d6ff4a", "#f4ffd2"],
    glow: "#d6ff4a",
    glowAlpha: 0.8,
    coreMix: 0.55,
    frame: "rgba(214, 255, 74, 0.28)",
  },
  {
    id: "noir",
    name: "Noir",
    mode: "dark",
    bg: "#090909",
    spot: "rgba(255, 255, 255, 0.08)",
    spot2: "rgba(255, 255, 255, 0.04)",
    vignette: "rgba(0, 0, 0, 0.62)",
    ink: "#f7f7f5",
    muted: "#8e8e8a",
    faint: "rgba(247, 247, 245, 0.14)",
    grid: "rgba(255, 255, 255, 0.12)",
    ramp: ["#4a4a4a", "#f4f4f2", "#ffffff"],
    glow: "#ffffff",
    glowAlpha: 0.55,
    coreMix: 0.4,
    frame: "rgba(255, 255, 255, 0.2)",
  },
  {
    id: "tide",
    name: "Tide",
    mode: "dark",
    bg: "#07141c",
    spot: "rgba(62, 200, 200, 0.18)",
    spot2: "rgba(14, 40, 70, 0.55)",
    vignette: "rgba(0, 0, 0, 0.5)",
    ink: "#e7f6f4",
    muted: "#8eaeac",
    faint: "rgba(231, 246, 244, 0.14)",
    grid: "rgba(180, 230, 226, 0.14)",
    ramp: ["#0e4d5c", "#3ecfc4", "#e9fff8"],
    glow: "#3ecfc4",
    glowAlpha: 0.8,
    coreMix: 0.6,
    frame: "rgba(231, 246, 244, 0.18)",
  },
  {
    id: "poster",
    name: "Poster",
    mode: "light",
    bg: "#efe6d4",
    spot: "rgba(216, 58, 40, 0.1)",
    spot2: "rgba(255, 248, 236, 0.7)",
    vignette: "rgba(70, 42, 24, 0.16)",
    ink: "#1c140e",
    muted: "#7a6e60",
    faint: "rgba(28, 20, 14, 0.12)",
    grid: "rgba(28, 20, 14, 0.14)",
    ramp: ["#8d8274", "#1c140e", "#d83a28"],
    glow: "#d83a28",
    glowAlpha: 0.22,
    coreMix: 0,
    frame: "rgba(28, 20, 14, 0.2)",
  },
];

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
