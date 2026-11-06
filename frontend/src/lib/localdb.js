// Local-first storage in IndexedDB.
//
// Every record lives here first; the server is a sync target. Extra local-only
// fields (all prefixed with _) are stripped before upload:
//   _dirty     has changes the server hasn't seen
//   _rev       bumped on every local write, so a sync can tell whether the
//              record changed while it was being uploaded
//   _deleted   tombstone waiting to be deleted on the server
//   _onServer  the server has (had) this record
//   _file      Blob of an image not yet uploaded (maps, photos)
//   _fileName  original-ish filename for that blob

import { openDB } from "idb";

export const COLLECTIONS = ["dives", "maps", "photos"];

export const FIELDS = {
  dives: ["date", "time", "trip", "site", "team", "leader", "max_depth", "avg_depth", "temp", "duration", "navigation", "log"],
  maps: ["dive", "caption", "sort", "width", "height", "markers", "route"],
  photos: ["dive", "caption", "sort"],
};

let dbPromise;

export function openLocalDb(name = "dive-diary") {
  if (!dbPromise) {
    dbPromise = openDB(name, 1, {
      upgrade(db) {
        for (const c of COLLECTIONS) {
          const store = db.createObjectStore(c, { keyPath: "id" });
          if (c !== "dives") store.createIndex("dive", "dive");
        }
        db.createObjectStore("meta");
      },
    });
  }
  return dbPromise;
}

/** PocketBase-compatible id: 15 chars of [a-z0-9]. */
export function newId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function listAll(collection, { includeDeleted = false } = {}) {
  const db = await openLocalDb();
  const all = await db.getAll(collection);
  return includeDeleted ? all : all.filter((r) => !r._deleted);
}

export async function getOne(collection, id) {
  const db = await openLocalDb();
  return db.get(collection, id);
}

/** Create or update a record locally and mark it for upload. */
export async function save(collection, record) {
  const db = await openLocalDb();
  const tx = db.transaction(collection, "readwrite");
  const existing = await tx.store.get(record.id);
  const merged = {
    ...existing,
    ...record,
    collectionName: collection,
    _dirty: true,
    _deleted: false,
    _rev: (existing?._rev || 0) + 1,
    _onServer: existing?._onServer || false,
    _localUpdated: new Date().toISOString(),
  };
  await tx.store.put(merged);
  await tx.done;
  return merged;
}

/** Delete locally; tombstone it if the server needs to hear about it. */
export async function remove(collection, id) {
  const db = await openLocalDb();
  const stores = collection === "dives" ? ["dives", "maps", "photos"] : [collection];
  const tx = db.transaction(stores, "readwrite");

  const drop = async (store, rec) => {
    if (!rec) return;
    if (rec._onServer) {
      await tx.objectStore(store).put({ ...rec, _deleted: true, _dirty: true, _rev: (rec._rev || 0) + 1, _file: undefined });
    } else {
      await tx.objectStore(store).delete(rec.id);
    }
  };

  if (collection === "dives") {
    for (const child of ["maps", "photos"]) {
      const kids = await tx.objectStore(child).index("dive").getAll(id);
      for (const k of kids) await drop(child, k);
    }
  }
  await drop(collection, await tx.objectStore(collection).get(id));
  await tx.done;
}

export async function pendingCount() {
  const db = await openLocalDb();
  let n = 0;
  for (const c of COLLECTIONS) n += (await db.getAll(c)).filter((r) => r._dirty).length;
  return n;
}

export async function getMeta(key) {
  const db = await openLocalDb();
  return db.get("meta", key);
}

export async function setMeta(key, value) {
  const db = await openLocalDb();
  return db.put("meta", value, key);
}

/** Wipe everything local (used on sign-out). */
export async function clearAll() {
  const db = await openLocalDb();
  const tx = db.transaction([...COLLECTIONS, "meta"], "readwrite");
  for (const c of [...COLLECTIONS, "meta"]) await tx.objectStore(c).clear();
  await tx.done;
}
