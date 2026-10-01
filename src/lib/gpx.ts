import { analyze } from "./activity";
import type { Activity, TrackPoint } from "./types";

type Raw = Omit<TrackPoint, "gap">;

function locals(root: Document | Element, name: string): Element[] {
  const all = root.getElementsByTagName("*");
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === name) out.push(all[i]);
  }
  return out;
}

function childText(el: Element, name: string): string {
  for (const child of el.children) {
    if (child.localName === name && child.textContent) return child.textContent.trim();
  }
  return "";
}

function descendantText(el: Element, name: string): string {
  const all = el.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const node = all[i];
    const text = node?.textContent?.trim();
    if (node?.localName === name && text) return text;
  }
  return "";
}

function readPoint(el: Element): Raw | null {
  const lat = Number(el.getAttribute("lat"));
  const lon = Number(el.getAttribute("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const eleRaw = childText(el, "ele");
  const timeRaw = childText(el, "time");
  const hrRaw = descendantText(el, "hr");
  const ele = eleRaw ? Number(eleRaw) : null;
  const time = timeRaw ? Date.parse(timeRaw) : null;
  const hr = hrRaw ? Number(hrRaw) : null;
  return {
    lat,
    lon,
    ele: ele != null && Number.isFinite(ele) ? ele : null,
    time: time != null && Number.isFinite(time) ? time : null,
    hr: hr != null && Number.isFinite(hr) ? hr : null,
  };
}

export function parseGpx(xml: string, fileName: string | null): Activity {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("That file isn't valid GPX.");
  }

  const segments: Raw[][] = [];
  const tracks = locals(doc, "trk");
  const routes = tracks.length ? [] : locals(doc, "rte");
  const containers = tracks.length ? tracks : routes;
  const pointName = tracks.length ? "trkpt" : "rtept";

  for (const container of containers) {
    const segs = locals(container, "trkseg");
    if (pointName === "trkpt" && segs.length) {
      for (const seg of segs) {
        const pts = locals(seg, "trkpt")
          .map(readPoint)
          .filter((p): p is Raw => p != null);
        if (pts.length) segments.push(pts);
      }
    } else {
      const pts = locals(container, pointName)
        .map(readPoint)
        .filter((p): p is Raw => p != null);
      if (pts.length) segments.push(pts);
    }
  }

  if (!segments.length) {
    const loose = locals(doc, "trkpt")
      .map(readPoint)
      .filter((p): p is Raw => p != null);
    if (loose.length) segments.push(loose);
  }

  const trackName =
    containers.map((c) => childText(c, "name")).find(Boolean) ||
    locals(doc, "metadata").map((m) => childText(m, "name")).find(Boolean) ||
    "";
  const fallback = fileName?.replace(/\.gpx$/i, "").replace(/[_-]+/g, " ").trim() || "Activity";
  const name = trackName || fallback;

  return analyze(segments, {
    id: `gpx-${name}-${segments.reduce((n, s) => n + s.length, 0)}`,
    name,
    source: "gpx",
    fileName,
  });
}
