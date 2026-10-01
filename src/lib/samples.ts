import { analyze, haversine } from "./activity";
import { BRIDGES_ROUTE, PARK_ROUTE, TAM_ROUTE } from "./sampleData";
import type { Activity, TrackPoint } from "./types";

type Raw = Omit<TrackPoint, "gap">;

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

function smooth(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -radius; k <= radius; k++) {
      const v = values[i + k];
      if (v === undefined) continue;
      sum += v;
      n++;
    }
    return sum / n;
  });
}

/**
 * The elevation source is a surface model, so rooftops and tree canopy show up as narrow spikes.
 * A running minimum removes anything narrower than the window and leaves broad terrain alone.
 */
function despike(values: number[], radius: number): number[] {
  if (radius <= 0) return values;
  const floor = values.map((_, i) => {
    let m = Infinity;
    for (let k = -radius; k <= radius; k++) {
      const v = values[i + k];
      if (v !== undefined && v < m) m = v;
    }
    return m;
  });
  return smooth(floor, Math.ceil(radius / 2));
}

function build(
  route: [number, number, number][],
  opts: {
    id: string;
    name: string;
    start: Date;
    eleSmooth: number;
    despike?: number;
    speed: (grade: number, t: number) => number;
    hr?: (grade: number, t: number) => number;
  },
): Activity {
  const ele = smooth(
    despike(
      route.map((p) => p[2]),
      opts.despike ?? 0,
    ),
    opts.eleSmooth,
  );
  const points: Raw[] = [];
  let time = opts.start.getTime();
  for (let i = 0; i < route.length; i++) {
    const t = i / (route.length - 1);
    let grade = 0;
    if (i > 0) {
      const step = haversine(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]);
      grade = step > 0.5 ? clamp((ele[i] - ele[i - 1]) / step, -0.2, 0.2) : 0;
      time += (step / Math.max(0.8, opts.speed(grade, t))) * 1000;
    }
    points.push({
      lat: route[i][0],
      lon: route[i][1],
      ele: ele[i],
      time,
      hr: opts.hr ? Math.round(opts.hr(grade, t)) : null,
    });
  }
  return analyze([points], { id: opts.id, name: opts.name, source: "sample", fileName: null });
}

const park = build(PARK_ROUTE, {
  id: "sample-park",
  name: "Central Park Loop",
  start: new Date(2026, 8, 20, 7, 12, 0),
  eleSmooth: 3,
  despike: 10,
  speed: (grade, t) => 3.2 * (1 - clamp(grade, -0.08, 0.1) * 4.2) * (0.94 + 0.08 * Math.sin(t * 38)),
  hr: (grade, t) => 148 + 14 * Math.sin(t * Math.PI * 3) + grade * 260 + 4 * Math.sin(t * 90),
});

const tam = build(TAM_ROUTE, {
  id: "sample-tam",
  name: "Mt. Tam Climb",
  start: new Date(2026, 8, 12, 8, 40, 0),
  eleSmooth: 4,
  speed: (grade, t) => clamp(9.5 * (1 - grade * 7), 3, 13.5) * (0.95 + 0.06 * Math.sin(t * 52)),
});

const bridges = build(BRIDGES_ROUTE, {
  id: "sample-bridges",
  name: "Two Bridges",
  start: new Date(2026, 8, 26, 18, 5, 0),
  eleSmooth: 8,
  despike: 28,
  speed: (grade, t) => 3.05 * (1 - clamp(grade, -0.06, 0.08) * 3) * (0.95 + 0.07 * Math.sin(t * 44)),
});

export const SAMPLES: Activity[] = [park, tam, bridges];

export const SAMPLE_PLACES: Record<string, string> = {
  "sample-park": "New York",
  "sample-tam": "Marin County",
  "sample-bridges": "Brooklyn",
};
