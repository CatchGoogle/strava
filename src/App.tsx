import { useEffect, useMemo, useRef, useState } from "react";
import { themeById, THEMES } from "./lib/color";
import { canvasToPng, downloadBlob, renderVideo } from "./lib/export";
import {
  distanceLabel,
  formatDistance,
  formatDuration,
  formatGain,
  formatKicker,
  formatPace,
  formatSpeed,
  formatVideoTime,
  FORMATS,
  gainLabel,
  slug,
  speedLabel,
} from "./lib/format";
import { parseGpx } from "./lib/gpx";
import { mapStatus, retryMap, subscribeMap } from "./lib/map";
import { renderCard } from "./lib/render";
import { SAMPLE_PLACES, SAMPLES } from "./lib/samples";
import type { Activity, BasemapId, ChartId, ColorBy, FormatId, RenderInput, Units, View } from "./lib/types";

const DURATIONS = [6, 9, 12];

type Look = {
  id: string;
  name: string;
  apply: {
    theme: string;
    view: View;
    basemap: BasemapId;
    colorBy?: ColorBy;
    mapOpacity?: number;
    relief?: number;
  };
};

const LOOKS: Look[] = [
  { id: "neon", name: "Neon", apply: { theme: "ember", view: "flat", basemap: "none", colorBy: "pace" } },
  { id: "night", name: "Night map", apply: { theme: "ember", view: "flat", basemap: "dark", colorBy: "pace", mapOpacity: 0.95 } },
  { id: "sat", name: "Satellite", apply: { theme: "noir", view: "flat", basemap: "satellite", colorBy: "pace", mapOpacity: 0.9 } },
  { id: "terrain", name: "3D terrain", apply: { theme: "voltage", view: "3d", basemap: "satellite", colorBy: "elevation", mapOpacity: 1, relief: 1 } },
  { id: "holo", name: "Hologram", apply: { theme: "tide", view: "3d", basemap: "none", colorBy: "elevation", relief: 1.1 } },
  { id: "paper", name: "Paper map", apply: { theme: "poster", view: "flat", basemap: "light", colorBy: "pace", mapOpacity: 0.9 } },
];

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span className="field-row">
        {props.label}
        <em>{props.format ? props.format(props.value) : props.value}</em>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [frame, setFrame] = useState({ w: 420, h: 680 });

  const [activity, setActivity] = useState<Activity>(SAMPLES[0]);
  const [title, setTitle] = useState(SAMPLES[0].name);
  const [place, setPlace] = useState(SAMPLE_PLACES[SAMPLES[0].id] ?? "");
  const [discipline, setDiscipline] = useState(SAMPLES[0].discipline);
  const [signature, setSignature] = useState("");
  const [themeId, setThemeId] = useState("ember");
  const [colorBy, setColorBy] = useState<ColorBy>("pace");
  const [format, setFormat] = useState<FormatId>("story");
  const [units, setUnits] = useState<Units>("km");
  const [lineWidth, setLineWidth] = useState(1.1);
  const [showGrid, setShowGrid] = useState(true);
  const [showGrain, setShowGrain] = useState(true);
  const [chart, setChart] = useState<ChartId>("elevation");
  const [uppercaseTitle, setUppercaseTitle] = useState(true);
  const [view, setView] = useState<View>("flat");
  const [basemap, setBasemap] = useState<BasemapId>("none");
  const [mapOpacity, setMapOpacity] = useState(0.92);
  const [pitch, setPitch] = useState(56);
  const [yaw, setYaw] = useState(-28);
  const [relief, setRelief] = useState(1);
  const [orbit, setOrbit] = useState(true);
  const [playhead, setPlayhead] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(9);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"image" | "video" | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  const [mapTick, setMapTick] = useState(0);
  const [map, setMap] = useState(mapStatus());

  const playheadRef = useRef(1);
  const playingRef = useRef(false);
  const durationRef = useRef(9);
  const originRef = useRef(1);
  const startRef = useRef(0);

  useEffect(
    () =>
      subscribeMap(() => {
        setMap(mapStatus());
        setMapTick((t) => t + 1);
      }),
    [],
  );

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setFrame({ w: Math.max(1, rect.width - 44), h: Math.max(1, rect.height - 20) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(async () => {
      await Promise.all([
        document.fonts.load("700 72px Syne"),
        document.fonts.load('500 48px "DM Mono"'),
        document.fonts.load("500 16px Outfit"),
        document.fonts.load("600 16px Outfit"),
      ]);
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const input = useMemo<RenderInput>(
    () => ({
      activity,
      theme: themeById(themeId),
      format,
      colorBy,
      units,
      lineWidth,
      showGrid,
      showGrain,
      chart,
      uppercaseTitle,
      title,
      place,
      discipline,
      signature,
      view,
      basemap,
      mapOpacity,
      pitch,
      yaw,
      relief,
      orbit,
      timeline: 1,
    }),
    [
      activity,
      themeId,
      format,
      colorBy,
      units,
      lineWidth,
      showGrid,
      showGrain,
      chart,
      uppercaseTitle,
      title,
      place,
      discipline,
      signature,
      view,
      basemap,
      mapOpacity,
      pitch,
      yaw,
      relief,
      orbit,
    ],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fontsReady) return;
    const { w, h } = FORMATS[format];
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderCard(ctx, { ...input, timeline: playhead });
  }, [input, playhead, fontsReady, format, mapTick]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      if (!playingRef.current) return;
      const t = originRef.current + (now - startRef.current) / 1000 / durationRef.current;
      if (t >= 1) {
        playheadRef.current = 1;
        setPlayhead(1);
        playingRef.current = false;
        setPlaying(false);
        return;
      }
      playheadRef.current = t;
      setPlayhead(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.code === "ArrowRight") {
        nudge(0.02);
      } else if (event.code === "ArrowLeft") {
        nudge(-0.02);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      setDragOver(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) void loadFile(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyActivity(next: Activity) {
    setActivity(next);
    setTitle(next.name);
    setPlace(SAMPLE_PLACES[next.id] ?? "");
    setDiscipline(next.discipline);
    setError(null);
    pause();
    playheadRef.current = 1;
    setPlayhead(1);
  }

  function applyLook(look: Look) {
    setThemeId(look.apply.theme);
    setView(look.apply.view);
    setBasemap(look.apply.basemap);
    if (look.apply.colorBy) setColorBy(look.apply.colorBy);
    if (look.apply.mapOpacity != null) setMapOpacity(look.apply.mapOpacity);
    if (look.apply.relief != null) setRelief(look.apply.relief);
  }

  function pause() {
    playingRef.current = false;
    setPlaying(false);
  }

  function nudge(delta: number) {
    pause();
    const next = Math.min(1, Math.max(0, playheadRef.current + delta));
    playheadRef.current = next;
    setPlayhead(next);
  }

  function togglePlay() {
    if (exporting) return;
    if (playingRef.current) {
      pause();
      return;
    }
    if (playheadRef.current > 0.985) {
      playheadRef.current = 0;
      setPlayhead(0);
    }
    originRef.current = playheadRef.current;
    startRef.current = performance.now();
    playingRef.current = true;
    setPlaying(true);
  }

  async function loadFile(file: File) {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".gpx") && !file.type.includes("xml") && !file.type.includes("gpx")) {
      setError("TRACE reads GPX. On Strava, open the activity menu and choose Export GPX.");
      return;
    }
    try {
      const text = await file.text();
      if (!text.includes("<gpx") && !text.includes("<GPX")) {
        setError("That file doesn't look like GPX. Export GPX from the activity menu on Strava.");
        return;
      }
      applyActivity(parseGpx(text, file.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that GPX.");
    }
  }

  function posterName(ext: string) {
    const mode = view === "3d" ? "3d" : basemap !== "none" ? "map" : "route";
    return `${slug(title)}-${mode}-${format}.${ext}`;
  }

  async function saveImage() {
    const canvas = canvasRef.current;
    if (!canvas || exporting) return;
    pause();
    setExporting("image");
    setError(null);
    try {
      const blob = await canvasToPng(canvas);
      downloadBlob(blob, posterName("png"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the image.");
    } finally {
      setExporting(null);
    }
  }

  async function saveVideo() {
    if (exporting) return;
    pause();
    setExporting("video");
    setExportProgress(0);
    setError(null);
    try {
      const blob = await renderVideo({ ...input, timeline: 1 }, duration, setExportProgress);
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      downloadBlob(blob, posterName(ext));
      if (ext === "webm") {
        setError("Saved as WebM. Chrome or Edge will export MP4, which Instagram prefers.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the video.");
    } finally {
      setExporting(null);
    }
  }

  function scrub(clientX: number, bounds: DOMRect) {
    pause();
    const next = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    playheadRef.current = next;
    setPlayhead(next);
  }

  const theme = themeById(themeId);
  const spec = FORMATS[format];
  const fit = Math.min(frame.w / spec.w, frame.h / spec.h);
  const usesMap = basemap !== "none";
  const rideLike = activity.distanceM / Math.max(activity.movingTimeS, 1) > 5;

  return (
    <div className="studio">
      <aside className="panel">
        <div className="brand">
          <svg className="mark" viewBox="0 0 36 36" aria-hidden="true">
            <rect width="36" height="36" rx="10" fill="#1c1612" />
            <path
              d="M7 25c4.5-10 6.5-10 9-4.5S21 29 24.5 20 29 12 32 14"
              fill="none"
              stroke="#ff5c39"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          <div>
            <h1>TRACE</h1>
            <p>Strava graphics</p>
          </div>
        </div>

        <section>
          <div className="section-label">ACTIVITY</div>
          <div className="samples">
            {SAMPLES.map((sample) => (
              <button
                key={sample.id}
                className="chip"
                aria-pressed={activity.id === sample.id}
                onClick={() => applyActivity(sample)}
              >
                {sample.name}
              </button>
            ))}
          </div>
          <button className="upload" onClick={() => fileRef.current?.click()}>
            Upload GPX
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = "";
            }}
          />
          <p className="summary">
            {formatDistance(activity.distanceM, units)} {distanceLabel(units).toLowerCase()}
            {" · "}
            {formatDuration(activity.movingTimeS)}
            {" · "}
            {activity.hasElevation ? `${formatGain(activity.gainM, units)} ${gainLabel(units).toLowerCase()}` : "no elevation"}
            {" · "}
            {rideLike
              ? `${formatSpeed(activity.distanceM, activity.movingTimeS, units)} ${speedLabel(units).toLowerCase()}`
              : `${formatPace(activity.distanceM, activity.movingTimeS, units)}${units === "mi" ? "/mi" : "/km"}`}
          </p>
          <p className="summary quiet">
            {formatKicker(activity.start)}
            {activity.fileName ? ` · ${activity.fileName}` : ""}
            {activity.timing === "estimated" ? " · pace estimated" : ""}
          </p>
          {activity.source === "sample" ? <div className="badge">SAMPLE ROUTE</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </section>

        <section>
          <div className="section-label">QUICK LOOKS</div>
          <div className="looks">
            {LOOKS.map((look) => (
              <button key={look.id} className="chip" onClick={() => applyLook(look)}>
                {look.name}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="section-label">SCENE</div>
          <div className="seg two" role="radiogroup" aria-label="View">
            <button aria-pressed={view === "flat"} onClick={() => setView("flat")}>
              Flat
            </button>
            <button aria-pressed={view === "3d"} onClick={() => setView("3d")}>
              2.5D
            </button>
          </div>
          <div className="sub-label">Map layer</div>
          <div className="seg" role="radiogroup" aria-label="Map layer">
            {(
              [
                ["none", "None"],
                ["dark", "Dark"],
                ["light", "Light"],
                ["satellite", "Satellite"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} aria-pressed={basemap === id} onClick={() => setBasemap(id)}>
                {label}
              </button>
            ))}
          </div>
          {usesMap ? (
            <>
              <Slider
                label="Map strength"
                value={mapOpacity}
                min={0.2}
                max={1}
                step={0.02}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={setMapOpacity}
              />
              <div className={`map-status ${map.state}`} role="status">
                {map.state === "loading" ? "Loading map…" : null}
                {map.state === "ready" ? "Map ready" : null}
                {map.state === "error" ? (
                  <>
                    {map.message}{" "}
                    <button
                      className="linkish"
                      onClick={() => {
                        retryMap();
                        setMapTick((t) => t + 1);
                      }}
                    >
                      Retry
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
          {view === "3d" ? (
            <>
              <Slider label="Tilt" value={pitch} min={20} max={78} step={1} format={(v) => `${v}°`} onChange={setPitch} />
              <Slider label="Rotate" value={yaw} min={-90} max={90} step={1} format={(v) => `${v}°`} onChange={setYaw} />
              <Slider
                label="Height"
                value={relief}
                min={0}
                max={2.5}
                step={0.05}
                format={(v) => `${v.toFixed(1)}×`}
                onChange={setRelief}
              />
              <div className="toggles">
                <button className="chip" aria-pressed={orbit} onClick={() => setOrbit((v) => !v)}>
                  Camera move in video
                </button>
              </div>
              {!activity.hasElevation ? <p className="hint tight">This activity has no elevation, so it stays flat.</p> : null}
            </>
          ) : null}
          {usesMap && activity.source === "sample" ? (
            <p className="hint tight">Sample routes follow real streets in New York and Marin.</p>
          ) : null}
        </section>

        <section>
          <div className="section-label">LOOK</div>
          <div className="swatches" role="radiogroup" aria-label="Theme">
            {THEMES.map((item) => (
              <button
                key={item.id}
                className="swatch"
                aria-pressed={item.id === themeId}
                aria-label={item.name}
                title={item.name}
                onClick={() => setThemeId(item.id)}
                style={{
                  background: `linear-gradient(140deg, ${item.bg}, ${item.ramp[0]} 40%, ${item.ramp[1]} 70%, ${item.ramp[2]})`,
                }}
              />
            ))}
          </div>
          <p className="theme-name">{theme.name}</p>
          <div className="seg three" role="radiogroup" aria-label="Route color">
            {(
              [
                ["pace", rideLike ? "Speed" : "Pace"],
                ["elevation", "Elevation"],
                ["solid", "Solid"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} aria-pressed={colorBy === id} onClick={() => setColorBy(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="sub-label">Chart</div>
          <div className="seg three" role="radiogroup" aria-label="Chart">
            {(
              [
                ["elevation", "Elevation"],
                ["splits", "Splits"],
                ["none", "None"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} aria-pressed={chart === id} onClick={() => setChart(id)}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="section-label">FORMAT</div>
          <div className="seg" role="radiogroup" aria-label="Format">
            {(Object.keys(FORMATS) as FormatId[]).map((id) => (
              <button key={id} aria-pressed={format === id} onClick={() => setFormat(id)}>
                {FORMATS[id].label}
                <small>{FORMATS[id].hint}</small>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="section-label">TYPE</div>
          <label className="field">
            <span>Title</span>
            <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={48} />
          </label>
          <label className="field">
            <span>Place</span>
            <input
              type="text"
              value={place}
              placeholder="Brooklyn"
              onChange={(event) => setPlace(event.target.value)}
              maxLength={32}
            />
          </label>
          <label className="field">
            <span>Label</span>
            <input type="text" value={discipline} onChange={(event) => setDiscipline(event.target.value)} maxLength={24} />
          </label>
          <label className="field">
            <span>Signature</span>
            <input
              type="text"
              value={signature}
              placeholder="@you"
              onChange={(event) => setSignature(event.target.value)}
              maxLength={28}
            />
          </label>
        </section>

        <section>
          <div className="section-label">OPTIONS</div>
          <div className="seg two">
            <button aria-pressed={units === "km"} onClick={() => setUnits("km")}>
              Kilometers
            </button>
            <button aria-pressed={units === "mi"} onClick={() => setUnits("mi")}>
              Miles
            </button>
          </div>
          <Slider
            label="Line weight"
            value={lineWidth}
            min={0.7}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={setLineWidth}
          />
          <div className="toggles">
            <button className="chip" aria-pressed={showGrid} onClick={() => setShowGrid((v) => !v)}>
              Dot grid
            </button>
            <button className="chip" aria-pressed={showGrain} onClick={() => setShowGrain((v) => !v)}>
              Grain
            </button>
            <button className="chip" aria-pressed={uppercaseTitle} onClick={() => setUppercaseTitle((v) => !v)}>
              Caps
            </button>
          </div>
        </section>

        <p className="hint">
          Export a GPX from Strava: open an activity, choose the menu, then Export GPX. Drop it anywhere on this page.
          Space plays the draw-on. Arrow keys nudge the timeline.
        </p>
      </aside>

      <main className="stage">
        <div className="stagebar">
          <span>
            {spec.label.toUpperCase()} · {spec.w}×{spec.h}
          </span>
          <span>
            {theme.name.toUpperCase()}
            {view === "3d" ? " · 2.5D" : ""}
            {usesMap ? ` · ${basemap.toUpperCase()}` : ""}
          </span>
        </div>
        <div className="canvaswrap" ref={frameRef}>
          <canvas
            ref={canvasRef}
            width={spec.w}
            height={spec.h}
            style={{
              width: Math.max(1, Math.floor(spec.w * fit)),
              height: Math.max(1, Math.floor(spec.h * fit)),
            }}
            aria-label="Activity poster preview"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              scrub(event.clientX, event.currentTarget.getBoundingClientRect());
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              scrub(event.clientX, event.currentTarget.getBoundingClientRect());
            }}
          />
        </div>
        <div className="transport">
          <button className="play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} disabled={!!exporting}>
            {playing ? (
              <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                <rect x="2" y="1" width="3.2" height="12" rx="0.6" fill="currentColor" />
                <rect x="8.8" y="1" width="3.2" height="12" rx="0.6" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                <path d="M3 1.2v11.6L12 7 3 1.2z" fill="currentColor" />
              </svg>
            )}
          </button>
          <input
            className="slider"
            type="range"
            min={0}
            max={1000}
            value={Math.round(playhead * 1000)}
            aria-label="Timeline"
            onChange={(event) => {
              pause();
              const next = Number(event.target.value) / 1000;
              playheadRef.current = next;
              setPlayhead(next);
            }}
          />
          <span className="times">
            {formatVideoTime(playhead, duration)} / {formatVideoTime(1, duration)}
          </span>
          <div className="seg duration" role="radiogroup" aria-label="Video length">
            {DURATIONS.map((seconds) => (
              <button key={seconds} aria-pressed={duration === seconds} onClick={() => setDuration(seconds)}>
                {seconds}s
              </button>
            ))}
          </div>
          <div className="exports">
            <button className="btn ghost" onClick={() => void saveImage()} disabled={!!exporting}>
              {exporting === "image" ? "Saving…" : "Save image"}
            </button>
            <button className="btn primary" onClick={() => void saveVideo()} disabled={!!exporting}>
              {exporting === "video" ? `Rendering ${Math.round(exportProgress * 100)}%` : "Save video"}
            </button>
          </div>
        </div>
      </main>
      {dragOver ? <div className="drop">Drop a GPX</div> : null}
    </div>
  );
}
