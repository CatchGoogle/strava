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
import { LegalPage, pageFromHash } from "./legal";
import { parseGpx } from "./lib/gpx";
import { mapStatus, retryMap, subscribeMap } from "./lib/map";
import { renderCard } from "./lib/render";
import { SAMPLE_PLACES, SAMPLES } from "./lib/samples";
import {
  activityFromStrava,
  beginLogin,
  clearCreds,
  clearOAuthQuery,
  clearSession,
  exchangeCode,
  freshSession,
  listActivities,
  loadCreds,
  loadSession,
  oauthCallback,
  oauthStateMatches,
  saveCreds,
  type StravaCreds,
  type StravaListItem,
  type StravaSession,
} from "./lib/strava";
import type { Activity, BasemapId, ChartId, ColorBy, FormatId, PrivacyStyle, RenderInput, Units, View } from "./lib/types";

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

function stravaAuthEnded(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /expired|rejected the login|connect again/i.test(message);
}

function formatPrivacy(meters: number, unit: Units): string {
  if (meters < 1) return "Off";
  if (unit === "mi") {
    const miles = meters / 1609.344;
    if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`;
    return `${miles.toFixed(2)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

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
  const [ease, setEase] = useState(1);
  const [showDistanceTip, setShowDistanceTip] = useState(true);
  const [camera, setCamera] = useState(1);
  const [privacyM, setPrivacyM] = useState(0);
  const [privacy, setPrivacy] = useState<PrivacyStyle>("fade");
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
  const [creds, setCreds] = useState<StravaCreds | null>(() => loadCreds());
  const [session, setSession] = useState<StravaSession | null>(null);
  const [stravaActs, setStravaActs] = useState<StravaListItem[]>([]);
  const [stravaPage, setStravaPage] = useState(1);
  const [stravaMore, setStravaMore] = useState(false);
  const [stravaBusy, setStravaBusy] = useState<"connect" | "list" | "more" | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [editingCreds, setEditingCreds] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [deletionNote, setDeletionNote] = useState<string | null>(null);
  const [doc, setDoc] = useState(pageFromHash);

  const playheadRef = useRef(1);
  const activityRef = useRef(activity);
  const wipeRef = useRef<(options: { keepCreds: boolean; because?: "revoked" }) => void>(() => {});
  activityRef.current = activity;
  const easeAmount = useRef(1);
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
    let cancel = false;
    const callback = oauthCallback();
    const returning = Boolean(callback.code || callback.error);
    if (returning) clearOAuthQuery();

    void (async () => {
      try {
        if (callback.error) {
          if (!cancel) setError(callback.error === "access_denied" ? "Strava login was cancelled." : "Strava login failed.");
          return;
        }
        let next = loadSession();
        if (callback.code) {
          if (!oauthStateMatches(callback.state)) {
            if (!cancel) setError("Strava login could not be verified. Try connecting again.");
            return;
          }
          if (!cancel) setStravaBusy("connect");
          next = await exchangeCode(callback.code);
        } else if (next) {
          next = await freshSession(next);
        }
        if (!next || cancel) return;
        setSession(next);
        setStravaBusy("list");
        const page = await listActivities(next, 1);
        if (cancel) return;
        setStravaActs(page.items);
        setStravaPage(1);
        setStravaMore(page.raw === 30);
      } catch (err) {
        if (cancel) return;
        if (stravaAuthEnded(err)) wipeRef.current({ keepCreds: true, because: "revoked" });
        else setError(err instanceof Error ? err.message : "Could not reach Strava.");
      } finally {
        if (!cancel) setStravaBusy(null);
      }
    })();

    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const sync = () => setDoc(pageFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const privacyMax = Math.min(1609.344, activity.distanceM * 0.45);
  const privacyStep = Math.min(units === "mi" ? 80.467 : 50, Math.max(10, privacyMax));

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
      ease,
      showDistanceTip,
      camera,
      privacyM: Math.min(privacyM, privacyMax),
      privacy,
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
      ease,
      showDistanceTip,
      camera,
      privacyM,
      privacyMax,
      privacy,
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

  function connectSaved() {
    if (!creds || !agreed) {
      setError("Read the data notice and check the consent box before connecting.");
      return;
    }
    setError(null);
    beginLogin(creds.clientId);
  }

  function saveApiApp() {
    const id = clientId.trim();
    const secret = clientSecret.trim();
    if (!/^\d+$/.test(id) || secret.length < 8) {
      setError("Paste the numeric client ID and the client secret from your Strava API app.");
      return;
    }
    saveCreds({ clientId: id, clientSecret: secret });
    setCreds({ clientId: id, clientSecret: secret });
    setClientSecret("");
    setEditingCreds(false);
    setError(null);
  }

  function wipeStrava(options: { keepCreds: boolean; because?: "revoked" }) {
    clearSession();
    setSession(null);
    setStravaActs([]);
    setStravaMore(false);
    setStravaPage(1);
    if (!options.keepCreds) {
      clearCreds();
      setCreds(null);
      setClientId("");
      setClientSecret("");
      setEditingCreds(false);
      setAgreed(false);
    }
    if (activityRef.current.source === "strava") applyActivity(SAMPLES[0]);
    const when = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const lead = options.because === "revoked" ? `Strava ended this login. Deleted on ${when}.` : `Deleted on ${when}.`;
    setDeletionNote(
      `${lead} The Strava login, the activity list, and any Strava route loaded in this browser were removed. Activities on Strava itself were not deleted.`,
    );
    setError(null);
  }
  wipeRef.current = wipeStrava;

  async function loadMoreStrava() {
    if (!session || stravaBusy) return;
    setStravaBusy("more");
    setError(null);
    try {
      const next = await freshSession(session);
      setSession(next);
      const page = await listActivities(next, stravaPage + 1);
      setStravaActs((current) => [...current, ...page.items]);
      setStravaPage((current) => current + 1);
      setStravaMore(page.raw === 30);
    } catch (err) {
      if (stravaAuthEnded(err)) wipeStrava({ keepCreds: true, because: "revoked" });
      else setError(err instanceof Error ? err.message : "Could not load more activities.");
    } finally {
      setStravaBusy(null);
    }
  }

  async function pickStrava(item: StravaListItem) {
    if (!session || loadingId != null) return;
    setLoadingId(item.id);
    setError(null);
    try {
      const next = await freshSession(session);
      setSession(next);
      applyActivity(await activityFromStrava(next, item));
    } catch (err) {
      if (stravaAuthEnded(err)) wipeStrava({ keepCreds: true, because: "revoked" });
      else setError(err instanceof Error ? err.message : "Could not load that activity.");
    } finally {
      setLoadingId(null);
    }
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
    <>
    {doc !== "studio" ? <LegalPage kind={doc} /> : null}
    <div className="studio" hidden={doc !== "studio"}>
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
            <p>Route graphics</p>
          </div>
        </div>

        <section>
          <div className="section-label">ACTIVITY</div>
          {session ? (
            <div className="strava-bar">
              <span>Signed in as {session.athlete}</span>
              <span className="strava-actions">
                <button className="linkish" onClick={() => wipeStrava({ keepCreds: true })}>
                  Disconnect
                </button>
                <button className="linkish" onClick={() => wipeStrava({ keepCreds: false })}>
                  Delete my Strava data
                </button>
              </span>
            </div>
          ) : null}
          <StravaNotice />
          {!creds || editingCreds ? (
            <form
              className="strava-setup"
              onSubmit={(event) => {
                event.preventDefault();
                saveApiApp();
              }}
            >
              <p className="hint tight">
                Create your own app at{" "}
                <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer">
                  strava.com/settings/api
                </a>
                . Set the website to this page and the Authorization Callback Domain to <em>catchgoogle.github.io</em>. The
                secret stays in this browser.
              </p>
              <label className="field">
                <span>Client ID</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Client secret</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                />
              </label>
              <button className="upload" type="submit">
                Save API app
              </button>
              {creds ? (
                <button className="linkish" type="button" onClick={() => setEditingCreds(false)}>
                  Cancel
                </button>
              ) : null}
            </form>
          ) : session ? (
            <div className="acts">
              {stravaBusy === "list" || stravaBusy === "connect" ? <p className="summary quiet">Loading activities…</p> : null}
              {stravaActs.map((item) => (
                <button
                  key={item.id}
                  className="act"
                  aria-pressed={activity.id === `strava-${item.id}`}
                  disabled={loadingId != null}
                  onClick={() => void pickStrava(item)}
                >
                  <strong>{loadingId === item.id ? "Loading…" : item.name}</strong>
                  <small>
                    {new Date(item.start).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {" · "}
                    {item.sport}
                    {" · "}
                    {formatDistance(item.distance, units)} {distanceLabel(units).toLowerCase()}
                  </small>
                </button>
              ))}
              {stravaBusy == null && stravaActs.length === 0 ? (
                <p className="summary quiet">No GPS activities on this page.</p>
              ) : null}
              {stravaMore ? (
                <button className="upload" disabled={stravaBusy != null} onClick={() => void loadMoreStrava()}>
                  {stravaBusy === "more" ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="strava-setup">
              <label className="consent">
                <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
                <span>I agree to the privacy notice and terms, and I consent to this collection.</span>
              </label>
              <button
                className="strava-connect"
                type="button"
                aria-label="Connect with Strava"
                disabled={!agreed || stravaBusy != null}
                onClick={connectSaved}
              >
                <img
                  src={`${import.meta.env.BASE_URL}btn_strava_connect_with_orange.svg`}
                  alt="Connect with Strava"
                  height={48}
                />
              </button>
              <button
                className="linkish"
                onClick={() => {
                  setClientId(creds.clientId);
                  setClientSecret("");
                  setEditingCreds(true);
                }}
              >
                Change API app
              </button>
              <button className="linkish" onClick={() => wipeStrava({ keepCreds: false })}>
                Delete my Strava data
              </button>
            </div>
          )}
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
          {activity.source === "strava" ? (
            <a
              className="view-strava"
              href={`https://www.strava.com/activities/${activity.id.slice("strava-".length)}`}
              target="_blank"
              rel="noreferrer"
            >
              View on Strava
            </a>
          ) : null}
          {deletionNote ? <div className="notice">{deletionNote}</div> : null}
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
          <div className="section-label">TRACE</div>
          <div className="sub-label">Draw</div>
          <div className="seg two" role="radiogroup" aria-label="Draw speed">
            <button aria-pressed={ease <= 0} onClick={() => setEase(0)}>
              Linear
            </button>
            <button
              aria-pressed={ease > 0}
              onClick={() => setEase(easeAmount.current > 0 ? easeAmount.current : 1)}
            >
              Eased
            </button>
          </div>
          {ease > 0 ? (
            <Slider
              label="Ease"
              value={ease}
              min={0.05}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => {
                easeAmount.current = v;
                setEase(v);
              }}
            />
          ) : null}
          <div className="toggles">
            <button className="chip" aria-pressed={showDistanceTip} onClick={() => setShowDistanceTip((v) => !v)}>
              Distance label
            </button>
          </div>
          <div className="sub-label">Hide start and end</div>
          <Slider
            label="Distance"
            value={Math.min(privacyM, privacyMax)}
            min={0}
            max={Math.max(privacyMax, privacyStep)}
            step={privacyStep}
            format={(v) => formatPrivacy(v, units)}
            onChange={setPrivacyM}
          />
          <div className="seg two" role="radiogroup" aria-label="Privacy style">
            <button aria-pressed={privacy === "fade"} onClick={() => setPrivacy("fade")}>
              Fade
            </button>
            <button aria-pressed={privacy === "omit"} onClick={() => setPrivacy("omit")}>
              Cut
            </button>
          </div>
          <p className="hint tight">
            Fades or cuts the map within this distance of the start and finish, the way Strava hides the ends of a route.
            Stats still cover the whole activity.
          </p>
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
            label="Camera distance"
            value={camera}
            min={0.4}
            max={2.5}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={setCamera}
          />
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
          Connect with Strava to pick a past activity, or drop a GPX anywhere on this page. Space plays the draw-on. Arrow
          keys nudge the timeline.
        </p>
        <p className="legal-links">
          <a href="#privacy">Privacy</a>
          <a href="#terms">Terms</a>
          <a href="https://github.com/CatchGoogle/strava/issues" target="_blank" rel="noreferrer">
            Support
          </a>
          <a href="https://www.strava.com/dashboard" target="_blank" rel="noreferrer">
            Your Strava account
          </a>
          <span>Compatible with Strava</span>
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
    </>
  );
}

function StravaNotice() {
  return (
    <div className="notice strava-notice">
      <p>Before connecting, TRACE will collect this from your own Strava account, in this browser only:</p>
      <ul>
        <li>Athlete name, activity list, distance, moving time, sport, and date</li>
        <li>GPS, elevation, time, and heart rate for an activity you open</li>
      </ul>
      <p>
        Strava sends it when you approve access. The route stays in memory for this visit. Disconnect or Delete my Strava
        data removes that copy and then confirms the deletion. You can also revoke access at{" "}
        <a href="https://www.strava.com/settings/apps" target="_blank" rel="noreferrer">
          strava.com/settings/apps
        </a>
        . Read the <a href="#privacy">privacy notice</a> and <a href="#terms">terms</a>. Support is on{" "}
        <a href="https://github.com/CatchGoogle/strava/issues" target="_blank" rel="noreferrer">
          GitHub
        </a>
        . Your account is at{" "}
        <a href="https://www.strava.com/dashboard" target="_blank" rel="noreferrer">
          strava.com/dashboard
        </a>
        .
      </p>
    </div>
  );
}
