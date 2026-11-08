/// <reference path="../pb_data/types.d.ts" />

// A lighter map preview for dive pages and as the first image the map viewer
// and the route tour show (the full map, up to 4000 px, loads behind it).
// "f" fits inside 1200×1200 without enlarging smaller maps.
migrate(
  (app) => {
    const maps = app.findCollectionByNameOrId("maps");
    maps.fields.getByName("image").thumbs = ["480x0", "1200x1200f"];
    app.save(maps);
  },
  (app) => {
    const maps = app.findCollectionByNameOrId("maps");
    maps.fields.getByName("image").thumbs = ["480x0"];
    app.save(maps);
  },
);
