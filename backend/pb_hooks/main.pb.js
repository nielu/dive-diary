/// <reference path="../pb_data/types.d.ts" />

// Note: each PocketBase hook handler runs in its own isolated JS context,
// so shared helpers are require()-d inside each handler.

// Caching rules, mainly for Railway's CDN. Without them the CDN would cache
// the (unhashed) service worker for its default 2 hours, delaying app updates,
// and keep owner image links, which carry an access token, for 30 days.
//   - files with a content hash in the name: a year, immutable
//   - icons: a day
//   - everything else in the app (start page, sw.js, registerSW.js, manifest,
//     unknown paths that fall back to index.html): browser only, revalidated
//   - /api/files: browser only (the CDN keys on the full URL, token included)
// Share data and share images set their own no-store / private headers, so
// turning a link off still works with the CDN on. The dashboard (/_/) is left alone.
routerUse((e) => {
  const path = e.request.url.path;
  const h = e.response.header();
  if (path.startsWith("/api/")) {
    if (path.startsWith("/api/files/")) h.set("Cache-Control", "private, max-age=2592000, immutable");
  } else if (!path.startsWith("/_/")) {
    if (path.startsWith("/assets/") || /^\/workbox-[0-9a-f]+\.js$/.test(path)) {
      h.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if (/^\/icon[\w-]*\.(png|svg)$/.test(path)) {
      h.set("Cache-Control", "public, max-age=86400");
    } else {
      h.set("Cache-Control", "private, no-cache");
      if (path === "/manifest.webmanifest") h.set("Content-Type", "application/manifest+json");
    }
  }
  return e.next();
});

// Read-only share endpoint for family viewers. No auth: the unguessable token
// is the credential. Only dives in the shared trip (or all, if trip is empty)
// are returned. Delete the share record to revoke the link.
routerAdd("GET", "/api/share/{token}", (e) => {
  const { findShare } = require(`${__hooks}/share_lib.js`);
  const share = findShare($app, e.request.pathValue("token"));

  const trip = share.getString("trip");
  const diveFilter = trip ? "trip = {:trip}" : "id != ''";
  const childFilter = trip ? "dive.trip = {:trip}" : "id != ''";
  const params = { trip: trip };

  const dives = $app.findRecordsByFilter("dives", diveFilter, "-date,-time", 0, 0, params);
  const maps = $app.findRecordsByFilter("maps", childFilter, "sort,created", 0, 0, params);
  const photos = $app.findRecordsByFilter("photos", childFilter, "sort,created", 0, 0, params);

  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, {
    label: share.getString("label") || trip || "Dive diary",
    trip: trip,
    dives: dives,
    maps: maps,
    photos: photos,
  });
});

// Map and photo files for share viewers. Image fields are protected, so this
// is the only way in without the owner's login, and it stops working the
// moment the share is turned off or expires.
routerAdd("GET", "/api/share/{token}/file/{collection}/{id}/{name}", (e) => {
  const { findShare, shareCoversDive, THUMBS } = require(`${__hooks}/share_lib.js`);
  const share = findShare($app, e.request.pathValue("token"));

  const collection = e.request.pathValue("collection");
  if (!THUMBS[collection]) throw new NotFoundError("");

  let record, dive;
  try {
    record = $app.findRecordById(collection, e.request.pathValue("id"));
    dive = $app.findRecordById("dives", record.getString("dive"));
  } catch (_) {
    throw new NotFoundError("");
  }
  const name = e.request.pathValue("name");
  if (record.getString("image") !== name || !shareCoversDive(share, dive)) {
    throw new NotFoundError("");
  }

  const base = record.baseFilesPath();
  let servedKey = base + "/" + name;
  let servedName = name;
  const thumb = e.request.url.query().get("thumb");

  const fsys = $app.newFilesystem();
  try {
    if (thumb && THUMBS[collection].includes(thumb)) {
      const thumbName = thumb + "_" + name;
      const thumbKey = base + "/thumbs_" + name + "/" + thumbName;
      try {
        if (!fsys.exists(thumbKey)) fsys.createThumb(servedKey, thumbKey, thumb);
        servedKey = thumbKey;
        servedName = thumbName;
      } catch (err) {
        console.log("share thumb failed, serving original: " + err);
      }
    }
    // Browsers may keep a viewed image for an hour after the link is turned off.
    e.response.header().set("Cache-Control", "private, max-age=3600");
    fsys.serve(e.response, e.request, servedKey, servedName);
  } catch (err) {
    throw new NotFoundError("");
  } finally {
    fsys.close();
  }
});

// Optional: create the owner account on first start from env vars, so a fresh
// deploy doesn't need a trip to the admin dashboard.
onBootstrap((e) => {
  e.next(); // database is ready after this

  const email = $os.getenv("OWNER_EMAIL");
  const password = $os.getenv("OWNER_PASSWORD");
  if (!email || !password) return;

  try {
    e.app.findAuthRecordByEmail("users", email);
  } catch (_) {
    const owner = new Record(e.app.findCollectionByNameOrId("users"));
    owner.set("email", email);
    owner.setPassword(password);
    owner.setVerified(true);
    e.app.save(owner);
    console.log("Created owner account " + email);
  }

  // Same login for the admin dashboard (/_/), so a fresh deploy needs no
  // terminal. Only when there is no superuser yet.
  const superusers = e.app.findCollectionByNameOrId("_superusers");
  if (e.app.countRecords(superusers) === 0) {
    const admin = new Record(superusers);
    admin.set("email", email);
    admin.setPassword(password);
    e.app.save(admin);
    console.log("Created dashboard superuser " + email);
  }
});
