import { test } from "node:test";
import assert from "node:assert/strict";
import { clipPlan, estimateBytes, minutesThatFit, formatClipLength, isClipFile, isClip, CLIP } from "../src/lib/clip.js";

test("H.264 at up to 1080p is copied as is", () => {
  assert.deepEqual(clipPlan({ codec: "avc", width: 1920, height: 1080, bitrate: 9_000_000, fps: 30 }), { copy: true, width: 1920, height: 1080, bitrate: 9_000_000 });
  assert.equal(clipPlan({ codec: "avc", width: 1080, height: 1920, bitrate: 12_000_000, fps: 30 }).copy, true, "portrait");
  assert.equal(clipPlan({ codec: "avc", width: 1280, height: 720, bitrate: 900_000, fps: 30 }).copy, true);
});

test("HEVC, oversized or very high-bitrate video is re-encoded to fit 1080p", () => {
  // the DJI app's export: HEVC, portrait 1080×1920, 13.8 Mbit/s
  assert.deepEqual(clipPlan({ codec: "hevc", width: 1080, height: 1920, bitrate: 13_800_000, fps: 30 }), { copy: false, width: 1080, height: 1920, bitrate: 8_000_000 });
  assert.deepEqual(clipPlan({ codec: "avc", width: 3840, height: 2160, bitrate: 60_000_000, fps: 30 }), { copy: false, width: 1920, height: 1080, bitrate: 8_000_000 });
  assert.deepEqual(clipPlan({ codec: "hevc", width: 2160, height: 3840, bitrate: 50_000_000, fps: 60 }), { copy: false, width: 1080, height: 1920, bitrate: 12_000_000 }, "60 fps gets more");
  assert.equal(clipPlan({ codec: "avc", width: 1920, height: 1080, bitrate: 40_000_000, fps: 60 }).copy, false, "camera-original bitrate");
  // wide formats fit the long side; odd sizes come out even
  assert.deepEqual(clipPlan({ codec: "vp9", width: 2560, height: 1080, bitrate: 5_000_000, fps: 30 }), { copy: false, width: 1920, height: 810, bitrate: 6_100_000 });
  assert.deepEqual(clipPlan({ codec: "hevc", width: 1440, height: 1440, bitrate: 9_000_000, fps: 30 }), { copy: false, width: 1080, height: 1080, bitrate: 4_600_000 });
  // small video isn't starved
  assert.equal(clipPlan({ codec: "vp8", width: 640, height: 360, bitrate: 1_000_000, fps: 30 }).bitrate, 2_000_000);
});

test("size estimates and limits", () => {
  const plan = clipPlan({ codec: "hevc", width: 1080, height: 1920, bitrate: 13_800_000, fps: 30 });
  assert.equal(estimateBytes(plan, 60, 0), 61_440_000, "about 60 MB a minute at 1080p");
  assert.equal(estimateBytes({ copy: true }, 60, 123), 123, "a copy is as big as the file");
  assert.equal(minutesThatFit(8_000_000), 3);
  assert.ok(estimateBytes(plan, 3.5 * 60, 0) > CLIP.maxBytes, "3.5 minutes is too long");
});

test("clip lengths read as m:ss", () => {
  assert.equal(formatClipLength(3.93), "0:04");
  assert.equal(formatClipLength(75), "1:15");
  assert.equal(formatClipLength(undefined), "0:00");
});

test("which picked files are clips, and which records", () => {
  assert.equal(isClipFile({ type: "video/quicktime", name: "IMG_0001.MOV" }), true);
  assert.equal(isClipFile({ type: "", name: "dji_export.mp4" }), true);
  assert.equal(isClipFile({ type: "image/jpeg", name: "cave.jpg" }), false);
  assert.equal(isClip({ image: "p.jpg", video: "c.mp4" }), true);
  assert.equal(isClip({ image: "p.jpg", _video: {} }), true);
  assert.equal(isClip({ image: "p.jpg", video: "" }), false);
});
