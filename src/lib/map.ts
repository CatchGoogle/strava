import type { BasemapId, Theme } from "./types";

type TileProvider = {
  url: (z: number, x: number, y: number) => string;
  maxZoom: number;
  attribution: string;
};

const PROVIDERS: Record<Exclude<BasemapId, "none">, TileProvider> = {
  // CARTO's free basemaps now answer with an "API KEY REQUIRED" watermark, so use Esri's canvases instead.
  dark: {
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 16,
    attribution: "Map © Esri, HERE, Garmin, OpenStreetMap contributors",
  },
  light: {
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 16,
    attribution: "Map © Esri, HERE, Garmin, OpenStreetMap contributors",
  },
  satellite: {
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    // Past this level Esri serves "data not yet available" placeholder tiles in many areas.
    maxZoom: 17,
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
  },
};

export function attributionFor(basemap: BasemapId): string {
  return basemap === "none" ? "" : PROVIDERS[basemap].attribution;
}

export type GroundSpec = {
  basemap: BasemapId;
  /** Mercator bounds the texture covers. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
  /** Fade the edges to transparent, used when the ground floats in 3D. */
  fade: boolean;
  theme: Theme;
};

export type MapStatus = { state: "idle" | "loading" | "ready" | "error"; message: string };

let status: MapStatus = { state: "idle", message: "" };
const listeners = new Set<() => void>();

function setStatus(next: MapStatus) {
  status = next;
  listeners.forEach((fn) => fn());
}

export function subscribeMap(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function mapStatus(): MapStatus {
  return status;
}

const tiles = new Map<string, Promise<HTMLImageElement | null>>();

function loadTile(url: string): Promise<HTMLImageElement | null> {
  const hit = tiles.get(url);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  tiles.set(url, p);
  // Don't hold on to failures, the next attempt may work.
  void p.then((img) => {
    if (!img) tiles.delete(url);
  });
  return p;
}

function key(spec: GroundSpec): string {
  const f = (v: number) => v.toFixed(9);
  return [
    spec.basemap,
    f(spec.minX),
    f(spec.minY),
    f(spec.maxX),
    f(spec.maxY),
    spec.w,
    spec.h,
    spec.fade ? "fade" : "full",
    spec.basemap === "none" ? spec.theme.id : "",
  ].join("|");
}

const ground = new Map<string, HTMLCanvasElement>();
const pending = new Map<string, Promise<HTMLCanvasElement>>();
const failed = new Set<string>();

function remember(k: string, canvas: HTMLCanvasElement) {
  ground.set(k, canvas);
  while (ground.size > 8) {
    const oldest = ground.keys().next().value;
    if (oldest === undefined) break;
    ground.delete(oldest);
  }
}

function applyFade(c: HTMLCanvasElement) {
  const g = c.getContext("2d");
  if (!g) return;
  g.save();
  g.globalCompositeOperation = "destination-in";
  const r = c.width / 2;
  const grad = g.createRadialGradient(r, c.height / 2, r * 0.46, r, c.height / 2, r);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.78)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  g.restore();
}

function buildPlane(spec: GroundSpec): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = spec.w;
  c.height = spec.h;
  const g = c.getContext("2d");
  if (!g) return c;
  const dark = spec.theme.mode === "dark";
  g.fillStyle = dark ? "rgba(255,255,255,0.05)" : "rgba(28,20,14,0.05)";
  g.fillRect(0, 0, c.width, c.height);
  const cells = 18;
  g.strokeStyle = spec.theme.grid;
  g.lineWidth = Math.max(1.5, c.width / 700);
  g.beginPath();
  for (let i = 0; i <= cells; i++) {
    const p = (i / cells) * c.width;
    g.moveTo(p, 0);
    g.lineTo(p, c.height);
    g.moveTo(0, p);
    g.lineTo(c.width, p);
  }
  g.stroke();
  return c;
}

async function buildGround(spec: GroundSpec): Promise<HTMLCanvasElement> {
  if (spec.basemap === "none") {
    const plane = buildPlane(spec);
    if (spec.fade) applyFade(plane);
    return plane;
  }
  const provider = PROVIDERS[spec.basemap];
  const c = document.createElement("canvas");
  c.width = spec.w;
  c.height = spec.h;
  const g = c.getContext("2d");
  if (!g) throw new Error("Could not draw the map.");

  const spanX = spec.maxX - spec.minX;
  const spanY = spec.maxY - spec.minY;
  const pxPerX = spec.w / spanX;
  const pxPerY = spec.h / spanY;
  let z = Math.ceil(Math.log2(pxPerX / 220));
  z = Math.max(1, Math.min(provider.maxZoom, z));

  let x0 = 0;
  let x1 = 0;
  let y0 = 0;
  let y1 = 0;
  for (;;) {
    const n = 2 ** z;
    x0 = Math.max(0, Math.floor(spec.minX * n));
    x1 = Math.min(n - 1, Math.floor(spec.maxX * n));
    y0 = Math.max(0, Math.floor(spec.minY * n));
    y1 = Math.min(n - 1, Math.floor(spec.maxY * n));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 80 || z <= 1) break;
    z--;
  }

  const n = 2 ** z;
  const jobs: Promise<void>[] = [];
  let okCount = 0;
  let total = 0;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      total++;
      jobs.push(
        loadTile(provider.url(z, tx, ty)).then((img) => {
          if (!img) return;
          okCount++;
          const dx = (tx / n - spec.minX) * pxPerX;
          const dy = (ty / n - spec.minY) * pxPerY;
          g.drawImage(img, dx, dy, pxPerX / n + 0.7, pxPerY / n + 0.7);
        }),
      );
    }
  }
  await Promise.all(jobs);
  if (okCount === 0) throw new Error("Couldn't load map tiles. Check your connection.");
  if (okCount < total * 0.6) {
    console.warn(`Only ${okCount}/${total} map tiles loaded.`);
  }
  if (spec.fade) applyFade(c);
  return c;
}

/** Resolves once the ground texture for this spec is ready. */
export function loadGround(spec: GroundSpec): Promise<HTMLCanvasElement> {
  const k = key(spec);
  const hit = ground.get(k);
  if (hit) return Promise.resolve(hit);
  const running = pending.get(k);
  if (running) return running;
  setStatus({ state: "loading", message: "" });
  const p = buildGround(spec)
    .then((c) => {
      remember(k, c);
      failed.delete(k);
      pending.delete(k);
      if (pending.size === 0) setStatus({ state: "ready", message: "" });
      return c;
    })
    .catch((error: unknown) => {
      failed.add(k);
      pending.delete(k);
      setStatus({ state: "error", message: error instanceof Error ? error.message : "Map failed to load." });
      throw error;
    });
  pending.set(k, p);
  return p;
}

/** Returns the texture if it's ready, otherwise starts loading it and returns null. */
export function getGround(spec: GroundSpec): HTMLCanvasElement | null {
  const k = key(spec);
  const hit = ground.get(k);
  if (hit) return hit;
  if (spec.basemap === "none") {
    // Procedural, so no need to wait for anything.
    const plane = buildPlane(spec);
    if (spec.fade) applyFade(plane);
    remember(k, plane);
    return plane;
  }
  if (!pending.has(k) && !failed.has(k)) {
    loadGround(spec).catch(() => {});
  }
  return null;
}

/** Forget a failure so the next render tries again. */
export function retryMap() {
  failed.clear();
  setStatus({ state: "idle", message: "" });
}
