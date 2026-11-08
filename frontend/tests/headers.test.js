// Caching headers the CDN relies on. Needs the server (scripts/test.sh).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const URL = process.env.PB_URL || "http://127.0.0.1:8090";
const ip = `198.51.100.${Math.floor(Math.random() * 50) + 200}`;
const get = (path, init = {}) => fetch(URL + path, { ...init, headers: { "X-Real-IP": ip, ...init.headers } });
const cache = async (path, init) => {
  const res = await get(path, init);
  await res.arrayBuffer();
  return { status: res.status, cc: res.headers.get("cache-control"), type: res.headers.get("content-type") };
};

const assets = fs.readdirSync(new globalThis.URL("../../backend/pb_public/assets/", import.meta.url));
const workbox = fs.readdirSync(new globalThis.URL("../../backend/pb_public/", import.meta.url)).find((f) => f.startsWith("workbox-"));
let owner;
let map;
let share;

before(async () => {
  const auth = await (await get("/api/collections/users/auth-with-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: process.env.OWNER_EMAIL || "me@example.com", password: process.env.OWNER_PASSWORD || "testpass123" }),
  })).json();
  owner = { Authorization: auth.token };
  const json = { ...owner, "content-type": "application/json" };
  const dive = await (await get("/api/collections/dives/records", { method: "POST", headers: json, body: JSON.stringify({ date: "2026-11-01", trip: "Headers trip" }) })).json();
  const form = new FormData();
  form.append("dive", dive.id);
  form.append("image", new Blob([fs.readFileSync(new globalThis.URL("../e2e/fixtures/map.png", import.meta.url))], { type: "image/png" }), "m.png"); // 2400×1600
  map = await (await get("/api/collections/maps/records", { method: "POST", headers: owner, body: form })).json();
  share = "H".repeat(32);
  await get("/api/collections/shares/records", { method: "POST", headers: json, body: JSON.stringify({ token: share, trip: "Headers trip" }) });
});

test("hashed app files are cached for a year, at the CDN too", async () => {
  for (const f of [assets.find((a) => a.endsWith(".js")), assets.find((a) => a.endsWith(".css")), assets.find((a) => a.endsWith(".woff2")), `../${workbox}`]) {
    const r = await cache(`/assets/${f}`.replace("/assets/../", "/"));
    assert.equal(r.status, 200, f);
    assert.equal(r.cc, "public, max-age=31536000, immutable", f);
  }
});

test("the start page, service worker and manifest are never held by the CDN", async () => {
  for (const p of ["/", "/index.html", "/sw.js", "/registerSW.js", "/manifest.webmanifest", "/some/unknown/path"]) {
    const r = await cache(p);
    assert.equal(r.status, 200, p);
    assert.equal(r.cc, "private, no-cache", p);
  }
  assert.match((await cache("/manifest.webmanifest")).type, /^application\/manifest\+json/);
  assert.equal((await cache("/icon-192.png")).cc, "public, max-age=86400");
});

test("owner image links stay in the browser only", async () => {
  const { token } = await (await get("/api/files/token", { method: "POST", headers: owner })).json();
  const r = await cache(`/api/files/maps/${map.id}/${map.image}?token=${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.cc, "private, max-age=2592000, immutable");
  const thumb = await cache(`/api/files/maps/${map.id}/${map.image}?thumb=480x0&token=${token}`);
  assert.equal(thumb.cc, "private, max-age=2592000, immutable");
});

const pngWidth = (buf) => new DataView(buf).getUint32(16); // IHDR width

test("map previews are at most 1200 px, for the owner and through share links", async () => {
  const { token } = await (await get("/api/files/token", { method: "POST", headers: owner })).json();
  const full = await (await get(`/api/files/maps/${map.id}/${map.image}?token=${token}`)).arrayBuffer();
  const preview = await (await get(`/api/files/maps/${map.id}/${map.image}?thumb=1200x1200f&token=${token}`)).arrayBuffer();
  assert.equal(pngWidth(full), 2400);
  assert.equal(pngWidth(preview), 1200);
  const shared = await get(`/api/share/${share}/file/maps/${map.id}/${map.image}?thumb=1200x1200f`);
  assert.equal(shared.status, 200);
  assert.equal(pngWidth(await shared.arrayBuffer()), 1200);
});

test("share data and share images keep their own no-CDN headers", async () => {
  assert.equal((await cache(`/api/share/${share}`)).cc, "no-store");
  const img = await cache(`/api/share/${share}/file/maps/${map.id}/${map.image}`);
  assert.equal(img.status, 200);
  assert.equal(img.cc, "private, max-age=3600");
});

test("API responses aren't given a cache lifetime", async () => {
  const r = await cache("/api/health");
  assert.equal(r.status, 200);
  assert.ok(!/max-age|public/.test(r.cc || ""), r.cc);
});
