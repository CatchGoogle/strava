import type { Activity, Slice, TrackPoint } from "./types";

const EARTH = 6371000;

export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

function smooth(values: number[], radius: number): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const w = radius + 1 - Math.abs(k);
      acc += values[j] * w;
      wsum += w;
    }
    out[i] = acc / wsum;
  }
  return out;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function inferDiscipline(distanceM: number, movingS: number): string {
  if (movingS <= 0 || distanceM <= 0) return "ACTIVITY";
  const speed = distanceM / movingS;
  if (speed > 5) return "RIDE";
  if (speed > 2.15) return "RUN";
  if (speed > 0.7) return "WALK";
  return "ACTIVITY";
}

export function analyze(
  segments: Omit<TrackPoint, "gap">[][],
  meta: { id: string; name: string; source: Activity["source"]; fileName: string | null },
): Activity {
  const cleaned: Omit<TrackPoint, "gap">[][] = [];
  for (const seg of segments) {
    const pts = seg.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (!pts.length) continue;
    cleaned.push(pts.length > 1800 ? decimate(pts) : pts);
  }
  if (!cleaned.length || cleaned.reduce((n, s) => n + s.length, 0) < 2) {
    throw new Error("This file doesn't contain a route.");
  }

  const points: TrackPoint[] = [];
  for (const seg of cleaned) {
    const lats = smooth(
      seg.map((p) => p.lat),
      1,
    );
    const lons = smooth(
      seg.map((p) => p.lon),
      1,
    );
    const eles = seg.map((p) => p.ele);
    const hasEle = eles.some((e) => e != null && Number.isFinite(e));
    const eleFilled = eles.map((e, i) => {
      if (e != null && Number.isFinite(e)) return e;
      for (let k = 1; k < eles.length; k++) {
        const a = eles[i - k];
        const b = eles[i + k];
        if (a != null && Number.isFinite(a)) return a;
        if (b != null && Number.isFinite(b)) return b;
      }
      return 0;
    });
    const eleSmooth = hasEle ? smooth(eleFilled, 2) : eleFilled;
    seg.forEach((p, i) => {
      points.push({
        lat: lats[i],
        lon: lons[i],
        ele: hasEle ? eleSmooth[i] : null,
        time: p.time,
        hr: p.hr,
        gap: i === 0 && points.length > 0,
      });
    });
  }

  const n = points.length;
  const cumDist = new Array<number>(n).fill(0);
  const cumMoving = new Array<number>(n).fill(0);
  const cumGain = new Array<number>(n).fill(0);
  const cumHrSum = new Array<number>(n).fill(0);
  const cumHrN = new Array<number>(n).fill(0);
  const instant = new Array<number>(n).fill(0);

  const timed = points.filter((p) => p.time != null).length > n * 0.6;

  let hrSum = 0;
  let hrN = 0;
  if (points[0].hr != null) {
    hrSum = points[0].hr;
    hrN = 1;
  }
  cumHrSum[0] = hrSum;
  cumHrN[0] = hrN;

  for (let i = 1; i < n; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    let dist = 0;
    if (!cur.gap) dist = haversine(prev.lat, prev.lon, cur.lat, cur.lon);
    if (dist > 400) {
      cur.gap = true;
      dist = 0;
    }
    cumDist[i] = cumDist[i - 1] + dist;

    const elePrev = prev.ele;
    const eleCur = cur.ele;
    let gain = cumGain[i - 1];
    if (!cur.gap && elePrev != null && eleCur != null) {
      const dEle = eleCur - elePrev;
      if (dEle > 0.4) gain += dEle;
    }
    cumGain[i] = gain;

    let moving = cumMoving[i - 1];
    if (!cur.gap && dist > 0) {
      const t0 = prev.time;
      const t1 = cur.time;
      if (timed && t0 != null && t1 != null) {
        const dt = (t1 - t0) / 1000;
        const speed = dt > 0 ? dist / dt : 0;
        if (dt > 0 && dt < 45 && speed >= 0.45 && speed <= 30) {
          moving += dt;
          instant[i] = speed;
        }
      } else if (!timed) {
        const grade = elePrev != null && eleCur != null ? (eleCur - elePrev) / dist : 0;
        const est = clamp(3.05 * (1 - clamp(grade, -0.12, 0.14) * 3.4), 1.6, 5.2);
        moving += dist / est;
        instant[i] = est;
      }
    }
    cumMoving[i] = moving;

    if (cur.hr != null && Number.isFinite(cur.hr)) {
      hrSum += cur.hr;
      hrN += 1;
    }
    cumHrSum[i] = hrSum;
    cumHrN[i] = hrN;
  }

  if (!timed) {
    let t = Date.UTC(2026, 8, 20, 14, 0, 0);
    points[0].time = t;
    for (let i = 1; i < n; i++) {
      t += Math.max(0, cumMoving[i] - cumMoving[i - 1]) * 1000;
      points[i].time = t;
    }
  }

  const hrRoll = rollingHeartRate(points);

  const speed = smooth(instant, 4);
  for (let i = 1; i < n; i++) {
    if (speed[i] <= 0) speed[i] = speed[i - 1];
  }
  const movingSpeeds = speed.filter((s) => s > 0.5);
  const speedLo = percentile(movingSpeeds, 0.12);
  const speedHi = Math.max(speedLo + 0.4, percentile(movingSpeeds, 0.9));

  const elevs = points.map((p) => p.ele).filter((e): e is number => e != null);
  let eleLo = 0;
  let eleHi = 1;
  if (elevs.length) {
    eleLo = elevs[0];
    eleHi = elevs[0];
    for (const e of elevs) {
      if (e < eleLo) eleLo = e;
      if (e > eleHi) eleHi = e;
    }
    if (eleHi < eleLo + 1) eleHi = eleLo + 1;
  }

  const distanceM = cumDist[n - 1];
  const movingTimeS = cumMoving[n - 1];
  const start = points.find((p) => p.time != null)?.time ?? null;
  const end = [...points].reverse().find((p) => p.time != null)?.time ?? start;
  const elapsedTimeS = start != null && end != null ? Math.max(movingTimeS, (end - start) / 1000) : movingTimeS;
  const loop = haversine(points[0].lat, points[0].lon, points[n - 1].lat, points[n - 1].lon) < 35;

  return {
    id: meta.id,
    name: meta.name,
    source: meta.source,
    fileName: meta.fileName,
    points,
    distanceM,
    gainM: cumGain[n - 1],
    movingTimeS,
    elapsedTimeS,
    start,
    hasHeartRate: hrN > 8,
    hasElevation: elevs.length > n * 0.5,
    timing: timed ? "recorded" : "estimated",
    discipline: inferDiscipline(distanceM, movingTimeS),
    loop,
    cumDist,
    cumMoving,
    cumGain,
    cumHrSum,
    cumHrN,
    hrRoll,
    speed,
    speedLo,
    speedHi,
    eleLo,
    eleHi,
  };
}

/** A few seconds of heart rate behind the point, so the readout tracks effort instead of the whole activity. */
const HR_WINDOW_MS = 12_000;

function rollingHeartRate(points: TrackPoint[]): number[] {
  const n = points.length;
  const out = new Array<number>(n).fill(Number.NaN);
  let left = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const hr = points[i].hr;
    if (hr != null && Number.isFinite(hr)) {
      sum += hr;
      count += 1;
    }
    const t = points[i].time;
    while (t != null && left < i) {
      const earlier = points[left].time;
      if (earlier == null || t - earlier <= HR_WINDOW_MS) break;
      const old = points[left].hr;
      if (old != null && Number.isFinite(old)) {
        sum -= old;
        count -= 1;
      }
      left += 1;
    }
    if (count > 0) out[i] = sum / count;
  }
  return out;
}

export function heartRateAt(activity: Activity, distanceM: number): number | null {
  if (!activity.hasHeartRate) return null;
  const { cumDist, hrRoll } = activity;
  const target = clamp(distanceM, 0, activity.distanceM);
  let lo = 0;
  let hi = cumDist.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (cumDist[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const j = Math.min(cumDist.length - 1, i + 1);
  const span = cumDist[j] - cumDist[i];
  const f = j === i || span <= 0 ? 0 : clamp((target - cumDist[i]) / span, 0, 1);
  const a = hrRoll[i];
  const b = hrRoll[j];
  const aOk = Number.isFinite(a);
  const bOk = Number.isFinite(b);
  if (!aOk && !bOk) return null;
  if (!aOk) return b;
  if (!bOk) return a;
  return a + (b - a) * f;
}

export function sliceStats(activity: Activity, distanceM: number): Slice {
  const { cumDist, cumMoving, cumGain, cumHrSum, cumHrN } = activity;
  const target = clamp(distanceM, 0, activity.distanceM);
  if (target <= 0) {
    return { distanceM: 0, movingTimeS: 0, gainM: 0, avgHr: null };
  }
  let lo = 0;
  let hi = cumDist.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (cumDist[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const j = Math.min(cumDist.length - 1, i + 1);
  const span = cumDist[j] - cumDist[i];
  const f = j === i || span <= 0 ? 0 : clamp((target - cumDist[i]) / span, 0, 1);
  const lerp = (a: number, b: number) => a + (b - a) * f;
  const hrSum = lerp(cumHrSum[i], cumHrSum[j]);
  const hrCount = lerp(cumHrN[i], cumHrN[j]);
  return {
    distanceM: target,
    movingTimeS: lerp(cumMoving[i], cumMoving[j]),
    gainM: lerp(cumGain[i], cumGain[j]),
    avgHr: hrCount > 4 ? hrSum / hrCount : null,
  };
}

export type Split = { startM: number; endM: number; speed: number };

const splitCache = new WeakMap<Activity, Map<number, { splits: Split[]; unitM: number }>>();

/** Per-unit moving speed. Widens the unit on long activities so the chart stays readable. */
export function computeSplits(activity: Activity, baseUnitM: number): { splits: Split[]; unitM: number } {
  let perActivity = splitCache.get(activity);
  if (!perActivity) {
    perActivity = new Map();
    splitCache.set(activity, perActivity);
  }
  const hit = perActivity.get(baseUnitM);
  if (hit) return hit;

  const unitM = baseUnitM * Math.max(1, Math.ceil(activity.distanceM / baseUnitM / 32));
  const splits: Split[] = [];
  for (let start = 0; start < activity.distanceM - 1; start += unitM) {
    const end = Math.min(activity.distanceM, start + unitM);
    if (splits.length && end - start < unitM * 0.12) break;
    const t = sliceStats(activity, end).movingTimeS - sliceStats(activity, start).movingTimeS;
    splits.push({ startM: start, endM: end, speed: (end - start) / Math.max(t, 0.5) });
  }
  const out = { splits, unitM };
  perActivity.set(baseUnitM, out);
  return out;
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function decimate(seg: Omit<TrackPoint, "gap">[]): Omit<TrackPoint, "gap">[] {
  let minMeters = 8;
  let best = seg;
  while (best.length > 4200 && minMeters <= 36) {
    const out = [seg[0]];
    for (let i = 1; i < seg.length - 1; i++) {
      const last = out[out.length - 1];
      const d = haversine(last.lat, last.lon, seg[i].lat, seg[i].lon);
      if (d >= minMeters) out.push(seg[i]);
    }
    out.push(seg[seg.length - 1]);
    best = out;
    minMeters += 6;
  }
  return best;
}
