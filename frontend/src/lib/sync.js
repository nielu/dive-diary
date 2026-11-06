// Two-way sync between IndexedDB and PocketBase.
//
// Single user, so conflict handling is last-writer-wins with "local wins while
// dirty": a record edited offline is never overwritten by a pull until it has
// been pushed. Order matters for relations: parents are created first and
// deleted last.

import { COLLECTIONS, FIELDS, openLocalDb, setMeta } from "./localdb.js";

const PUSH_ORDER = ["dives", "maps", "photos"];
const DELETE_ORDER = ["photos", "maps", "dives"];

export class SyncAbort extends Error {}

function isFatal(err) {
  // No network (status 0), or the session is gone: stop and retry later.
  return !err?.status || err.status === 401 || err.status === 403;
}

function payload(collection, rec) {
  const data = { id: rec.id };
  for (const f of FIELDS[collection]) {
    const v = rec[f];
    data[f] = v === undefined || v === null ? (f === "markers" || f === "route" ? [] : "") : v;
  }
  if (!rec._file) return data;

  const form = new FormData();
  for (const [k, v] of Object.entries(data)) {
    form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  form.append("image", rec._file, rec._fileName || "image.jpg");
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
    } catch {
      throw err;
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
      created: server.created,
      updated: server.updated,
      collectionName: collection,
      _onServer: true,
      _dirty: !unchanged,
      _file: undefined,
      _fileName: undefined,
    });
  }
  await tx.done;
}

function strip(serverRecord) {
  const { expand, ...rest } = serverRecord;
  return rest;
}

export async function push(pb, { onError } = {}) {
  const db = await openLocalDb();
  let pushed = 0;

  for (const collection of PUSH_ORDER) {
    const dirty = (await db.getAll(collection)).filter((r) => r._dirty && !r._deleted);
    for (const rec of dirty) {
      try {
        const server = await upsert(pb, collection, rec);
        await commitPushed(collection, rec, server);
        pushed++;
      } catch (err) {
        if (isFatal(err)) throw new SyncAbort(err.message || "offline");
        onError?.(collection, rec, err);
      }
    }
  }

  for (const collection of DELETE_ORDER) {
    const gone = (await db.getAll(collection)).filter((r) => r._deleted);
    for (const rec of gone) {
      try {
        await pb.collection(collection).delete(rec.id);
      } catch (err) {
        if (err.status !== 404) {
          if (isFatal(err)) throw new SyncAbort(err.message || "offline");
          onError?.(collection, rec, err);
          continue;
        }
      }
      await db.delete(collection, rec.id);
      pushed++;
    }
  }
  return pushed;
}

export async function pull(pb) {
  const db = await openLocalDb();
  const changed = { dives: 0, maps: 0, photos: 0 };

  for (const collection of COLLECTIONS) {
    let items;
    try {
      items = await pb.collection(collection).getFullList({ batch: 500, sort: "created" });
    } catch (err) {
      throw new SyncAbort(err.message || "offline");
    }

    const tx = db.transaction(collection, "readwrite");
    const seen = new Set();
    for (const item of items) {
      seen.add(item.id);
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

    for (const local of await tx.store.getAll()) {
      if (!seen.has(local.id) && local._onServer && !local._dirty) {
        await tx.store.delete(local.id);
        changed[collection]++;
      }
    }
    await tx.done;
  }
  return changed;
}

export async function syncAll(pb, opts = {}) {
  const pushed = await push(pb, opts);
  const pulled = await pull(pb);
  await setMeta("lastSync", new Date().toISOString());
  return { pushed, pulled };
}
