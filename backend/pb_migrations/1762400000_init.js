/// <reference path="../pb_data/types.d.ts" />

// Schema for the dive diary.
// Every collection is owner-only: the app has a single user, signups are off,
// and family viewers go through the /api/share/{token} endpoint instead.
migrate(
  (app) => {
    const ownerOnly = '@request.auth.id != ""';
    const rules = {
      listRule: ownerOnly,
      viewRule: ownerOnly,
      createRule: ownerOnly,
      updateRule: ownerOnly,
      deleteRule: ownerOnly,
    };
    const timestamps = [
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ];
    const images = ["image/jpeg", "image/png", "image/webp"];

    // Lock down the default users collection: no public signups, and long
    // sessions so a token survives a two-week trip without signal.
    const users = app.findCollectionByNameOrId("users");
    users.createRule = null;
    users.authToken.duration = 60 * 60 * 24 * 45; // 45 days
    app.save(users);

    const dives = new Collection({
      type: "base",
      name: "dives",
      ...rules,
      fields: [
        { name: "date", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        { name: "time", type: "text", pattern: "^(\\d{2}:\\d{2})?$" },
        { name: "trip", type: "text", max: 120 },
        { name: "site", type: "text", max: 200 },
        { name: "team", type: "text", max: 500 },
        { name: "leader", type: "text", max: 200 },
        { name: "max_depth", type: "number", min: 0 },
        { name: "avg_depth", type: "number", min: 0 },
        { name: "temp", type: "number" },
        { name: "duration", type: "number", min: 0, onlyInt: true },
        { name: "navigation", type: "text", max: 20000 },
        { name: "log", type: "text", max: 50000 },
        ...timestamps,
      ],
      indexes: [
        "CREATE INDEX idx_dives_date ON dives (date, time)",
        "CREATE INDEX idx_dives_trip ON dives (trip)",
      ],
    });
    app.save(dives);

    const maps = new Collection({
      type: "base",
      name: "maps",
      ...rules,
      fields: [
        { name: "dive", type: "relation", collectionId: dives.id, required: true, maxSelect: 1, cascadeDelete: true },
        { name: "image", type: "file", required: true, maxSelect: 1, maxSize: 25 * 1024 * 1024, mimeTypes: images, thumbs: ["480x0"] },
        { name: "caption", type: "text", max: 200 },
        { name: "sort", type: "number" },
        { name: "width", type: "number", min: 0 },
        { name: "height", type: "number", min: 0 },
        // [{id, x, y, label, note}] with x/y normalized to 0..1 from the top-left
        { name: "markers", type: "json", maxSize: 1000000 },
        // [[{x, y}, ...], ...] one array per route segment, same coordinates
        { name: "route", type: "json", maxSize: 1000000 },
        ...timestamps,
      ],
      indexes: ["CREATE INDEX idx_maps_dive ON maps (dive)"],
    });
    app.save(maps);

    const photos = new Collection({
      type: "base",
      name: "photos",
      ...rules,
      fields: [
        { name: "dive", type: "relation", collectionId: dives.id, required: true, maxSelect: 1, cascadeDelete: true },
        { name: "image", type: "file", required: true, maxSelect: 1, maxSize: 20 * 1024 * 1024, mimeTypes: images, thumbs: ["480x480f"] },
        { name: "caption", type: "text", max: 500 },
        { name: "sort", type: "number" },
        ...timestamps,
      ],
      indexes: ["CREATE INDEX idx_photos_dive ON photos (dive)"],
    });
    app.save(photos);

    const shares = new Collection({
      type: "base",
      name: "shares",
      ...rules,
      fields: [
        { name: "token", type: "text", required: true, min: 24, max: 64, pattern: "^[A-Za-z0-9]+$" },
        { name: "label", type: "text", max: 200 },
        // Empty trip = share every dive
        { name: "trip", type: "text", max: 120 },
        { name: "expires", type: "date" },
        ...timestamps,
      ],
      indexes: ["CREATE UNIQUE INDEX idx_shares_token ON shares (token)"],
    });
    app.save(shares);
  },
  (app) => {
    for (const name of ["shares", "photos", "maps", "dives"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {}
    }
  },
);
