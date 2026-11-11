// Two-way sync between IndexedDB and PocketBase.
//
// Single user, so conflict handling is last-writer-wins with "local wins while
// dirty": a record edited offline is never overwritten by a pull until it has
// been pushed. Order matters for relations: parents are created first and
// deleted last.
//
// Failures:
//  - Temporary problems (offline, server down, rate limited, signed out)
//    stop the sync with a SyncAbort; everything stays queued.
//  - A record the server rejects (e.g. a validation error) gets `_error` and
//    `_failedRev` stored on it. It isn't retried until it's edited again (its
//    _rev changes) or the user forces a retry, so a rejected photo isn't
//    re-uploaded on every sync. Maps and photos of a dive that never reached
//    the server wait for it instead of failing on their own.
//
// Pulls are incremental: only records updated since the last pull are
// downloaded, plus an ids-only list to notice deletions.

import { COLLECTIONS, FIELDS, openLocalDb, getMeta, setMeta } from "./localdb.js";
import { FIELD_LABELS } from "./schema.js";

const PUSH_ORDER = ["dives", "maps", "photos"];
// what an unset field is sent as (JSON fields can't be "")
const EMPTY = { markers: [], route: [], profile: null, dive_no: 0 };
const DELETE_ORDER = ["photos", "maps", "dives"];

/** Stops a sync run. kind: "offline" | "auth" | "server" | "busy" */
export class SyncAbort extends Error {
  constructor(kind, message) {
    super(message || kind);
    this.kind = kind;
  }
}

/** Temporary failure kind, or null when the server rejected this record for good. */
export function classify(err) {
  if (err instanceof SyncAbort) return err.kind;
  if (typeof err?.status !== "number") return null; // a bug, not the network
  if (err.status === 0 || err.isAbort) return "offline";
  if (err.status === 401 || err.status === 403) return "auth";
  if (err.status === 429) return "busy";
  if (err.status >= 500) return "server";
  return null;
}

/** Readable reason from a PocketBase error, e.g. "Date: Cannot be blank." */
export function describe(err) {
  const fields = err?.response?.data;
  if (fields && typeof fields === "object" && Object.keys(fields).length) {
    return Object.entries(fields)
      .map(([k, v]) => `${FIELD_LABELS[k] || k}: ${v?.message || v}`)
      .join(" ");
  }
  return err?.message || String(err);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry a request a few times when the server says we're going too fast. */
async function withRateLimitRetry(fn, waitMs) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err?.status !== 429 || attempt >= 3) throw err;
      await sleep(waitMs * (attempt + 1));
    }
  }
}

function payload(collection, rec) {
  const data = { id: rec.id };
  for (const f of FIELDS[collection]) {
    const v = rec[f];
    data[f] = v === undefined || v === null ? (f in EMPTY ? EMPTY[f] : "") : v;
  }
  if (!rec._file && !rec._video) return data;

  const form = new FormData();
  for (const [k, v] of Object.entries(data)) {
    form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  if (rec._file) form.append("image", rec._file, rec._fileName || "image.jpg");
  if (rec._video) form.append("video", rec._video, rec._videoName || "clip.mp4");
  return form;
}

async function upsert(pb, collection, rec) {
  const col = pb.collection(collection);
  const body = payload(collection, rec);
  const withoutId = (b) => {
    if (b instanceof FormData) {
      b.delete("id");
      return b;
    }
    const { id, ...rest } = b;
    return rest;
  };

  if (rec._onServer) {
    try {
      return await col.update(rec.id, withoutId(body));
    } catch (err) {
      if (err.status !== 404) throw err;
      // Deleted on the server but edited here: recreate it.
      return await col.create(payload(collection, rec));
    }
  }

  try {
    return await col.create(body);
  } catch (err) {
    if (err.status !== 400) throw err;
    // A previous attempt may have reached the server before the connection
    // dropped. If the record is there, update it instead.
    try {
      await col.getOne(rec.id);
    } catch (lookupErr) {
      throw lookupErr?.status === 404 ? err : lookupErr;
    }
    return await col.update(rec.id, withoutId(payload(collection, rec)));
  }
}

async function commitPushed(collection, sent, server) {
  const db = await openLocalDb();
  const tx = db.transaction(collection, "readwrite");
  const current = await tx.store.get(sent.id);
  if (current) {
    const unchanged = current._rev === sent._rev;
    await tx.store.put({
      ...(unchanged ? { ...current, ...strip(server) } : current),
      image: server.image ?? current.image,
      video: server.video ?? current.video,
      created: server.created,
      updated: server.updated,
      collectionName: collection,
      _onServer: true,
      _dirty: !unchanged,
      _error: undefined,
      _failedRev: undefined,
      _file: undefined,
      _fileName: undefined,
      _video: undefined,
      _videoName: undefined,
    });
  }
  await tx.done;
}

async function markFailed(collection, rec, message) {
  const db = await openLocalDb();
  const tx = db.transaction(collection, "readwrite");
  const current = await tx.store.get(rec.id);
  // If it was edited while uploading, the edit gets its own attempt.
  if (current && current._rev === rec._rev) {
    await tx.store.put({ ...current, _error: message, _failedRev: rec._rev });
  }
  await tx.done;
}

function strip(serverRecord) {
  const { expand, ...rest } = serverRecord;
  return rest;
}

/**
 * Upload local changes.
 * force: also retry records the server rejected before (user pressed "Try again").
 */
export async function push(pb, { force = false, rateWaitMs = 6000 } = {}) {
  const db = await openLocalDb();
  let pushed = 0;
  let failed = 0;
  const waitingDives = new Set(); // dives that aren't on the server because they failed

  const attempt = async (collection, rec, fn) => {
    try {
      await withRateLimitRetry(fn, rateWaitMs);
      pushed++;
      return true;
    } catch (err) {
      const kind = classify(err);
      if (kind) throw new SyncAbort(kind, err?.message);
      await markFailed(collection, rec, describe(err));
      failed++;
      return false;
    }
  };

  for (const collection of PUSH_ORDER) {
    const dirty = (await db.getAll(collection)).filter((r) => r._dirty && !r._deleted);
    for (const rec of dirty) {
      if (collection !== "dives" && waitingDives.has(rec.dive)) continue;
      const knownBad = rec._error && rec._failedRev === rec._rev;
      if (knownBad && !force) {
        if (collection === "dives" && !rec._onServer) waitingDives.add(rec.id);
        failed++;
        continue;
      }
      const ok = await attempt(collection, rec, async () => {
        const server = await upsert(pb, collection, rec);
        await commitPushed(collection, rec, server);
      });
      if (!ok && collection === "dives" && !rec._onServer) waitingDives.add(rec.id);
    }
  }

  for (const collection of DELETE_ORDER) {
    const gone = (await db.getAll(collection)).filter((r) => r._deleted);
    for (const rec of gone) {
      if (rec._error && rec._failedRev === rec._rev && !force) {
        failed++;
        continue;
      }
      await attempt(collection, rec, async () => {
        try {
          await pb.collection(collection).delete(rec.id);
        } catch (err) {
          if (err.status !== 404) throw err;
        }
        await db.delete(collection, rec.id);
      });
    }
  }
  return { pushed, failed };
}

/** Download server changes since the last pull. */
export async function pull(pb) {
  const db = await openLocalDb();
  const changed = { dives: 0, maps: 0, photos: 0 };

  for (const collection of COLLECTIONS) {
    const cursorKey = `cursor:${collection}`;
    const cursor = await getMeta(cursorKey);
    const col = pb.collection(collection);
    let items;
    let ids;
    try {
      items = await col.getFullList({
        batch: 500,
        sort: "updated",
        filter: cursor ? pb.filter("updated >= {:cursor}", { cursor }) : "",
      });
      // Deleted records don't show up as changes, so compare against all ids.
      ids = cursor ? (await col.getFullList({ batch: 1000, fields: "id" })).map((r) => r.id) : items.map((r) => r.id);
    } catch (err) {
      throw new SyncAbort(classify(err) || "server", err?.message);
    }

    let newest = cursor || "";
    const tx = db.transaction(collection, "readwrite");
    for (const item of items) {
      if (item.updated > newest) newest = item.updated;
      const local = await tx.store.get(item.id);
      if (local?._dirty) {
        if (!local._onServer) await tx.store.put({ ...local, _onServer: true });
        continue;
      }
      if (local && local.updated === item.updated) continue;
      await tx.store.put({
        ...strip(item),
        collectionName: collection,
        _onServer: true,
        _dirty: false,
        _deleted: false,
        _rev: local?._rev || 0,
      });
      changed[collection]++;
    }

    const onServer = new Set(ids);
    for (const local of await tx.store.getAll()) {
      if (!onServer.has(local.id) && local._onServer && !local._dirty) {
        await tx.store.delete(local.id);
        changed[collection]++;
      }
    }
    await tx.done;
    if (newest) await setMeta(cursorKey, newest);
  }
  return changed;
}

export async function syncAll(pb, opts = {}) {
  const pushed = await push(pb, opts);
  const pulled = await pull(pb);
  await setMeta("lastSync", new Date().toISOString());
  return { ...pushed, pulled };
}
