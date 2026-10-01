import type { Activity } from "./types";

export const EQUATOR_M = 40075016.686;

/** Web Mercator in [0,1]. y grows southward, the same direction as canvas y. */
export function mercator(lat: number, lon: number): { x: number; y: number } {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return {
    x: (lon + 180) / 360,
    y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI),
  };
}

export type WorldRoute = {
  /** Mercator coordinates for every point. */
  x: number[];
  y: number[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
  /** Metres represented by one mercator unit at the route's latitude. */
  metersPerUnit: number;
};

const cache = new WeakMap<Activity, WorldRoute>();

export function worldRoute(activity: Activity): WorldRoute {
  const hit = cache.get(activity);
  if (hit) return hit;
  const n = activity.points.length;
  const x = new Array<number>(n);
  const y = new Array<number>(n);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let latSum = 0;
  for (let i = 0; i < n; i++) {
    const p = activity.points[i];
    const m = mercator(p.lat, p.lon);
    x[i] = m.x;
    y[i] = m.y;
    latSum += p.lat;
    if (m.x < minX) minX = m.x;
    if (m.x > maxX) maxX = m.x;
    if (m.y < minY) minY = m.y;
    if (m.y > maxY) maxY = m.y;
  }
  const midLat = latSum / n;
  const out: WorldRoute = {
    x,
    y,
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    metersPerUnit: EQUATOR_M * Math.cos((midLat * Math.PI) / 180),
  };
  cache.set(activity, out);
  return out;
}
