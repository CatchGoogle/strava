import { analyze } from "./activity";
import type { Activity, TrackPoint } from "./types";

const CREDS_KEY = "trace.strava.creds";
const SESSION_KEY = "trace.strava.session";
const STATE_KEY = "trace.strava.oauth";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const API = "https://www.strava.com/api/v3";

export type StravaCreds = { clientId: string; clientSecret: string };

export type StravaSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athlete: string;
  scope: string;
};

export type StravaListItem = {
  id: number;
  name: string;
  distance: number;
  movingTime: number;
  sport: string;
  start: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
  athlete?: { firstname?: string; lastname?: string };
  message?: string;
};

type ActivityJson = {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  type?: string;
  sport_type?: string;
  start_date: string;
  map?: { summary_polyline?: string | null };
};

type StreamJson = { data?: unknown[] };

export function loadCreds(): StravaCreds | null {
  return readJson<StravaCreds>(CREDS_KEY);
}

export function saveCreds(creds: StravaCreds) {
  localStorage.setItem(CREDS_KEY, JSON.stringify(creds));
}

export function loadSession(): StravaSession | null {
  return readJson<StravaSession>(SESSION_KEY);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function clearCreds() {
  localStorage.removeItem(CREDS_KEY);
}

function saveSession(session: StravaSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function redirectUri(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

export function beginLogin(clientId: string) {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "activity:read_all");
  url.searchParams.set("state", state);
  window.location.assign(url.href);
}

export function oauthCallback(): { code: string | null; error: string | null; state: string | null } {
  const params = new URLSearchParams(window.location.search);
  return { code: params.get("code"), error: params.get("error"), state: params.get("state") };
}

export function clearOAuthQuery() {
  const url = new URL(window.location.href);
  if (!url.search) return;
  url.search = "";
  window.history.replaceState({}, "", url.pathname + url.hash);
}

export function oauthStateMatches(state: string | null): boolean {
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return Boolean(state && expected && state === expected);
}

export async function exchangeCode(code: string): Promise<StravaSession> {
  const creds = loadCreds();
  if (!creds) throw new Error("Save the Strava API client ID and secret in this browser first.");
  const token = await tokenRequest({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: "authorization_code",
  });
  const session = sessionFrom(token, token.scope ?? "");
  if (!session.scope.includes("activity:read")) {
    throw new Error("Strava didn't grant activity access. Connect again and leave that permission checked.");
  }
  saveSession(session);
  return session;
}

export async function freshSession(session: StravaSession): Promise<StravaSession> {
  if (session.expiresAt * 1000 > Date.now() + 120_000) return session;
  const creds = loadCreds();
  if (!creds) throw new Error("The saved Strava API secret is missing. Enter it again, then connect.");
  const token = await tokenRequest({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  });
  const next = sessionFrom(token, session.scope, session.athlete);
  saveSession(next);
  return next;
}

async function tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const body = (await res.json().catch(() => null)) as TokenResponse | null;
  if (!res.ok || !body?.access_token || !body.refresh_token) {
    throw new Error(body?.message || (res.status === 401 ? "Strava rejected the login." : `Strava login failed (${res.status}).`));
  }
  return body;
}

function sessionFrom(token: TokenResponse, scope: string, athleteName?: string): StravaSession {
  const athlete = [token.athlete?.firstname, token.athlete?.lastname].filter(Boolean).join(" ") || athleteName || "Strava";
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_at,
    athlete,
    scope: token.scope || scope,
  };
}

export async function listActivities(
  session: StravaSession,
  page: number,
): Promise<{ items: StravaListItem[]; raw: number }> {
  const url = new URL(`${API}/athlete/activities`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "30");
  const rows = await apiGet<ActivityJson[]>(session, url);
  return {
    raw: rows.length,
    items: rows
      .filter((row) => row.map?.summary_polyline)
      .map((row) => ({
        id: row.id,
        name: row.name || "Activity",
        distance: row.distance,
        movingTime: row.moving_time,
        sport: row.sport_type || row.type || "Activity",
        start: row.start_date,
      })),
  };
}

export async function activityFromStrava(session: StravaSession, item: StravaListItem): Promise<Activity> {
  const url = new URL(`${API}/activities/${item.id}/streams`);
  url.searchParams.set("keys", "latlng,altitude,time,heartrate");
  url.searchParams.set("key_by_type", "true");
  const streams = await apiGet<Record<string, StreamJson>>(session, url);
  const latlng = streams.latlng?.data as [number, number][] | undefined;
  if (!latlng || latlng.length < 2) throw new Error("This activity has no GPS route.");
  const altitude = streams.altitude?.data as number[] | undefined;
  const time = streams.time?.data as number[] | undefined;
  const heartrate = streams.heartrate?.data as number[] | undefined;
  const start = Date.parse(item.start);
  const points: Omit<TrackPoint, "gap">[] = latlng.map((pair, i) => ({
    lat: pair[0],
    lon: pair[1],
    ele: altitude && Number.isFinite(altitude[i]) ? altitude[i] : null,
    time: time && Number.isFinite(time[i]) && Number.isFinite(start) ? start + time[i] * 1000 : null,
    hr: heartrate && Number.isFinite(heartrate[i]) ? heartrate[i] : null,
  }));
  return analyze([points], { id: `strava-${item.id}`, name: item.name, source: "strava", fileName: null });
}

async function apiGet<T>(session: StravaSession, url: URL): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session.accessToken}` } });
  if (res.status === 401) throw new Error("Strava login expired. Connect again.");
  if (res.status === 429) throw new Error("Strava rate limit reached. Wait a few minutes and try again.");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message || `Strava request failed (${res.status}).`);
  }
  return (await res.json()) as T;
}
