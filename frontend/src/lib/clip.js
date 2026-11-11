// Short video clips, prepared in the browser before they're stored for upload.
//
// Phones and camera apps export HEVC in a QuickTime file more often than not,
// which some browsers can't play. Every clip leaves here as an H.264 MP4 with
// the index at the front (playback starts before the whole file has loaded)
// and no metadata from the camera or phone, location included.
//   - H.264 at up to 1080p and a sane bitrate: the video is copied as is
//     (seconds, no quality lost).
//   - Anything else (HEVC, 4K, very high bitrates): re-encoded once to 1080p
//     at about 8 Mbit/s.
// Sound is kept (AAC is copied). A poster frame is taken from the result; it's
// the clip's `image`, so thumbnails and the offline cache treat it like a photo.
//
// Mediabunny is only loaded when a clip is added, and the precache keeps it
// for offline use, so clips can be added at the dive site too.

export const CLIP = {
  maxBytes: 200 * 1024 * 1024, // the server's limit for the video field
  maxLong: 1920,
  maxShort: 1080,
  copyMaxBitrate: 16_000_000,
  posterMax: 1280,
};

export class ClipError extends Error {}

const VIDEO_EXT = /\.(mp4|m4v|mov|qt|webm|mkv|3gp)$/i;

export function isClipFile(file) {
  return (file.type || "").startsWith("video/") || VIDEO_EXT.test(file.name || "");
}

/** Whether a photos record is a clip. */
export const isClip = (rec) => !!(rec?.video || rec?._video);

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * What to do with a video: copy its stream, or re-encode it, and at what size
 * and bitrate. `codec` uses Mediabunny's names ("avc", "hevc", "vp9", ...).
 */
export function clipPlan({ codec, width, height, bitrate, fps }) {
  const scale = Math.min(1, CLIP.maxLong / Math.max(width, height), CLIP.maxShort / Math.min(width, height));
  const size = scale < 1 ? { width: even(width * scale), height: even(height * scale) } : { width, height };
  if (codec === "avc" && scale === 1 && bitrate > 0 && bitrate <= CLIP.copyMaxBitrate) {
    return { copy: true, ...size, bitrate };
  }
  // 8 Mbit/s at 1080p30 keeps sand and silt detail in dark footage; less for
  // smaller frames, more for 60 fps.
  const pixels = (size.width * size.height) / (1920 * 1080);
  const target = 8_000_000 * Math.pow(pixels, 0.95) * (fps > 40 ? 1.5 : 1);
  return { copy: false, ...size, bitrate: Math.round(Math.min(12_000_000, Math.max(2_000_000, target)) / 100_000) * 100_000 };
}

/** Roughly how big the prepared clip will be, in bytes. */
export function estimateBytes(plan, duration, fileSize) {
  if (plan.copy) return fileSize;
  return Math.round(((plan.bitrate + 192_000) * duration) / 8);
}

/** How many minutes fit under the size limit at a given bitrate. */
export function minutesThatFit(bitrate) {
  return Math.floor(((CLIP.maxBytes * 8) / (bitrate + 192_000) / 60) * 2) / 2;
}

export function formatClipLength(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const CODEC_NAMES = { avc: "H.264", hevc: "HEVC (H.265)", vp8: "VP8", vp9: "VP9", av1: "AV1", prores: "ProRes" };

function baseName(name) {
  return (name || "clip").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 40) || "clip";
}

async function canvasToJpeg(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("no poster"))), "image/jpeg", 0.85));
}

/** A frame a little way in (edited clips often fade in from black). */
const posterTime = (duration) => Math.min(duration * 0.25, 2);

async function posterWithMediabunny(mb, blob, duration, size) {
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    const landscape = size.width >= size.height;
    const sink = new mb.CanvasSink(track, landscape ? { width: Math.min(size.width, CLIP.posterMax) } : { height: Math.min(size.height, CLIP.posterMax) });
    const frame = (await sink.getCanvas(posterTime(duration))) || (await sink.getCanvas(0));
    if (!frame) throw new Error("no frame");
    return canvasToJpeg(frame.canvas);
  } finally {
    input.dispose();
  }
}

function posterWithVideoElement(blob, duration, size) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const done = (fn, arg) => {
      URL.revokeObjectURL(url);
      fn(arg);
    };
    v.onerror = () => done(reject, new Error("no poster"));
    v.onloadeddata = () => (v.currentTime = posterTime(duration));
    v.onseeked = async () => {
      try {
        const scale = Math.min(1, CLIP.posterMax / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * scale) || size.width;
        c.height = Math.round(v.videoHeight * scale) || size.height;
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        done(resolve, await canvasToJpeg(c));
      } catch (e) {
        done(reject, e);
      }
    };
    v.src = url;
  });
}

/**
 * Prepare a picked video for upload.
 * Returns { blob (poster JPEG), fileName, video (MP4 Blob), videoName,
 *           duration, width, height, copied, soundDropped }.
 * onProgress(0..1) is called while converting.
 */
export async function prepareClip(file, { onProgress } = {}) {
  let mb;
  try {
    mb = await import("mediabunny");
  } catch {
    throw new ClipError("Couldn't load the video tools. Open the app once with a connection, then try again.");
  }
  const name = file.name || "that file";
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
  try {
    let video;
    try {
      video = await input.getPrimaryVideoTrack();
    } catch {
      throw new ClipError(`Couldn't read ${name}. Pick a video file (MP4 or MOV).`);
    }
    if (!video) throw new ClipError(`${name} has no video in it.`);

    const duration = await input.computeDuration();
    const stats = await video.computePacketStats(150);
    const plan = clipPlan({
      codec: video.codec,
      width: video.displayWidth,
      height: video.displayHeight,
      bitrate: stats.averageBitrate,
      fps: stats.averagePacketRate,
    });
    if (estimateBytes(plan, duration, file.size) > CLIP.maxBytes) {
      throw new ClipError(
        `That clip is ${formatClipLength(duration)} long. Clips can be up to about ${minutesThatFit(plan.bitrate)} minutes; shorten it in your editing app first.`,
      );
    }
    if (!plan.copy) {
      const codecName = CODEC_NAMES[video.codec] || "this kind of";
      if (!(await video.canDecode())) {
        throw new ClipError(`This browser can't read ${codecName} video, so it can't convert the clip. Export it as H.264 instead, or add it from Safari or Chrome on your phone.`);
      }
      if (!(await mb.canEncodeVideo("avc", { width: plan.width, height: plan.height }))) {
        throw new ClipError("This browser can't convert video. Add the clip from Safari (iOS 26 or later) or Chrome.");
      }
    }

    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const landscape = plan.width >= plan.height;
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: plan.copy
        ? {}
        : {
            codec: "avc",
            ...(landscape ? { width: plan.width } : { height: plan.height }),
            quality: new mb.Quality({ bitrate: plan.bitrate }),
            forceTranscode: true,
          },
      audio: { codec: "aac" },
      tags: {}, // nothing from the camera or phone, location included
      showWarnings: false,
    });
    if (!conversion.isValid) throw new ClipError(`Couldn't convert ${name}.`);
    const soundDropped = conversion.discardedTracks.some((d) => d.track.isAudioTrack() && d.reason !== "discarded_by_user");
    conversion.onProgress = (p) => onProgress?.(Math.min(0.97, p * 0.97));
    await conversion.execute();

    const out = new Blob([output.target.buffer], { type: "video/mp4" });
    if (out.size > CLIP.maxBytes) throw new ClipError(`That clip comes to ${Math.round(out.size / 1048576)} MB; the limit is 200 MB. Shorten it first.`);
    const size = { width: plan.width, height: plan.height };

    let poster;
    try {
      poster = await posterWithMediabunny(mb, out, duration, size);
    } catch {
      poster = await posterWithVideoElement(out, duration, size).catch(() => {
        throw new ClipError(`Couldn't make a preview picture for ${name}.`);
      });
    }
    onProgress?.(1);
    const base = baseName(file.name);
    return {
      blob: poster,
      fileName: `${base}.jpg`,
      video: out,
      videoName: `${base}.mp4`,
      duration: Math.round(duration * 10) / 10,
      width: size.width,
      height: size.height,
      copied: plan.copy,
      soundDropped,
    };
  } catch (e) {
    if (e instanceof ClipError) throw e;
    throw new ClipError(`Couldn't convert ${name}: ${e?.message || e}`);
  } finally {
    input.dispose();
  }
}
