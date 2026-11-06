/// <reference path="../pb_data/types.d.ts" />

// Note: each PocketBase hook handler runs in its own isolated JS context,
// so helpers must live inside the handler (or in a require()-d module).

// Read-only share endpoint for family viewers. No auth: the unguessable token
// is the credential. Only dives in the shared trip (or all, if trip is empty)
// are returned. Delete the share record to revoke the link.
routerAdd("GET", "/api/share/{token}", (e) => {
  const token = e.request.pathValue("token") || "";
  if (!/^[A-Za-z0-9]{24,64}$/.test(token)) {
    throw new NotFoundError("This link doesn't exist.");
  }

  let share;
  try {
    share = $app.findFirstRecordByData("shares", "token", token);
  } catch (_) {
    throw new NotFoundError("This link doesn't exist or was turned off.");
  }

  const expires = share.getString("expires");
  if (expires && new Date(expires.replace(" ", "T")) < new Date()) {
    throw new NotFoundError("This link has expired.");
  }

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
