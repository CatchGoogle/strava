import { clamp01, rampColor, withAlpha } from "./color";
import type { WorldRoute } from "./geo";
import type { RenderInput, Theme } from "./types";

export type XY = { x: number; y: number; c: number; gap: boolean };
export type Rect = { x: number; y: number; w: number; h: number };

const DEG = Math.PI / 180;
/** Camera distance in route-extent units. Larger is flatter. */
const CAMERA_DISTANCE = 3.4;
/** Half-size of the ground plane in route-extent units. The route spans about ±0.5. */
export const GROUND_HALF = 0.78;

export type Scene3D = {
  top: XY[];
  base: XY[];
  project: (nx: number, ny: number, nz: number) => { x: number; y: number };
  zGround: number;
  /** Route extent in mercator units, also the scale of the normalized scene. */
  extent: number;
  hasRelief: boolean;
  ground: { minX: number; minY: number; maxX: number; maxY: number };
};

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function cameraAt(input: RenderInput, timeline: number): { yaw: number; pitch: number } {
  let yaw = input.yaw;
  let pitch = input.pitch;
  if (input.orbit) {
    const k = 1 - easeInOut(clamp01(timeline));
    yaw = input.yaw - 42 * k;
    pitch = Math.max(6, input.pitch - 20 * k);
  }
  return { yaw: yaw * DEG, pitch: pitch * DEG };
}

function projector(yaw: number, pitch: number) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return (nx: number, ny: number, nz: number) => {
    const rx = nx * cy - ny * sy;
    const ry = nx * sy + ny * cy;
    const depth = CAMERA_DISTANCE - ry * sp - nz * cp;
    const k = CAMERA_DISTANCE / Math.max(0.5, depth);
    return { x: rx * k, y: (ry * cp - nz * sp) * k };
  };
}

export function buildScene3D(
  input: RenderInput,
  world: WorldRoute,
  rect: Rect,
  colors: number[],
  timeline: number,
): Scene3D {
  const { activity } = input;
  const n = activity.points.length;
  const extent = Math.max(world.maxX - world.minX, world.maxY - world.minY, 1e-9);
  const hasRelief = activity.hasElevation;
  const reliefM = Math.max(activity.eleHi - activity.eleLo, 1);
  const eleMid = (activity.eleHi + activity.eleLo) / 2;
  const extentM = extent * world.metersPerUnit;
  const auto = Math.min(10, Math.max(1, (0.22 * extentM) / reliefM));
  const k = hasRelief ? (auto * input.relief) / world.metersPerUnit / extent : 0;

  const nx = new Array<number>(n);
  const ny = new Array<number>(n);
  const nz = new Array<number>(n);
  let zMin = Infinity;
  for (let i = 0; i < n; i++) {
    nx[i] = (world.x[i] - world.cx) / extent;
    ny[i] = (world.y[i] - world.cy) / extent;
    const ele = activity.points[i].ele;
    nz[i] = hasRelief && ele != null ? (ele - eleMid) * k : 0;
    if (nz[i] < zMin) zMin = nz[i];
  }
  const zGround = zMin - 0.03;

  const final = cameraAt(input, 1);
  const cams = [final];
  if (input.orbit) {
    cams.push(cameraAt(input, 0.5), cameraAt(input, 0));
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const cam of cams) {
    const p = projector(cam.yaw, cam.pitch);
    for (let i = 0; i < n; i += 1) {
      const a = p(nx[i], ny[i], nz[i]);
      const b = p(nx[i], ny[i], zGround);
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (b.x < minX) minX = b.x;
      if (b.x > maxX) maxX = b.x;
      if (a.y < minY) minY = a.y;
      if (a.y > maxY) maxY = a.y;
      if (b.y < minY) minY = b.y;
      if (b.y > maxY) maxY = b.y;
    }
  }
  const pad = 0.94;
  const scale = (Math.min(rect.w / Math.max(maxX - minX, 1e-6), rect.h / Math.max(maxY - minY, 1e-6)) * pad);
  const offX = rect.x + rect.w / 2 - ((minX + maxX) / 2) * scale;
  const offY = rect.y + rect.h / 2 - ((minY + maxY) / 2) * scale;

  const cam = cameraAt(input, timeline);
  const raw = projector(cam.yaw, cam.pitch);
  const project = (x: number, y: number, z: number) => {
    const p = raw(x, y, z);
    return { x: offX + p.x * scale, y: offY + p.y * scale };
  };

  const top = new Array<XY>(n);
  const base = new Array<XY>(n);
  for (let i = 0; i < n; i++) {
    const gap = activity.points[i].gap;
    const a = project(nx[i], ny[i], nz[i]);
    const b = project(nx[i], ny[i], zGround);
    top[i] = { x: a.x, y: a.y, c: colors[i], gap };
    base[i] = { x: b.x, y: b.y, c: colors[i], gap };
  }

  const half = GROUND_HALF * extent;
  return {
    top,
    base,
    project,
    zGround,
    extent,
    hasRelief,
    ground: {
      minX: world.cx - half,
      maxX: world.cx + half,
      minY: world.cy - half,
      maxY: world.cy + half,
    },
  };
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  tex: HTMLCanvasElement,
  s: [number, number][],
  d: [number, number][],
) {
  const [s0, s1, s2] = s;
  const det = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (Math.abs(det) < 1e-9) return;
  const [d0, d1, d2] = d;
  const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / det;
  const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / det;
  const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / det;
  const dd = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / det;
  const e = d0[0] - a * s0[0] - c * s0[1];
  const f = d0[1] - b * s0[0] - dd * s0[1];

  // Push the clip outward a hair so neighbouring triangles overlap instead of leaving seams.
  const cx = (d0[0] + d1[0] + d2[0]) / 3;
  const cy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (p: [number, number]): [number, number] => {
    const vx = p[0] - cx;
    const vy = p[1] - cy;
    const len = Math.hypot(vx, vy) || 1;
    return [p[0] + (vx / len) * 0.75, p[1] + (vy / len) * 0.75];
  };
  const g0 = grow(d0);
  const g1 = grow(d1);
  const g2 = grow(d2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0[0], g0[1]);
  ctx.lineTo(g1[0], g1[1]);
  ctx.lineTo(g2[0], g2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, dd, e, f);
  const minU = Math.max(0, Math.floor(Math.min(s0[0], s1[0], s2[0])) - 1);
  const minV = Math.max(0, Math.floor(Math.min(s0[1], s1[1], s2[1])) - 1);
  const maxU = Math.min(tex.width, Math.ceil(Math.max(s0[0], s1[0], s2[0])) + 1);
  const maxV = Math.min(tex.height, Math.ceil(Math.max(s0[1], s1[1], s2[1])) + 1);
  ctx.drawImage(tex, minU, minV, maxU - minU, maxV - minV, minU, minV, maxU - minU, maxV - minV);
  ctx.restore();
}

/** Drape a square ground texture across the tilted plane using a warped mesh. */
export function drawGroundMesh(ctx: CanvasRenderingContext2D, scene: Scene3D, tex: HTMLCanvasElement, alpha: number) {
  const N = 16;
  const verts: [number, number][] = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const gx = -GROUND_HALF + (2 * GROUND_HALF * i) / N;
      const gy = -GROUND_HALF + (2 * GROUND_HALF * j) / N;
      const p = scene.project(gx, gy, scene.zGround);
      verts.push([p.x, p.y]);
    }
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  const cell = tex.width / N;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v00 = verts[j * (N + 1) + i];
      const v10 = verts[j * (N + 1) + i + 1];
      const v01 = verts[(j + 1) * (N + 1) + i];
      const v11 = verts[(j + 1) * (N + 1) + i + 1];
      const u0 = i * cell;
      const u1 = (i + 1) * cell;
      const t0 = j * cell;
      const t1 = (j + 1) * cell;
      drawTexturedTriangle(ctx, tex, [[u0, t0], [u1, t0], [u0, t1]], [v00, v10, v01]);
      drawTexturedTriangle(ctx, tex, [[u1, t0], [u1, t1], [u0, t1]], [v10, v11, v01]);
    }
  }
  ctx.restore();
}

/** Soft shadow of the route on the ground. */
export function drawGroundTrace(ctx: CanvasRenderingContext2D, base: XY[], width: number, theme: Theme) {
  if (base.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = theme.mode === "dark" ? "rgba(0,0,0,0.45)" : "rgba(28,20,14,0.3)";
  ctx.lineWidth = width * 1.9;
  ctx.beginPath();
  base.forEach((p, i) => (i === 0 || p.gap ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.strokeStyle = withAlpha(theme.ramp[1], theme.mode === "dark" ? 0.5 : 0.35);
  ctx.lineWidth = Math.max(1.5, width * 0.32);
  ctx.stroke();
  ctx.restore();
}

/** Translucent wall between the route and the ground. */
export function drawCurtain(ctx: CanvasRenderingContext2D, top: XY[], base: XY[], theme: Theme, u: number) {
  const n = top.length;
  if (n < 2) return;
  let yTop = Infinity;
  let yBase = -Infinity;
  for (let i = 0; i < n; i++) {
    if (top[i].y < yTop) yTop = top[i].y;
    if (base[i].y > yBase) yBase = base[i].y;
  }
  if (yBase - yTop < 4) return;

  const buckets = 14;
  const paths: Path2D[] = Array.from({ length: buckets }, () => new Path2D());
  const used = new Array<boolean>(buckets).fill(false);
  for (let i = 1; i < n; i++) {
    if (top[i].gap) continue;
    const b = Math.round(clamp01(top[i].c) * (buckets - 1));
    const p = paths[b];
    p.moveTo(base[i - 1].x, base[i - 1].y);
    p.lineTo(base[i].x, base[i].y);
    p.lineTo(top[i].x, top[i].y);
    p.lineTo(top[i - 1].x, top[i - 1].y);
    p.closePath();
    used[b] = true;
  }

  ctx.save();
  const dark = theme.mode === "dark";
  for (let b = 0; b < buckets; b++) {
    if (!used[b]) continue;
    const color = rampColor(theme, b / (buckets - 1));
    const grad = ctx.createLinearGradient(0, yTop, 0, yBase);
    grad.addColorStop(0, withAlphaRgb(color, dark ? 0.5 : 0.4));
    grad.addColorStop(1, withAlphaRgb(color, dark ? 0.04 : 0.03));
    ctx.fillStyle = grad;
    ctx.fill(paths[b]);
  }

  // Fine verticals give the wall some structure and hide seams between segments.
  ctx.lineWidth = Math.max(1, 1.2 * u);
  const step = Math.max(2, Math.round(n / 110));
  for (let i = 0; i < n; i += step) {
    if (Math.abs(top[i].y - base[i].y) < 3) continue;
    const grad = ctx.createLinearGradient(0, top[i].y, 0, base[i].y);
    const color = rampColor(theme, top[i].c);
    grad.addColorStop(0, withAlphaRgb(color, dark ? 0.55 : 0.45));
    grad.addColorStop(1, withAlphaRgb(color, 0));
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(top[i].x, top[i].y);
    ctx.lineTo(base[i].x, base[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function withAlphaRgb(rgbString: string, alpha: number): string {
  // rampColor returns "rgb(r, g, b)"
  return rgbString.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}
