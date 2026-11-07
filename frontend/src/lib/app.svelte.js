// Reactive app state on top of the local DB, plus background sync.

import PocketBase, { getTokenPayload } from "pocketbase";
import * as local from "./localdb.js";
import { syncAll, classify, describe } from "./sync.js";
import { offlineDiveIds } from "./offline.js";

export const pb = new PocketBase(location.origin);

const FILE_TOKEN_KEY = "dd:fileToken";
const FILE_TOKEN_RENEW_MS = 12 * 60 * 60 * 1000; // server issues 48h tokens

function readStoredFileToken() {
  try {
    const t = JSON.parse(localStorage.getItem(FILE_TOKEN_KEY) || "null");
    return t?.token ? t : null;
  } catch {
    return null;
  }
}

pb.autoCancellation(false);

export const app = $state({
  ready: false,
  user: pb.authStore.isValid ? pb.authStore.record : null,
  dives: [],
  maps: [],
  photos: [],
  sync: {
    running: false,
    pending: 0,
    lastSync: null,
    // null, or { kind: "offline" | "server" | "busy" | "auth" | "other", message }
    error: null,
    online: navigator.onLine,
    // records the server rejected: { collection, id, dive, title, message }
    problems: [],
    // maps and photos held back until their dive syncs
    waiting: 0,
  },
  fileToken: readStoredFileToken()?.token || "",
});

pb.authStore.onChange(() => {
  app.user = pb.authStore.isValid ? pb.authStore.record : null;
});

const byDateDesc = (a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || ""));
const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || (a.created || a._localUpdated || "").localeCompare(b.created || b._localUpdated || "");

export async function reload() {
  const [dives, maps, photos, pending, lastSync] = await Promise.all([
    local.listAll("dives"),
    local.listAll("maps"),
    local.listAll("photos"),
    local.pendingCount(),
    local.getMeta("lastSync"),
  ]);
  app.dives = dives.sort(byDateDesc);
  app.maps = maps.sort(bySort);
  app.photos = photos.sort(bySort);
  app.sync.pending = pending;
  app.sync.lastSync = lastSync || null;
  updateProblems(dives, maps, photos);
  app.ready = true;
}

function updateProblems(dives, maps, photos) {
  const diveById = new Map(dives.map((d) => [d.id, d]));
  const title = (d) => d?.site || "Untitled dive";
  const problems = [];
  for (const d of dives) {
    if (d._error) problems.push({ collection: "dives", id: d.id, dive: d.id, title: title(d), message: d._error });
  }
  for (const [collection, list, noun] of [["maps", maps, "Map"], ["photos", photos, "Photo"]]) {
    for (const r of list) {
      if (r._error) problems.push({ collection, id: r.id, dive: r.dive, title: `${noun} in ${title(diveById.get(r.dive))}`, message: r._error });
    }
  }
  const stuckDives = new Set(dives.filter((d) => d._error && !d._onServer).map((d) => d.id));
  app.sync.problems = problems;
  app.sync.waiting = [...maps, ...photos].filter((r) => r._dirty && stuckDives.has(r.dive)).length;
}

// ---------- file URLs ----------

const objectUrls = new Map();

/** URL for a map/photo image: local blob while unsynced, server file after. */
export function fileUrl(rec, thumb) {
  if (!rec) return "";
  if (rec._file) {
    let entry = objectUrls.get(rec.id);
    if (!entry || entry.blob !== rec._file) {
      if (entry) URL.revokeObjectURL(entry.url);
      entry = { blob: rec._file, url: URL.createObjectURL(rec._file) };
      objectUrls.set(rec.id, entry);
    }
    return entry.url;
  }
  if (!rec.image) return "";
  // Image files are protected; the token is left out of offline cache keys.
  const params = new URLSearchParams();
  if (thumb) params.set("thumb", thumb);
  if (app.fileToken) params.set("token", app.fileToken);
  const qs = params.toString();
  return `/api/files/${rec.collectionName}/${rec.id}/${encodeURIComponent(rec.image)}${qs ? `?${qs}` : ""}`;
}

/** Offline cache key for a file URL: absolute, without the access token. */
export function cacheKey(url) {
  const u = new URL(url, location.origin);
  u.searchParams.delete("token");
  return u.href;
}

// ---------- file token ----------


async function ensureFileToken() {
  const stored = readStoredFileToken();
  if (stored && Date.now() - stored.at < FILE_TOKEN_RENEW_MS) {
    if (app.fileToken !== stored.token) app.fileToken = stored.token;
    return;
  }
  const token = await pb.files.getToken();
  try {
    localStorage.setItem(FILE_TOKEN_KEY, JSON.stringify({ token, at: Date.now() }));
  } catch {}
  app.fileToken = token;
}

/** Renew the 45-day session at most once a day, not on every sync. */
async function ensureSession() {
  const exp = getTokenPayload(pb.authStore.token)?.exp || 0;
  const daysLeft = (exp * 1000 - Date.now()) / 86_400_000;
  if (daysLeft < 44) await pb.collection("users").authRefresh();
}

/** Download the current trip's maps and photo thumbnails into the offline cache. */
async function warmCache() {
  if (!("caches" in window)) return;
  try {
    const keep = offlineDiveIds(app.dives);
    const cache = await caches.open("dive-files");
    const urls = [
      ...app.maps.filter((m) => keep.has(m.dive) && !m._file && m.image).map((m) => fileUrl(m)),
      ...app.photos.filter((p) => keep.has(p.dive) && !p._file && p.image).map((p) => fileUrl(p, "480x480f")),
    ];
    for (const url of urls) {
      const key = cacheKey(url);
      if (!(await cache.match(key))) {
        const res = await fetch(url);
        if (res.ok) await cache.put(key, res);
      }
    }
  } catch {
    // best effort
  }
}

// ---------- sync ----------

let timer;
let again = false;

export function scheduleSync(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

/**
 * Sync now. force: also retry changes the server rejected before.
 */
export async function syncNow({ force = false } = {}) {
  if (!app.user) return;
  if (!navigator.onLine) {
    app.sync.error = { kind: "offline" };
    return;
  }
  if (app.sync.running) {
    again = true;
    return;
  }
  app.sync.running = true;
  app.sync.error = null;
  try {
    await ensureSession();
    await ensureFileToken();
    await syncAll(pb, { force });
    await reload();
    warmCache();
  } catch (err) {
    const kind = classify(err) || "other";
    if (kind === "auth") {
      app.sync.error = { kind, message: "Your session expired. Sign in again to sync." };
      pb.authStore.clear();
    } else {
      app.sync.error = { kind, message: kind === "other" ? describe(err) : "" };
      if (kind === "busy") scheduleSync(15_000);
      if (kind === "server") scheduleSync(30_000);
    }
    await reload(); // show records that were marked as rejected before the stop
  } finally {
    app.sync.running = false;
    if (again) {
      again = false;
      scheduleSync(200);
    }
  }
}

export async function start() {
  await reload();
  // Ask the browser not to clear offline data under storage pressure.
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {}
  window.addEventListener("online", () => {
    app.sync.online = true;
    syncNow();
  });
  window.addEventListener("offline", () => {
    app.sync.online = false;
    app.sync.error = { kind: "offline" };
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
  });
  setInterval(() => document.visibilityState === "visible" && syncNow(), 120_000);
  syncNow();
}

// ---------- auth ----------

export async function signIn(email, password) {
  await pb.collection("users").authWithPassword(email, password);
  await syncNow();
}

export async function signOut() {
  if (app.sync.pending > 0 && !confirm(`${app.sync.pending} change(s) haven't synced yet and will be lost. Sign out anyway?`)) return;
  pb.authStore.clear();
  try {
    localStorage.removeItem(FILE_TOKEN_KEY);
  } catch {}
  app.fileToken = "";
  await local.clearAll();
  await reload();
}

// ---------- mutations ----------

async function write(collection, record) {
  const saved = await local.save(collection, $state.snapshot(record));
  await reload();
  scheduleSync();
  return saved;
}

export function lastTrip() {
  return app.dives.find((d) => d.trip)?.trip || "";
}

export function tripNames() {
  return [...new Set(app.dives.map((d) => d.trip).filter(Boolean))];
}

export async function createDive() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return write("dives", {
    id: local.newId(),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: "",
    trip: lastTrip(),
    site: "",
    team: "",
    leader: "",
    max_depth: 0,
    avg_depth: 0,
    temp: 0,
    duration: 0,
    navigation: "",
    log: "",
    gas: "",
    dive_no: 0,
    computer: "",
    source: "",
    profile: null,
  });
}

export const saveDive = (dive) => write("dives", dive);
export const saveMap = (map) => write("maps", map);
export const savePhoto = (photo) => write("photos", photo);

export async function deleteRecord(collection, id) {
  await local.remove(collection, id);
  await reload();
  scheduleSync();
}

export async function addMap(diveId, prepared, caption = "") {
  const sort = app.maps.filter((m) => m.dive === diveId).length;
  return write("maps", {
    id: local.newId(),
    dive: diveId,
    caption,
    sort,
    width: prepared.width,
    height: prepared.height,
    markers: [],
    route: [],
    _file: prepared.blob,
    _fileName: prepared.fileName,
  });
}

export async function addPhoto(diveId, prepared) {
  const sort = app.photos.filter((p) => p.dive === diveId).length;
  return write("photos", {
    id: local.newId(),
    dive: diveId,
    caption: "",
    sort,
    _file: prepared.blob,
    _fileName: prepared.fileName,
  });
}

// ---------- shares (online only) ----------

export function newShareToken() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => chars[b % chars.length]).join("");
}

export function shareUrl(token) {
  return `${location.origin}/#/s/${token}`;
}
