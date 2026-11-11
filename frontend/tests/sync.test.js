// Integration test: local IndexedDB (fake) <-> a running PocketBase.
// Run through scripts/test.sh, which starts a throwaway server with the
// owner account me@example.com / testpass123.

import "fake-indexeddb/auto";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import PocketBase from "pocketbase";
import { save, remove, getOne, listAll, newId, pendingCount, getMeta } from "../src/lib/localdb.js";
import { syncAll, pull } from "../src/lib/sync.js";

const URL = process.env.PB_URL || "http://127.0.0.1:8090";
const pb = new PocketBase(URL);
pb.autoCancellation(false);

// The server rate-limits per X-Real-IP (Railway's client address header), so
// this run gets its own made-up address.
const clientIp = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
const requests = [];
pb.beforeSend = (url, options) => {
  options.headers = { ...options.headers, "X-Real-IP": clientIp };
  // the SDK appends options.query to the URL after this hook
  const query = new URLSearchParams(Object.entries(options.query || {}).filter(([, v]) => v !== undefined && v !== "")).toString();
  requests.push(`${options.method || "GET"} ${url.replace(URL, "")}${query ? `?${query}` : ""}`);
  return { url, options };
};
const anon = (path, init = {}) => fetch(URL + path, { ...init, headers: { ...init.headers, "X-Real-IP": clientIp } });

// 1x1 PNG
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const pngBlob = () => new Blob([PNG], { type: "image/png" });
const trip = "Test trip " + Date.now();

before(async () => {
  await pb.collection("users").authWithPassword(
    process.env.OWNER_EMAIL || "me@example.com",
    process.env.OWNER_PASSWORD || "testpass123",
  );
});

test("offline-created dive, map and photo upload with their client ids", async () => {
  const diveId = newId();
  const mapId = newId();
  const photoId = newId();
  await save("dives", { id: diveId, date: "2026-11-04", time: "09:30", trip, site: "Cenote Test", max_depth: 21.5, temp: 25 });
  await save("maps", { id: mapId, dive: diveId, caption: "Main line", sort: 0, width: 1, height: 1, markers: [], route: [], _file: pngBlob(), _fileName: "map.png" });
  await save("photos", { id: photoId, dive: diveId, caption: "Entry", sort: 0, _file: pngBlob(), _fileName: "p.png" });
  assert.equal(await pendingCount(), 3);

  const res = await syncAll(pb);
  assert.equal(res.pushed, 3);
  assert.equal(await pendingCount(), 0);

  const serverDive = await pb.collection("dives").getOne(diveId);
  assert.equal(serverDive.site, "Cenote Test");
  assert.equal(serverDive.max_depth, 21.5);
  const serverMap = await pb.collection("maps").getOne(mapId);
  assert.match(serverMap.image, /\.png$/);

  const localMap = await getOne("maps", mapId);
  assert.equal(localMap._file, undefined, "blob dropped after upload");
  assert.equal(localMap.image, serverMap.image);
  assert.equal(localMap._onServer, true);
});

test("marker and route edits push as JSON", async () => {
  const [map] = (await listAll("maps")).filter((m) => m.caption === "Main line");
  const markers = [{ id: "m1", x: 0.25, y: 0.5, label: "T1", note: "Left at the T" }];
  const route = [[{ x: 0.1, y: 0.1 }, { x: 0.25, y: 0.5 }]];
  await save("maps", { ...map, markers, route });
  await syncAll(pb);
  const server = await pb.collection("maps").getOne(map.id);
  assert.deepEqual(server.markers, markers);
  assert.deepEqual(server.route, route);
});

test("server-side changes are pulled; local dirty edits win until pushed", async () => {
  const [dive] = (await listAll("dives")).filter((d) => d.trip === trip);
  await pb.collection("dives").update(dive.id, { leader: "Edited elsewhere" });
  await syncAll(pb);
  assert.equal((await getOne("dives", dive.id)).leader, "Edited elsewhere");

  await save("dives", { ...(await getOne("dives", dive.id)), leader: "Local wins" });
  await syncAll(pb);
  assert.equal((await pb.collection("dives").getOne(dive.id)).leader, "Local wins");
});

test("a create that already reached the server is retried as an update", async () => {
  const id = newId();
  await pb.collection("dives").create({ id, date: "2026-11-05", trip, site: "Half-synced" });
  await save("dives", { id, date: "2026-11-05", trip, site: "Half-synced v2" });
  await syncAll(pb);
  assert.equal((await pb.collection("dives").getOne(id)).site, "Half-synced v2");
});

test("share link returns only the shared trip, read-only", async () => {
  const other = newId();
  await save("dives", { id: other, date: "2026-10-01", trip: "Private", site: "Not shared" });
  await syncAll(pb);

  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"[b % 56]).join("");
  await pb.collection("shares").create({ token, trip, label: "Mexico" });

  const res = await anon(`/api/share/${token}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.label, "Mexico");
  assert.ok(body.dives.length >= 2);
  assert.ok(body.dives.every((d) => d.trip === trip));
  assert.equal(body.maps.length, 1);
  assert.equal(body.photos.length, 1);

  // Image files are protected: not public, but served through the share link.
  const m = body.maps[0];
  assert.equal((await anon(`/api/files/maps/${m.id}/${m.image}`)).status, 404);
  const viaShare = `/api/share/${token}/file/maps/${m.id}/${m.image}`;
  assert.equal((await anon(viaShare)).status, 200);
  assert.equal((await anon(viaShare + "?thumb=480x0")).status, 200);
  const ftoken = await pb.files.getToken();
  assert.equal((await anon(`/api/files/maps/${m.id}/${m.image}?token=${ftoken}`)).status, 200);

  // Collections themselves stay private.
  const list = await (await anon(`/api/collections/dives/records`)).json();
  assert.equal(list.items.length, 0);

  assert.equal((await anon(`/api/share/${"x".repeat(32)}`)).status, 404);
  assert.equal((await anon(`/api/share/short`)).status, 404);

  const expired = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  await pb.collection("shares").create({ token: expired, trip, expires: "2020-01-01 00:00:00.000Z" });
  assert.equal((await anon(`/api/share/${expired}`)).status, 404);
  assert.equal((await anon(`/api/share/${expired}/file/maps/${m.id}/${m.image}`)).status, 404);

  // Turning the link off cuts off its files immediately.
  const share = await pb.collection("shares").getFirstListItem(pb.filter("token = {:token}", { token }));
  await pb.collection("shares").delete(share.id);
  assert.equal((await anon(viaShare)).status, 404);
});

test("a clip uploads its poster and video together; share links stream it in ranges", async () => {
  const diveId = newId();
  const clipId = newId();
  const clipTrip = "Clip trip " + Date.now();
  const mp4 = fs.readFileSync(new globalThis.URL("../e2e/fixtures/clip-h264.mp4", import.meta.url));
  await save("dives", { id: diveId, date: "2026-11-10", trip: clipTrip, site: "Clip cave" });
  await save("photos", {
    id: clipId, dive: diveId, caption: "Halocline", sort: 0, duration: 3, width: 1280, height: 720,
    _file: pngBlob(), _fileName: "poster.png", _video: new Blob([mp4], { type: "video/mp4" }), _videoName: "clip.mp4",
  });
  await syncAll(pb);

  const server = await pb.collection("photos").getOne(clipId);
  assert.match(server.video, /^clip.*\.mp4$/);
  assert.match(server.image, /\.png$/);
  assert.deepEqual([server.duration, server.width, server.height], [3, 1280, 720]);
  const local = await getOne("photos", clipId);
  assert.equal(local._video, undefined, "video blob dropped after upload");
  assert.equal(local.video, server.video);

  const token = "C" + Array.from(crypto.getRandomValues(new Uint8Array(31)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
  await pb.collection("shares").create({ token, trip: clipTrip });
  const url = `/api/share/${token}/file/photos/${clipId}/${server.video}`;
  const part = await anon(url, { headers: { Range: "bytes=0-99" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 0-99/${mp4.length}`);
  assert.equal(part.headers.get("content-type"), "video/mp4");
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await anon(`/api/files/photos/${clipId}/${server.video}`)).status, 404, "not public");
  assert.equal((await anon(`/api/share/${token}/file/photos/${clipId}/other.mp4`)).status, 404);
});

test("deleting a dive removes it and its maps/photos everywhere", async () => {
  const [dive] = (await listAll("dives")).filter((d) => d.site === "Cenote Test");
  await remove("dives", dive.id);
  assert.equal((await listAll("dives")).find((d) => d.id === dive.id), undefined, "hidden locally right away");
  await syncAll(pb);
  await assert.rejects(pb.collection("dives").getOne(dive.id), { status: 404 });
  const maps = await pb.collection("maps").getFullList({ filter: `dive = "${dive.id}"` });
  assert.equal(maps.length, 0);
  assert.equal((await listAll("maps", { includeDeleted: true })).filter((m) => m.dive === dive.id).length, 0);
});

test("records deleted on the server disappear locally on pull", async () => {
  const [dive] = (await listAll("dives")).filter((d) => d.site === "Not shared");
  await pb.collection("dives").delete(dive.id);
  await syncAll(pb);
  assert.equal(await getOne("dives", dive.id), undefined);
});

test("a rejected dive is reported, not retried until edited, and holds back its photos", async () => {
  const diveId = newId();
  const photoId = newId();
  await save("dives", { id: diveId, date: "", trip, site: "No date" }); // the server requires a date
  await save("photos", { id: photoId, dive: diveId, caption: "", sort: 0, _file: pngBlob(), _fileName: "p.png" });

  const first = await syncAll(pb);
  assert.equal(first.failed, 1);
  const dive = await getOne("dives", diveId);
  assert.match(dive._error, /^Date: /);
  assert.equal((await getOne("photos", photoId))._error, undefined, "photo waits instead of failing");

  requests.length = 0;
  await syncAll(pb);
  assert.equal(requests.filter((r) => r.includes(diveId) || r.startsWith("POST /api/collections/dives") || r.startsWith("POST /api/collections/photos")).length, 0, "nothing re-sent");

  await save("dives", { ...dive, date: "2026-11-03" }); // the fix
  const fixed = await syncAll(pb);
  assert.equal(fixed.failed, 0);
  assert.equal((await getOne("dives", diveId))._error, undefined);
  assert.equal((await pb.collection("photos").getOne(photoId)).dive, diveId);
});

test("pulls only download what changed", async () => {
  await syncAll(pb);
  assert.ok(await getMeta("cursor:dives"));
  requests.length = 0;
  await pull(pb);
  const fullLists = requests.filter((r) => r.startsWith("GET /api/collections/dives/records") && !r.includes("filter=") && !r.includes("fields=id"));
  assert.equal(fullLists.length, 0, "no unfiltered download of all dives");

  const id = newId();
  await pb.collection("dives").create({ id, date: "2026-11-06", trip, site: "Made elsewhere" });
  await pull(pb);
  assert.equal((await getOne("dives", id)).site, "Made elsewhere");
});

test("a burst of offline changes gets through the server's rate limit", { timeout: 90_000 }, async () => {
  for (let i = 0; i < 60; i++) await save("dives", { id: newId(), date: "2026-11-02", trip: trip + " burst", site: `Burst ${i}` });
  const res = await syncAll(pb, { rateWaitMs: 2500 });
  assert.equal(res.failed, 0);
  assert.equal(await pendingCount(), 0);
  assert.ok(requests.some((r) => r.startsWith("POST /api/collections/dives")));
});

test("rate limiting and the trusted proxy header are on", async () => {
  const su = new PocketBase(URL);
  su.beforeSend = pb.beforeSend;
  await su.collection("_superusers").authWithPassword(process.env.OWNER_EMAIL || "me@example.com", process.env.OWNER_PASSWORD || "testpass123");
  const settings = await su.settings.getAll();
  assert.equal(settings.rateLimits.enabled, true);
  assert.deepEqual(settings.trustedProxy.headers, ["X-Real-IP"]);
  const auth = settings.rateLimits.rules.find((r) => r.label === "*:auth");
  assert.equal(auth.audience, "@guest");
  assert.ok(auth.maxRequests <= 5);
});
