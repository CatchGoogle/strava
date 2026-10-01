import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { FORMATS } from "./format";
import { prepareMap, renderCard } from "./render";
import type { RenderInput } from "./types";

const FPS = 30;

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode the image.");
  return blob;
}

async function encodeMp4(
  canvas: HTMLCanvasElement,
  renderAt: (timeline: number) => void,
  frames: number,
  onProgress: (ratio: number) => void,
) {
  const width = canvas.width;
  const height = canvas.height;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error instanceof Error ? error : new Error(String(error));
    },
  });

  const codecs = ["avc1.640028", "avc1.4d401f", "avc1.42E01F"];
  let configured = false;
  let lastError: unknown;
  for (const codec of codecs) {
    try {
      encoder.configure({
        codec,
        width,
        height,
        bitrate: width * height > 1_200_000 ? 14_000_000 : 10_000_000,
        framerate: FPS,
        avc: { format: "avc" },
        latencyMode: "quality",
        hardwareAcceleration: "prefer-hardware",
      });
      configured = true;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!configured) throw lastError instanceof Error ? lastError : new Error("This browser can't encode H.264.");

  const frameDuration = Math.round(1_000_000 / FPS);
  for (let i = 0; i < frames; i++) {
    if (encoderError) throw encoderError;
    renderAt(frames === 1 ? 1 : i / (frames - 1));
    const frame = new VideoFrame(canvas, {
      timestamp: i * frameDuration,
      duration: frameDuration,
    });
    encoder.encode(frame, { keyFrame: i % 30 === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 6) {
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    if (i % 2 === 0) {
      onProgress(i / frames);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  await encoder.flush();
  if (encoderError) throw encoderError;
  muxer.finalize();
  encoder.close();
  return new Blob([target.buffer], { type: "video/mp4" });
}

async function encodeWebm(
  canvas: HTMLCanvasElement,
  renderAt: (timeline: number) => void,
  frames: number,
  onProgress: (ratio: number) => void,
) {
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });
  recorder.start();
  for (let i = 0; i < frames; i++) {
    renderAt(frames === 1 ? 1 : i / (frames - 1));
    track.requestFrame();
    onProgress(i / frames);
    await new Promise((resolve) => setTimeout(resolve, Math.round(1000 / FPS)));
  }
  recorder.stop();
  return stopped;
}

export async function renderVideo(
  input: RenderInput,
  durationS: number,
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  const { w, h } = FORMATS[input.format];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not start the video render.");
  const frames = Math.max(2, Math.round(durationS * FPS));
  const renderAt = (timeline: number) => renderCard(ctx, { ...input, timeline });

  // Every frame needs the map imagery, so wait for it rather than render blank frames.
  await prepareMap(ctx, input);

  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
    try {
      onProgress(0);
      return await encodeMp4(canvas, renderAt, frames, onProgress);
    } catch (error) {
      console.warn("MP4 encode failed, falling back to WebM.", error);
    }
  }
  return encodeWebm(canvas, renderAt, frames, onProgress);
}
