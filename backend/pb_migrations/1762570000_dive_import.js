/// <reference path="../pb_data/types.d.ts" />

// Fields filled by importing a dive computer file (Garmin .fit).
migrate(
  (app) => {
    const dives = app.findCollectionByNameOrId("dives");
    // { from: "garmin", samples: [[seconds, depth m, temperature °C | null], ...] }
    dives.fields.add(new JSONField({ name: "profile", maxSize: 200000 }));
    // where the numbers came from, e.g. "garmin:1793817799" (dive start); used to skip re-imports
    dives.fields.add(new TextField({ name: "source", max: 120 }));
    dives.fields.add(new TextField({ name: "computer", max: 100 }));
    dives.fields.add(new NumberField({ name: "dive_no", min: 0, onlyInt: true }));
    dives.fields.add(new TextField({ name: "gas", max: 200 }));
    dives.addIndex("idx_dives_source", false, "source", "");
    app.save(dives);
  },
  (app) => {
    const dives = app.findCollectionByNameOrId("dives");
    for (const name of ["profile", "source", "computer", "dive_no", "gas"]) dives.fields.removeByName(name);
    dives.removeIndex("idx_dives_source");
    app.save(dives);
  },
);
