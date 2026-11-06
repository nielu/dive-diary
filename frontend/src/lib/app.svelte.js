// Reactive app state on top of the local DB, plus background sync.

import PocketBase from "pocketbase";
import * as local from "./localdb.js";
import { syncAll, SyncAbort } from "./sync.js";

export const pb = new PocketBase(location.origin);
pb.autoCancellation(false);

export const app = $state({
  ready: false,
  user: pb.authStore.isValid ? pb.authStore.record : null,
  dives: [],
  maps: [],
  photos: [],
  sync: { running: false, pending: 0, lastSync: null, error: null, online: navigator.onLine, failed: [] },
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
  app.ready = true;
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
  const base = `/api/files/${rec.collectionName}/${rec.id}/${encodeURIComponent(rec.image)}`;
  return thumb ? `${base}?thumb=${thumb}` : base;
}

/** Download maps and photo thumbnails into the offline cache. */
async function warmCache() {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open("dive-files");
    const urls = [
      ...app.maps.filter((m) => !m._file && m.image).map((m) => fileUrl(m)),
      ...app.photos.filter((p) => !p._file && p.image).map((p) => fileUrl(p, "480x480f")),
    ];
    for (const url of urls) {
      if (!(await cache.match(url))) {
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
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

export async function syncNow() {
  if (!app.user || !navigator.onLine) return;
  if (app.sync.running) {
    again = true;
    return;
  }
  app.sync.running = true;
  app.sync.error = null;
  const failed = [];
  try {
    if (pb.authStore.isValid) await pb.collection("users").authRefresh();
    await syncAll(pb, {
      onError: (collection, rec, err) => failed.push({ collection, id: rec.id, message: describe(err) }),
    });
    app.sync.failed = failed;
    await reload();
    warmCache();
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) {
      app.sync.error = "Your session expired. Sign in again to sync.";
      pb.authStore.clear();
    } else {
      app.sync.error = err instanceof SyncAbort ? "Offline. Changes are saved on this device." : describe(err);
    }
  } finally {
    app.sync.running = false;
    if (again) {
      again = false;
      scheduleSync(200);
    }
  }
}

function describe(err) {
  const fields = err?.response?.data;
  if (fields && typeof fields === "object" && Object.keys(fields).length) {
    return Object.entries(fields)
      .map(([k, v]) => `${k}: ${v?.message || v}`)
      .join(", ");
  }
  return err?.message || String(err);
}

export async function start() {
  await reload();
  window.addEventListener("online", () => {
    app.sync.online = true;
    syncNow();
  });
  window.addEventListener("offline", () => (app.sync.online = false));
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
