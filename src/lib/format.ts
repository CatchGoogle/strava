import type { FormatId, Units } from "./types";

export const FORMATS: Record<FormatId, { w: number; h: number; label: string; hint: string }> = {
  story: { w: 1080, h: 1920, label: "Story", hint: "9:16" },
  portrait: { w: 1080, h: 1350, label: "Portrait", hint: "4:5" },
  square: { w: 1080, h: 1080, label: "Square", hint: "1:1" },
  landscape: { w: 1920, h: 1080, label: "Wide", hint: "16:9" },
};

export function formatDistance(meters: number, units: Units): string {
  const v = units === "mi" ? meters / 1609.344 : meters / 1000;
  return v.toFixed(2);
}

export function distanceLabel(units: Units): string {
  return units === "mi" ? "MI" : "KM";
}

export function paceLabel(units: Units): string {
  return units === "mi" ? "/MI" : "/KM";
}

export function gainLabel(units: Units): string {
  return units === "mi" ? "FT GAIN" : "M GAIN";
}

export function formatGain(meters: number, units: Units): string {
  const v = units === "mi" ? meters * 3.28084 : meters;
  return Math.round(v).toLocaleString("en-US");
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(ss)}`;
  return `${m}:${pad(ss)}`;
}

export function formatSpeed(distanceM: number, movingS: number, units: Units): string {
  if (distanceM < 20 || movingS <= 0) return "–";
  const mps = distanceM / movingS;
  const v = units === "mi" ? mps * 2.23694 : mps * 3.6;
  return v.toFixed(1);
}

export function speedLabel(units: Units): string {
  return units === "mi" ? "MPH" : "KM/H";
}

export function formatPace(distanceM: number, movingS: number, units: Units): string {
  const dist = units === "mi" ? distanceM / 1609.344 : distanceM / 1000;
  if (dist < 0.05 || movingS <= 0) return "–";
  let sec = movingS / dist;
  let m = Math.floor(sec / 60);
  let s = Math.round(sec % 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatClock(ms: number | null): string {
  if (ms == null) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatKicker(ms: number | null): string {
  if (ms == null) return "ACTIVITY";
  const d = new Date(ms);
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatVideoTime(timeline: number, durationS: number): string {
  const s = Math.min(durationS, Math.max(0, timeline * durationS));
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export function slug(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "activity";
}
