export type Units = "km" | "mi";

export type ColorBy = "pace" | "elevation" | "solid";

export type FormatId = "story" | "portrait" | "square" | "landscape";

export type View = "flat" | "3d";

export type BasemapId = "none" | "dark" | "light" | "satellite";

export type ChartId = "elevation" | "splits" | "none";

/** How the hidden start and end of the map are drawn. */
export type PrivacyStyle = "fade" | "omit";

export type TrackPoint = {
  lat: number;
  lon: number;
  ele: number | null;
  time: number | null;
  hr: number | null;
  /** Start a new stroke here. The jump from the previous point is not part of the route. */
  gap: boolean;
};

export type Activity = {
  id: string;
  name: string;
  source: "sample" | "gpx" | "strava";
  fileName: string | null;
  points: TrackPoint[];
  distanceM: number;
  gainM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  start: number | null;
  hasHeartRate: boolean;
  hasElevation: boolean;
  timing: "recorded" | "estimated";
  discipline: string;
  loop: boolean;
  cumDist: number[];
  cumMoving: number[];
  cumGain: number[];
  cumHrSum: number[];
  cumHrN: number[];
  /** Heart rate at each point, averaged over the previous few seconds. */
  hrRoll: number[];
  /** Smoothed speed in m/s, for color. */
  speed: number[];
  speedLo: number;
  speedHi: number;
  eleLo: number;
  eleHi: number;
};

export type Slice = {
  distanceM: number;
  movingTimeS: number;
  gainM: number;
  avgHr: number | null;
};

export type Theme = {
  id: string;
  name: string;
  mode: "dark" | "light";
  bg: string;
  spot: string;
  spot2: string;
  vignette: string;
  ink: string;
  muted: string;
  faint: string;
  grid: string;
  ramp: [string, string, string];
  glow: string;
  glowAlpha: number;
  /** Mix toward white for the bright core of the stroke. 0 skips the core. */
  coreMix: number;
  frame: string;
};

export type RenderInput = {
  activity: Activity;
  theme: Theme;
  format: FormatId;
  colorBy: ColorBy;
  units: Units;
  lineWidth: number;
  showGrid: boolean;
  showGrain: boolean;
  chart: ChartId;
  uppercaseTitle: boolean;
  title: string;
  place: string;
  discipline: string;
  signature: string;
  view: View;
  basemap: BasemapId;
  /** 0–1, how strongly the basemap shows through. */
  mapOpacity: number;
  /** Camera tilt in degrees, 0 is straight down. */
  pitch: number;
  /** Camera rotation in degrees. */
  yaw: number;
  /** Multiplier on the automatic height exaggeration. */
  relief: number;
  /** Camera swings in during the video and settles on the chosen angle. */
  orbit: boolean;
  /** 1 frames the whole route. Lower moves the camera closer. */
  camera: number;
  /** 0 draws the route at a constant speed. 1 is a full ease-in and ease-out. */
  ease: number;
  /** Distance pill that follows the head of the trace. */
  showDistanceTip: boolean;
  /** Meters around the start and end left off the map. 0 shows the whole route. */
  privacyM: number;
  privacy: PrivacyStyle;
  /** Video timeline, 0–1. The finished poster is 1. */
  timeline: number;
};
