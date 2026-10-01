import { computeSplits, haversine, heartRateAt, sliceStats } from "./activity";
import { clamp01, mixHex, rampColor, withAlpha } from "./color";
import {
  distanceLabel,
  formatDistance,
  formatDuration,
  formatGain,
  formatKicker,
  formatPace,
  formatSpeed,
  FORMATS,
  gainLabel,
  paceLabel,
  speedLabel,
} from "./format";
import { worldRoute, type WorldRoute } from "./geo";
import { attributionFor, getGround, loadGround, type GroundSpec } from "./map";
import {
  buildScene3D,
  drawCurtain,
  drawGroundMesh,
  drawGroundTrace,
  GROUND_HALF,
  type Rect,
  type XY,
} from "./scene3d";
import type { Activity, ColorBy, PrivacyStyle, RenderInput, Theme } from "./types";

export const DRAW_UNTIL = 0.8;
const GROUND_PX = 1536;

function easeInOutCubic(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

/** `ease` is 0 for a constant speed and 1 for a full ease-in and ease-out. */
export function routeProgressAt(timeline: number, ease = 1): number {
  const t = clamp01(timeline);
  if (t >= DRAW_UNTIL) return 1;
  const u = t / DRAW_UNTIL;
  const s = clamp01(ease);
  if (s <= 0) return u;
  return u + (easeInOutCubic(u) - u) * s;
}

/* ------------------------------------------------------------------ helpers */

let grainCanvas: HTMLCanvasElement | null = null;

function grainTile(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 160;
  const g = c.getContext("2d");
  if (!g) return c;
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 180 + Math.random() * 75;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 18 + Math.random() * 40;
  }
  g.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
}

function track(ctx: CanvasRenderingContext2D, spacing: string) {
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = spacing;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (!cur || ctx.measureText(next).width <= maxW) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  const ellipsis = "…";
  while (last.length > 1 && ctx.measureText(last + ellipsis).width > maxW) last = last.slice(0, -1);
  kept[maxLines - 1] = last.replace(/[\s.]+$/, "") + ellipsis;
  return kept;
}

/** Fixed-width digits so counting numbers don't jitter in the video. */
function digitWidth(ctx: CanvasRenderingContext2D): number {
  let m = 0;
  for (let d = 0; d < 10; d++) m = Math.max(m, ctx.measureText(String(d)).width);
  return m;
}

function tabularWidth(ctx: CanvasRenderingContext2D, text: string): number {
  const dw = digitWidth(ctx);
  let w = 0;
  for (const ch of text) w += ch >= "0" && ch <= "9" ? dw : ctx.measureText(ch).width;
  return w;
}

function drawTabular(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  const dw = digitWidth(ctx);
  let cursor = x;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  for (const ch of text) {
    const isDigit = ch >= "0" && ch <= "9";
    const cw = ctx.measureText(ch).width;
    ctx.fillText(ch, isDigit ? cursor + (dw - cw) / 2 : cursor, y);
    cursor += isDigit ? dw : cw;
  }
  ctx.textAlign = prev;
}

/* -------------------------------------------------------------------- data */

const colorCache = new WeakMap<Activity, Map<ColorBy, number[]>>();

function pointColors(activity: Activity, colorBy: ColorBy): number[] {
  let per = colorCache.get(activity);
  if (!per) {
    per = new Map();
    colorCache.set(activity, per);
  }
  const hit = per.get(colorBy);
  if (hit) return hit;
  const out = activity.points.map((p, i) => {
    if (colorBy === "solid" || (colorBy === "elevation" && !activity.hasElevation)) return 0.5;
    if (colorBy === "elevation") {
      if (p.ele == null) return 0.5;
      return clamp01((p.ele - activity.eleLo) / (activity.eleHi - activity.eleLo));
    }
    return clamp01((activity.speed[i] - activity.speedLo) / (activity.speedHi - activity.speedLo));
  });
  per.set(colorBy, out);
  return out;
}

type Head = { i: number; f: number; empty: boolean };

function headAt(activity: Activity, target: number): Head {
  if (target <= 0) return { i: 0, f: 0, empty: true };
  const cum = activity.cumDist;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (cum[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  const j = lo + 1;
  let f = 0;
  if (j < cum.length && !activity.points[j].gap && cum[j] > cum[lo]) {
    f = clamp01((target - cum[lo]) / (cum[j] - cum[lo]));
  }
  return { i: lo, f, empty: false };
}

function sliceXY(pts: XY[], head: Head): XY[] {
  if (head.empty) return [];
  const out = pts.slice(0, head.i + 1);
  if (head.f > 0 && head.i + 1 < pts.length && !pts[head.i + 1].gap) {
    const a = pts[head.i];
    const b = pts[head.i + 1];
    const a0 = a.a ?? 1;
    out.push({
      x: a.x + (b.x - a.x) * head.f,
      y: a.y + (b.y - a.y) * head.f,
      c: a.c + (b.c - a.c) * head.f,
      a: a0 + ((b.a ?? 1) - a0) * head.f,
      gap: false,
    });
  }
  return out;
}

/** 0 at the start or finish, 1 once the point is outside the privacy radius. */
function privacyFactor(activity: Activity, index: number, radiusM: number): number {
  if (radiusM <= 0) return 1;
  const p = activity.points[index];
  const start = activity.points[0];
  const end = activity.points[activity.points.length - 1];
  const near = Math.min(
    haversine(p.lat, p.lon, start.lat, start.lon),
    haversine(p.lat, p.lon, end.lat, end.lon),
  );
  return clamp01(near / radiusM);
}

function stampPrivacy(pts: XY[], activity: Activity, radiusM: number, style: PrivacyStyle) {
  if (radiusM <= 0) {
    for (const p of pts) p.a = 1;
    return;
  }
  const omit = style === "omit";
  let wasHidden = false;
  for (let i = 0; i < pts.length; i++) {
    const factor = privacyFactor(activity, i, radiusM);
    const hidden = omit && factor < 1;
    pts[i].a = hidden ? 0 : factor;
    if (hidden || wasHidden) pts[i].gap = true;
    wasHidden = hidden;
  }
}

type Stat = { value: string; label: string };

function heroStat(input: RenderInput, distanceM: number): Stat {
  return { value: formatDistance(distanceM, input.units), label: distanceLabel(input.units) };
}

function rowStats(input: RenderInput, distanceM: number): Stat[] {
  const slice = sliceStats(input.activity, distanceM);
  const avgSpeed = slice.distanceM > 20 && slice.movingTimeS > 0 ? slice.distanceM / slice.movingTimeS : 0;
  const finalSpeed = input.activity.distanceM / Math.max(input.activity.movingTimeS, 1);
  const useSpeed = finalSpeed > 5 || avgSpeed > 5;
  const out: Stat[] = [
    { value: formatDuration(slice.movingTimeS), label: "TIME" },
    useSpeed
      ? { value: formatSpeed(slice.distanceM, slice.movingTimeS, input.units), label: speedLabel(input.units) }
      : { value: formatPace(slice.distanceM, slice.movingTimeS, input.units), label: paceLabel(input.units) },
  ];
  if (input.activity.hasElevation) {
    out.push({ value: formatGain(slice.gainM, input.units), label: gainLabel(input.units) });
  } else if (slice.avgHr != null) {
    out.push({ value: String(Math.round(slice.avgHr)), label: "AVG BPM" });
  }
  return out;
}

/* ------------------------------------------------------------------ layout */

type Layout = {
  w: number;
  h: number;
  u: number;
  wide: boolean;
  padX: number;
  textX: number;
  textW: number;
  kickerY: number;
  titleY: number;
  titleSize: number;
  titleLines: string[];
  subY: number;
  hasSub: boolean;
  headerBottom: number;
  route: Rect;
  chart: Rect | null;
  ruleY: number;
  statsTop: number;
  heroSize: number;
  heroBox: number;
  rowSize: number;
  rowTop: number;
  footerY: number;
};

const CONFIG = {
  story: { padX: 84, top: 252, bottom: 336, title: 86, hero: 180, row: 52, chart: 104 },
  portrait: { padX: 84, top: 96, bottom: 76, title: 76, hero: 148, row: 46, chart: 88 },
  square: { padX: 72, top: 68, bottom: 58, title: 60, hero: 108, row: 38, chart: 62 },
  landscape: { padX: 92, top: 100, bottom: 56, title: 78, hero: 150, row: 36, chart: 108 },
} as const;

function chartKind(input: RenderInput): "elevation" | "splits" | null {
  if (input.chart === "none") return null;
  if (input.chart === "elevation") return input.activity.hasElevation ? "elevation" : null;
  return "splits";
}

function computeLayout(ctx: CanvasRenderingContext2D, input: RenderInput): Layout {
  const { w, h } = FORMATS[input.format];
  const cfg = CONFIG[input.format];
  const wide = input.format === "landscape";
  const u = Math.min(w, h) / 1080;
  const padX = cfg.padX;
  const textW = wide ? 540 : w - padX * 2;

  const title = input.title.trim() || "Untitled";
  const display = input.uppercaseTitle ? title.toUpperCase() : title;
  ctx.save();
  track(ctx, "-0.03em");
  let size = cfg.title;
  let lines = [display];
  while (size > 34) {
    ctx.font = `700 ${size}px Figtree, sans-serif`;
    lines = wrapLines(ctx, display, textW, wide ? 3 : 2);
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width), 0);
    if (widest <= textW) break;
    size -= 2;
  }
  ctx.restore();

  const hasSub = Boolean(input.place.trim() || (input.discipline || input.activity.discipline).trim() || input.activity.hasHeartRate);
  const kickerY = cfg.top;
  const titleY = kickerY + 16 * u + 20 * u;
  const titleBottom = titleY + lines.length * size * 0.98;
  const subY = titleBottom + 14 * u;
  const headerBottom = hasSub ? subY + 20 * u : titleBottom;

  const heroBox = cfg.hero * 0.72;
  const rowBox = cfg.row * 0.72;
  const rowBlock = rowBox + 14 * u + 14 * u;
  const statsH = heroBox + 30 * u + rowBlock;

  const footerY = h - cfg.bottom;
  const statsBottom = footerY - 46 * u;
  const statsTop = statsBottom - statsH;
  const ruleY = statsTop - 28 * u;

  const kind = chartKind(input);
  let route: Rect;
  let chart: Rect | null = null;
  if (wide) {
    const x = 700;
    const rw = w - x - 72;
    const chartTop = h - 84 - cfg.chart;
    route = { x, y: 64, w: rw, h: (kind ? chartTop - 24 : h - 90) - 64 };
    if (kind) chart = { x, y: chartTop, w: rw, h: cfg.chart };
  } else {
    let bottom = ruleY - 22 * u;
    if (kind) {
      const chartBottom = ruleY - 22 * u;
      const chartTop = chartBottom - cfg.chart;
      chart = { x: padX, y: chartTop, w: w - padX * 2, h: cfg.chart };
      bottom = chartTop - 22 * u;
    }
    const top = headerBottom + 28 * u;
    route = { x: padX - 16, y: top, w: w - (padX - 16) * 2, h: Math.max(200, bottom - top) };
  }

  return {
    w,
    h,
    u,
    wide,
    padX,
    textX: padX,
    textW,
    kickerY,
    titleY,
    titleSize: size,
    titleLines: lines,
    subY,
    hasSub,
    headerBottom,
    route,
    chart,
    ruleY,
    statsTop,
    heroSize: cfg.hero,
    heroBox,
    rowSize: cfg.row,
    rowTop: statsTop + heroBox + 30 * u,
    footerY,
  };
}

/* --------------------------------------------------------------- map layer */

type FlatFit = { scale: number; ox: number; oy: number };

type FlatCam = {
  /** World point kept at the screen center. */
  x: number;
  y: number;
  /** Clockwise from north. 0 keeps north up. */
  bearing: number;
  /** Screen pixels per mercator unit. */
  scale: number;
  cx: number;
  cy: number;
};

function fitFlat(world: WorldRoute, rect: Rect): FlatFit {
  const bw = Math.max(world.maxX - world.minX, 1e-9);
  const bh = Math.max(world.maxY - world.minY, 1e-9);
  const inset = Math.min(rect.w, rect.h) * 0.07;
  const iw = rect.w - inset * 2;
  const ih = rect.h - inset * 2;
  const scale = Math.min(iw / bw, ih / bh);
  return {
    scale,
    ox: rect.x + inset + (iw - bw * scale) / 2,
    oy: rect.y + inset + (ih - bh * scale) / 2,
  };
}

function flatCamera(input: RenderInput, world: WorldRoute, rect: Rect): FlatCam {
  const bw = Math.max(world.maxX - world.minX, 1e-9);
  const bh = Math.max(world.maxY - world.minY, 1e-9);
  const inset = Math.min(rect.w, rect.h) * 0.07;
  const iw = rect.w - inset * 2;
  const ih = rect.h - inset * 2;
  const fit = Math.min(iw / bw, ih / bh);
  return {
    x: world.cx,
    y: world.cy,
    bearing: 0,
    scale: fit / Math.max(0.25, input.camera),
    cx: rect.x + rect.w / 2,
    cy: rect.y + rect.h / 2,
  };
}

function projectFlat(cam: FlatCam, x: number, y: number): { x: number; y: number } {
  const dx = x - cam.x;
  const dy = y - cam.y;
  const c = Math.cos(-cam.bearing);
  const s = Math.sin(-cam.bearing);
  return { x: cam.cx + (dx * c - dy * s) * cam.scale, y: cam.cy + (dx * s + dy * c) * cam.scale };
}

function flatGroundSpec(input: RenderInput, world: WorldRoute, fit: FlatFit, w: number, h: number): GroundSpec {
  return {
    basemap: input.basemap,
    minX: world.minX - fit.ox / fit.scale,
    maxX: world.minX + (w - fit.ox) / fit.scale,
    minY: world.minY - fit.oy / fit.scale,
    maxY: world.minY + (h - fit.oy) / fit.scale,
    w,
    h,
    fade: false,
    theme: input.theme,
  };
}

function solidGroundSpec(input: RenderInput, world: WorldRoute): GroundSpec {
  const extent = Math.max(world.maxX - world.minX, world.maxY - world.minY, 1e-9);
  const half = GROUND_HALF * extent;
  return {
    basemap: input.basemap,
    minX: world.cx - half,
    maxX: world.cx + half,
    minY: world.cy - half,
    maxY: world.cy + half,
    w: GROUND_PX,
    h: GROUND_PX,
    fade: true,
    theme: input.theme,
  };
}

/** Route bounds plus enough margin that a zoomed, rotating camera still has map under it. */
function detailGroundSpec(input: RenderInput, world: WorldRoute): GroundSpec {
  const pad = 2400 / world.metersPerUnit;
  const minX = world.minX - pad;
  const maxX = world.maxX + pad;
  const minY = world.minY - pad;
  const maxY = world.maxY + pad;
  const ppm = input.camera < 1 ? 1.5 : 0.8;
  let tw = Math.max(64, (maxX - minX) * world.metersPerUnit * ppm);
  let th = Math.max(64, (maxY - minY) * world.metersPerUnit * ppm);
  const cap = 4096;
  const shrink = Math.min(1, cap / Math.max(tw, th));
  tw = Math.round(tw * shrink);
  th = Math.round(th * shrink);
  return {
    basemap: input.basemap,
    minX,
    maxX,
    minY,
    maxY,
    w: tw,
    h: th,
    fade: false,
    theme: input.theme,
  };
}

function classicFlat(input: RenderInput): boolean {
  return input.camera === 1;
}

function groundSpecFor(input: RenderInput, layout: Layout): GroundSpec | null {
  const world = worldRoute(input.activity);
  if (input.view === "3d") return solidGroundSpec(input, world);
  if (input.basemap === "none") return null;
  if (classicFlat(input)) return flatGroundSpec(input, world, fitFlat(world, layout.route), layout.w, layout.h);
  return detailGroundSpec(input, world);
}

/** Load whatever map imagery this card needs. Call before a video render so every frame has it. */
export async function prepareMap(ctx: CanvasRenderingContext2D, input: RenderInput): Promise<void> {
  const spec = groundSpecFor(input, computeLayout(ctx, input));
  if (spec) await loadGround(spec);
}

/* ---------------------------------------------------------------- drawing */

function drawBase(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme) {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const spot = ctx.createRadialGradient(w * 0.5, h * 0.38, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.55);
  spot.addColorStop(0, theme.spot);
  spot.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);

  const spot2 = ctx.createRadialGradient(w * 0.2, h * 0.9, 0, w * 0.2, h * 0.9, Math.max(w, h) * 0.45);
  spot2.addColorStop(0, theme.spot2);
  spot2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot2;
  ctx.fillRect(0, 0, w, h);
}

function drawDots(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme) {
  const gap = Math.max(28, Math.round(Math.min(w, h) / 32));
  ctx.fillStyle = theme.grid;
  for (let y = gap * 0.75; y < h; y += gap) {
    for (let x = gap * 0.75; x < w; x += gap) ctx.fillRect(x, y, 1.6, 1.6);
  }
}

function drawFinish(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme, grain: boolean) {
  if (grain) {
    const tile = grainTile();
    ctx.save();
    ctx.globalAlpha = theme.mode === "dark" ? 0.3 : 0.2;
    ctx.globalCompositeOperation = theme.mode === "dark" ? "screen" : "multiply";
    for (let y = 0; y < h; y += tile.height) {
      for (let x = 0; x < w; x += tile.width) ctx.drawImage(tile, x, y);
    }
    ctx.restore();
  }
  const vig = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.2, w / 2, h * 0.5, Math.max(w, h) * 0.72);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, theme.vignette);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

/** Keeps type readable where it sits over imagery. */
function drawScrims(ctx: CanvasRenderingContext2D, L: Layout, theme: Theme) {
  const bg = theme.bg;
  const { w, h, u } = L;
  if (L.wide) {
    const edge = L.route.x + 90 * u;
    const g = ctx.createLinearGradient(0, 0, edge, 0);
    g.addColorStop(0, withAlpha(bg, 0.96));
    g.addColorStop(0.7, withAlpha(bg, 0.88));
    g.addColorStop(1, withAlpha(bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, edge, h);
    const y0 = (L.chart ? L.chart.y : h - 220) - 50 * u;
    const b = ctx.createLinearGradient(0, y0, 0, h);
    b.addColorStop(0, withAlpha(bg, 0));
    b.addColorStop(0.5, withAlpha(bg, 0.8));
    b.addColorStop(1, withAlpha(bg, 0.94));
    ctx.fillStyle = b;
    ctx.fillRect(edge, y0, w - edge, h - y0);
    return;
  }
  const topH = L.route.y + 60 * u;
  const t = ctx.createLinearGradient(0, 0, 0, topH);
  t.addColorStop(0, withAlpha(bg, 0.96));
  t.addColorStop(Math.min(0.9, (L.headerBottom + 10 * u) / topH), withAlpha(bg, 0.86));
  t.addColorStop(1, withAlpha(bg, 0));
  ctx.fillStyle = t;
  ctx.fillRect(0, 0, w, topH);

  const y0 = (L.chart ? L.chart.y : L.ruleY) - 56 * u;
  const b = ctx.createLinearGradient(0, y0, 0, h);
  b.addColorStop(0, withAlpha(bg, 0));
  b.addColorStop(0.3, withAlpha(bg, 0.84));
  b.addColorStop(1, withAlpha(bg, 0.96));
  ctx.fillStyle = b;
  ctx.fillRect(0, y0, w, h - y0);
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: XY[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].gap) ctx.moveTo(pts[i].x, pts[i].y);
    else ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
}

type RunFn = (segment: XY[], colorT: number, alpha: number) => void;

/** Split the stroke where color or fade changes. Alpha 0 is left undrawn. */
function forRuns(pts: XY[], splitColor: boolean, fn: RunFn) {
  const colorBuckets = splitColor ? 18 : 1;
  const alphaBuckets = 8;
  let run: XY[] = [pts[0]];
  let colorKey = Math.round(clamp01(pts[0].c) * (colorBuckets - 1));
  let alphaKey = Math.round(clamp01(pts[0].a ?? 1) * (alphaBuckets - 1));
  const flush = (segment: XY[], ck: number, ak: number) => {
    if (segment.length < 2 || ak <= 0) return;
    fn(segment, splitColor ? ck / (colorBuckets - 1) : 0, ak / (alphaBuckets - 1));
  };
  for (let i = 1; i < pts.length; i++) {
    const nextColor = Math.round(clamp01(pts[i].c) * (colorBuckets - 1));
    const nextAlpha = Math.round(clamp01(pts[i].a ?? 1) * (alphaBuckets - 1));
    if (pts[i].gap || nextColor !== colorKey || nextAlpha !== alphaKey) {
      if (!pts[i].gap) run.push(pts[i]);
      flush(run, colorKey, pts[i].gap ? alphaKey : Math.min(alphaKey, nextAlpha));
      run = [pts[i]];
      colorKey = nextColor;
      alphaKey = nextAlpha;
    } else run.push(pts[i]);
  }
  flush(run, colorKey, alphaKey);
}

function drawRoute(ctx: CanvasRenderingContext2D, pts: XY[], theme: Theme, width: number, casing: boolean) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (casing) {
    ctx.strokeStyle = theme.mode === "dark" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.7)";
    ctx.lineWidth = width * 1.75;
    forRuns(pts, false, (seg, colorT, alpha) => {
      void colorT;
      ctx.globalAlpha = alpha;
      strokePolyline(ctx, seg);
    });
  }

  if (theme.mode === "light") {
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = width * 2.1;
    forRuns(pts, false, (seg, colorT, alpha) => {
      void colorT;
      ctx.globalAlpha = 0.16 * alpha;
      strokePolyline(ctx, seg);
    });
  } else {
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = Math.max(18, width * 2.6);
    ctx.strokeStyle = theme.glow;
    ctx.lineWidth = width * 1.15;
    forRuns(pts, false, (seg, colorT, alpha) => {
      void colorT;
      ctx.globalAlpha = theme.glowAlpha * alpha;
      strokePolyline(ctx, seg);
    });
    ctx.shadowBlur = 0;
  }

  ctx.lineWidth = width;
  forRuns(pts, true, (seg, t, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = rampColor(theme, t);
    strokePolyline(ctx, seg);
  });
  if (theme.coreMix > 0) {
    ctx.lineWidth = Math.max(1.25, width * 0.28);
    forRuns(pts, true, (seg, t, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = mixHex(rampColor(theme, t), "#ffffff", theme.coreMix);
      strokePolyline(ctx, seg);
    });
  }
  ctx.restore();
}

function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, theme: Theme, kind: "start" | "end" | "loop") {
  ctx.save();
  ctx.lineWidth = Math.max(2, r * 0.28);
  ctx.beginPath();
  if (kind === "end") {
    ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = theme.ramp[2];
    ctx.fill();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = theme.bg;
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.stroke();
    if (kind === "loop") {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = theme.ramp[2];
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawPill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, theme: Theme, u: number) {
  ctx.save();
  ctx.font = `500 ${Math.round(20 * u)}px Figtree, sans-serif`;
  track(ctx, "0px");
  const tw = ctx.measureText(text).width;
  const padX = 14 * u;
  const w = tw + padX * 2;
  const h = 36 * u;
  let left = x - w / 2;
  let top = y - h / 2;
  const boundsW = ctx.canvas.width;
  const boundsH = ctx.canvas.height;
  if (left < 24) left = 24;
  if (left + w > boundsW - 24) left = boundsW - 24 - w;
  if (top < 24) top = 24;
  if (top + h > boundsH - 24) top = boundsH - 24 - h;
  roundRect(ctx, left, top, w, h, h / 2);
  ctx.fillStyle = theme.mode === "dark" ? "rgba(10,10,10,0.82)" : "rgba(255,252,246,0.92)";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.frame;
  ctx.stroke();
  ctx.fillStyle = theme.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + padX, top + h / 2 + 1);
  ctx.restore();
}

function chartLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, theme: Theme, u: number, align: CanvasTextAlign = "left") {
  ctx.save();
  ctx.fillStyle = theme.muted;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  track(ctx, "0.18em");
  ctx.font = `500 ${Math.round(13 * u)}px Figtree, sans-serif`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawElevation(ctx: CanvasRenderingContext2D, input: RenderInput, rect: Rect, progress: number, u: number) {
  const { activity, theme } = input;
  const eles = activity.points.map((p) => p.ele ?? activity.eleLo);
  const span = Math.max(activity.eleHi - activity.eleLo, 12);
  const lo = (activity.eleHi + activity.eleLo) / 2 - span / 2;
  const n = activity.points.length;
  const dist = Math.max(activity.distanceM, 1);
  const xAt = (i: number) => rect.x + (activity.cumDist[i] / dist) * rect.w;
  const yAt = (ele: number) => rect.y + rect.h - ((ele - lo) / span) * (rect.h * 0.84) - rect.h * 0.06;

  const trace = (limit: number): { endX: number; endY: number } => {
    ctx.beginPath();
    let drawing = false;
    let endX = rect.x;
    let endY = rect.y + rect.h;
    for (let i = 0; i < n; i++) {
      if (activity.cumDist[i] > limit) {
        if (i > 0 && !activity.points[i].gap && activity.cumDist[i] > activity.cumDist[i - 1]) {
          const f = (limit - activity.cumDist[i - 1]) / (activity.cumDist[i] - activity.cumDist[i - 1]);
          endX = xAt(i - 1) + (xAt(i) - xAt(i - 1)) * f;
          endY = yAt(eles[i - 1] + (eles[i] - eles[i - 1]) * f);
          ctx.lineTo(endX, endY);
        }
        break;
      }
      endX = xAt(i);
      endY = yAt(eles[i]);
      if (!drawing || activity.points[i].gap) {
        ctx.moveTo(endX, endY);
        drawing = true;
      } else ctx.lineTo(endX, endY);
    }
    return { endX, endY };
  };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalAlpha = theme.mode === "dark" ? 0.3 : 0.26;
  trace(activity.distanceM);
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 2.5 * u;
  ctx.stroke();
  ctx.restore();

  const limit = activity.distanceM * progress;
  if (limit <= 0) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const { endX, endY } = trace(limit);
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 3.2 * u;
  ctx.stroke();
  ctx.lineTo(endX, rect.y + rect.h);
  ctx.lineTo(rect.x, rect.y + rect.h);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  fill.addColorStop(0, withAlpha(theme.ramp[1], theme.mode === "dark" ? 0.34 : 0.28));
  fill.addColorStop(1, withAlpha(theme.ramp[1], 0));
  ctx.fillStyle = fill;
  ctx.fill();
  if (progress < 0.995) {
    ctx.beginPath();
    ctx.arc(endX, endY, 5 * u, 0, Math.PI * 2);
    ctx.fillStyle = theme.ink;
    ctx.fill();
  }
  ctx.restore();
}

function drawSplits(ctx: CanvasRenderingContext2D, input: RenderInput, rect: Rect, progress: number, u: number) {
  const { activity, theme } = input;
  const { splits } = computeSplits(activity, input.units === "mi" ? 1609.344 : 1000);
  if (!splits.length) return;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of splits) {
    lo = Math.min(lo, s.speed);
    hi = Math.max(hi, s.speed);
  }
  const gap = Math.max(4 * u, Math.min(10 * u, rect.w / splits.length / 5));
  const barW = Math.min(72 * u, (rect.w - gap * (splits.length - 1)) / splits.length);
  const reached = activity.distanceM * progress;
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    const t = hi > lo ? (s.speed - lo) / (hi - lo) : 0.5;
    const full = rect.h * (0.3 + 0.7 * t);
    const f = clamp01((reached - s.startM) / (s.endM - s.startM));
    if (f <= 0) continue;
    const grow = 1 - (1 - f) ** 3;
    const hgt = full * grow;
    const x = rect.x + i * (barW + gap);
    ctx.save();
    ctx.fillStyle = rampColor(theme, t);
    ctx.globalAlpha = 0.95;
    roundRect(ctx, x, rect.y + rect.h - hgt, barW, hgt, Math.min(5 * u, barW / 2));
    ctx.fill();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------- card */

export function renderCard(ctx: CanvasRenderingContext2D, input: RenderInput) {
  const { activity, theme } = input;
  const L = computeLayout(ctx, input);
  const { w, h, u } = L;
  const timeline = clamp01(input.timeline);
  const progress = routeProgressAt(timeline, input.ease);
  const titleA = clamp01(timeline / 0.1);
  const statA = clamp01((progress - 0.02) / 0.12);
  const signA = clamp01((timeline - 0.72) / 0.16);
  const is3d = input.view === "3d";
  const hasMap = input.basemap !== "none";
  const dist = activity.distanceM * progress;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  drawBase(ctx, w, h, theme);

  const world = worldRoute(activity);
  const colors = pointColors(activity, input.colorBy);
  const head = headAt(activity, dist);
  const lw = (L.wide ? 12.5 : 12) * u * input.lineWidth * (is3d ? 0.85 : 1);

  let flatPts: XY[] | null = null;
  let scene: ReturnType<typeof buildScene3D> | null = null;
  const clipRoute = !classicFlat(input);

  if (is3d) {
    scene = buildScene3D(input, world, L.route, colors, timeline);
    const tex = getGround(solidGroundSpec(input, world));
    if (tex) drawGroundMesh(ctx, scene, tex, hasMap ? input.mapOpacity : 1);
  } else {
    const cam = flatCamera(input, world, L.route);
    flatPts = world.x.map((x, i) => {
      const p = projectFlat(cam, x, world.y[i]);
      return { x: p.x, y: p.y, c: colors[i], gap: activity.points[i].gap };
    });
    if (hasMap) {
      const spec = classicFlat(input)
        ? flatGroundSpec(input, world, fitFlat(world, L.route), w, h)
        : detailGroundSpec(input, world);
      const tex = getGround(spec);
      if (tex) {
        ctx.save();
        ctx.globalAlpha = input.mapOpacity;
        if (classicFlat(input)) ctx.drawImage(tex, 0, 0, w, h);
        else {
          ctx.translate(cam.cx, cam.cy);
          ctx.rotate(-cam.bearing);
          ctx.scale(cam.scale, cam.scale);
          ctx.translate(-cam.x, -cam.y);
          ctx.drawImage(tex, spec.minX, spec.minY, spec.maxX - spec.minX, spec.maxY - spec.minY);
        }
        ctx.restore();
      }
    }
  }

  if (hasMap || is3d) drawScrims(ctx, L, theme);
  if (input.showGrid && !hasMap && !is3d) drawDots(ctx, w, h, theme);
  drawFinish(ctx, w, h, theme, input.showGrain);

  /* route */
  if (clipRoute) {
    ctx.save();
    const top = Math.max(L.route.y, L.headerBottom);
    const limit = L.chart ? L.chart.y - 8 : L.ruleY;
    const bottom = Math.min(L.route.y + L.route.h, limit);
    ctx.beginPath();
    ctx.rect(L.route.x, top, L.route.w, Math.max(8, bottom - top));
    ctx.clip();
  }
  if (is3d && scene) {
    stampPrivacy(scene.top, activity, input.privacyM, input.privacy);
    stampPrivacy(scene.base, activity, input.privacyM, input.privacy);
    const top = sliceXY(scene.top, head);
    const base = sliceXY(scene.base, head);
    drawGroundTrace(ctx, base, lw, theme);
    if (scene.hasRelief) drawCurtain(ctx, top, base, theme, u);
    drawRoute(ctx, top, theme, lw, hasMap);
    drawRouteEnds(ctx, input, top, progress, timeline, u, lw);
  } else if (flatPts) {
    stampPrivacy(flatPts, activity, input.privacyM, input.privacy);
    const visible = sliceXY(flatPts, head);
    drawRoute(ctx, visible, theme, lw, hasMap);
    drawRouteEnds(ctx, input, visible, progress, timeline, u, lw);
  }
  if (clipRoute) ctx.restore();

  /* header */
  ctx.save();
  ctx.globalAlpha = titleA;
  ctx.translate(0, (1 - titleA) * 18);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = theme.muted;
  track(ctx, "0.08em");
  ctx.font = `500 ${Math.round(16 * u)}px Figtree, sans-serif`;
  ctx.fillText(formatKicker(activity.start), L.textX, L.kickerY);

  ctx.fillStyle = theme.ink;
  track(ctx, "-0.03em");
  ctx.font = `700 ${L.titleSize}px Figtree, sans-serif`;
  const displayTitle = L.titleLines;
  displayTitle.forEach((line, i) => ctx.fillText(line, L.textX, L.titleY + i * L.titleSize * 0.98));

  if (L.hasSub) {
    const hr = heartRateAt(activity, dist);
    const hrBit = hr != null ? `${Math.round(hr)} BPM` : "";
    const sub = [input.place.trim(), (input.discipline || activity.discipline).trim(), hrBit]
      .filter(Boolean)
      .join("   ·   ")
      .toUpperCase();
    ctx.fillStyle = theme.muted;
    track(ctx, "0.08em");
    ctx.font = `500 ${Math.round(16 * u)}px Figtree, sans-serif`;
    ctx.fillText(sub, L.textX, L.subY);
  }
  ctx.restore();

  /* chart */
  const kind = chartKind(input);
  if (L.chart && kind) {
    ctx.save();
    ctx.globalAlpha = statA;
    const label =
      kind === "elevation"
        ? "ELEVATION"
        : `PACE SPLITS · ${Math.round(computeSplits(activity, input.units === "mi" ? 1609.344 : 1000).unitM / (input.units === "mi" ? 1609.344 : 1000))} ${input.units.toUpperCase()}`;
    chartLabel(ctx, label, L.chart.x, L.chart.y, theme, u);
    const inner = { x: L.chart.x, y: L.chart.y + 26 * u, w: L.chart.w, h: L.chart.h - 26 * u };
    if (kind === "elevation") drawElevation(ctx, input, inner, progress, u);
    else drawSplits(ctx, input, inner, progress, u);
    ctx.restore();
  }

  /* stats */
  ctx.save();
  ctx.globalAlpha = statA;
  const colW = L.wide ? L.textW : L.w - L.padX * 2;
  ctx.strokeStyle = theme.faint;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L.textX, L.ruleY);
  ctx.lineTo(L.textX + colW, L.ruleY);
  ctx.stroke();

  const hero = heroStat(input, dist);
  const finalHero = heroStat(input, activity.distanceM);
  const unitSize = Math.round(L.heroSize * 0.2);
  let heroSize = L.heroSize;
  track(ctx, "0px");
  ctx.font = `700 ${unitSize}px Figtree, sans-serif`;
  const unitW = ctx.measureText(finalHero.label).width + unitSize * 0.12 * finalHero.label.length;
  for (;;) {
    ctx.font = `700 ${heroSize}px Figtree, sans-serif`;
    if (tabularWidth(ctx, finalHero.value) + 20 * u + unitW <= colW || heroSize <= 56) break;
    heroSize -= 4;
  }
  ctx.font = `700 ${heroSize}px Figtree, sans-serif`;
  const heroBase = L.statsTop + heroSize * 0.72;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = theme.ink;
  drawTabular(ctx, hero.value, L.textX, heroBase);
  const numW = tabularWidth(ctx, finalHero.value);
  ctx.fillStyle = theme.muted;
  track(ctx, "0.12em");
  ctx.font = `600 ${unitSize}px Figtree, sans-serif`;
  ctx.fillText(hero.label, L.textX + numW + 20 * u, heroBase);

  const row = rowStats(input, dist);
  const colWidth = colW / Math.max(row.length, 1);
  row.forEach((stat, i) => {
    const x = L.textX + i * colWidth;
    track(ctx, "0px");
    ctx.fillStyle = theme.ink;
    ctx.font = `500 ${L.rowSize}px Figtree, sans-serif`;
    ctx.textBaseline = "alphabetic";
    drawTabular(ctx, stat.value, x, L.rowTop + L.rowSize * 0.72);
    ctx.fillStyle = theme.muted;
    track(ctx, "0.16em");
    ctx.font = `500 ${Math.round(13 * u)}px Figtree, sans-serif`;
    ctx.fillText(stat.label, x, L.rowTop + L.rowSize * 0.72 + 24 * u);
  });
  ctx.restore();

  /* footer */
  const attribution = attributionFor(input.basemap);
  ctx.save();
  ctx.textBaseline = "alphabetic";
  track(ctx, "0.14em");
  if (input.signature.trim()) {
    ctx.globalAlpha = signA * (theme.mode === "dark" ? 0.82 : 0.72);
    ctx.fillStyle = theme.muted;
    ctx.font = `500 ${Math.round(15 * u)}px Figtree, sans-serif`;
    ctx.textAlign = L.wide ? "left" : "right";
    ctx.fillText(input.signature.trim().toUpperCase(), L.wide ? L.padX : w - L.padX, L.footerY);
  }
  if (attribution) {
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = theme.muted;
    track(ctx, "0.02em");
    ctx.font = `400 ${Math.round(12 * u)}px Figtree, sans-serif`;
    ctx.textAlign = L.wide ? "right" : "left";
    ctx.fillText(attribution, L.wide ? w - 72 : L.padX, L.footerY);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = theme.frame;
  ctx.lineWidth = 1.25;
  const m = L.wide ? 36 : 32;
  ctx.strokeRect(m, m, w - m * 2, h - m * 2);
  ctx.restore();

  track(ctx, "0px");
}

function publicPoint(pts: XY[], fromEnd: boolean): XY | null {
  if (fromEnd) {
    for (let i = pts.length - 1; i >= 0; i--) if ((pts[i].a ?? 1) >= 0.98) return pts[i];
  } else {
    for (const p of pts) if ((p.a ?? 1) >= 0.98) return p;
  }
  return null;
}

function drawRouteEnds(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  top: XY[],
  progress: number,
  timeline: number,
  u: number,
  lw: number,
) {
  const { theme, activity } = input;
  if (!top.length) return;
  const headPt = top[top.length - 1];
  const done = progress >= 0.995;
  const markerR = 8 * u * Math.max(1, input.lineWidth * 0.7);
  const privateMap = input.privacyM > 0;
  const startPt = privateMap ? publicPoint(top, false) : top[0];
  const endPt = privateMap ? publicPoint(top, true) : headPt;

  if (progress > 0.01 && startPt) {
    if (done && activity.loop && !privateMap) {
      drawMarker(ctx, startPt.x, startPt.y, markerR, theme, "loop");
    } else {
      drawMarker(ctx, startPt.x, startPt.y, 7.5 * u, theme, "start");
      if (done && endPt) drawMarker(ctx, endPt.x, endPt.y, 8 * u, theme, "end");
    }
  }

  const headA = headPt.a ?? 1;
  const showComet = progress > 0.01 && !done && timeline < DRAW_UNTIL && headA > (input.privacy === "omit" ? 0.99 : 0.45);
  if (!showComet) return;

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(headPt.x, headPt.y, Math.max(4, lw * 0.42), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  let nx = 0;
  let ny = -1;
  if (top.length > 1) {
    const prev = top[top.length - 2];
    const dx = headPt.x - prev.x;
    const dy = headPt.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    nx = -dy / len;
    ny = dx / len;
  }
  if (!input.showDistanceTip) return;
  const label = `${formatDistance(activity.distanceM * progress, input.units)} ${distanceLabel(input.units).toLowerCase()}`;
  drawPill(ctx, headPt.x + nx * 46 * u, headPt.y + ny * 46 * u, label, theme, u);
}
