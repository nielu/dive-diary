// Integration test: local IndexedDB (fake) <-> a running PocketBase.
// Start the backend first, with an owner account:
//   OWNER_EMAIL=me@example.com OWNER_PASSWORD=testpass123 ./pocketbase serve
// then: PB_URL=http://127.0.0.1:8090 npm test

import "fake-indexeddb/auto";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import PocketBase from "pocketbase";
import { save, remove, getOne, listAll, newId, pendingCount } from "../src/lib/localdb.js";
import { syncAll } from "../src/lib/sync.js";

const URL = process.env.PB_URL || "http://127.0.0.1:8090";
const pb = new PocketBase(URL);
pb.autoCancellation(false);

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

  const anon = await fetch(`${URL}/api/share/${token}`);
  assert.equal(anon.status, 200);
  const body = await anon.json();
  assert.equal(body.label, "Mexico");
  assert.ok(body.dives.length >= 2);
  assert.ok(body.dives.every((d) => d.trip === trip));
  assert.equal(body.maps.length, 1);
  assert.equal(body.photos.length, 1);

  // Files are reachable without auth (the share viewer needs them).
  const m = body.maps[0];
  const file = await fetch(`${URL}/api/files/maps/${m.id}/${m.image}`);
  assert.equal(file.status, 200);

  // Collections themselves stay private.
  const list = await (await fetch(`${URL}/api/collections/dives/records`)).json();
  assert.equal(list.items.length, 0);

  assert.equal((await fetch(`${URL}/api/share/${"x".repeat(32)}`)).status, 404);
  assert.equal((await fetch(`${URL}/api/share/short`)).status, 404);

  const expired = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  await pb.collection("shares").create({ token: expired, trip, expires: "2020-01-01 00:00:00.000Z" });
  assert.equal((await fetch(`${URL}/api/share/${expired}`)).status, 404);
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
