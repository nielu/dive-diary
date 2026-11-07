import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readDiveFile, siteFromFileName, downsample, DiveFileError } from "../src/lib/fitimport.js";
import { planImport, applyImport } from "../src/lib/importmatch.js";

const fixture = fs.readFileSync(new URL("./fixtures/synthetic-dive.fit", import.meta.url));

test("a Garmin dive file becomes dive fields in the dive site's local time", async () => {
  const d = await readDiveFile(fixture, "Cenote_Calimba.fit");
  assert.equal(d.date, "2026-03-14");
  assert.equal(d.time, "10:05"); // 15:05 UTC, recorded at UTC−5
  assert.equal(d.max_depth, 21.3);
  assert.equal(d.avg_depth, 17.2);
  assert.equal(d.temp, 24);
  assert.equal(d.duration, 53);
  assert.equal(d.dive_no, 42);
  assert.equal(d.gas, "EAN32"); // the O2 bottle was set up but never switched to
  assert.equal(d.computer, "Garmin Descent Mk3i");
  assert.equal(d.source, "garmin:1773500700");
  assert.equal(d.site, "Cenote Calimba");
  assert.ok(d.profile.samples.length <= 360);
  assert.equal(Math.max(...d.profile.samples.map((s) => s[1])), 21.3, "deepest point survives downsampling");
  assert.deepEqual(d.profile.samples[0], [0, 0, 25]);
});

test("files that aren't dives are refused with a reason", async () => {
  await assert.rejects(readDiveFile(new TextEncoder().encode("hello, not a fit file"), "notes.txt"), DiveFileError);
});

test("site names come back from file names, accents included", () => {
  assert.equal(siteFromFileName("04365bb6-186_Cenote_jardi_n_del_Ede_n_2.fit"), "Cenote jardín del Edén 2");
  assert.equal(siteFromFileName("Cenote_Dos_Ojos.fit"), "Cenote Dos Ojos");
  assert.equal(siteFromFileName("Cenote jardín del Edén.fit"), "Cenote jardín del Edén");
  assert.equal(siteFromFileName("18234567890_ACTIVITY.fit"), "");
});

test("downsampling keeps the shape within the point budget", () => {
  const recs = Array.from({ length: 5000 }, (_, i) => ({ t: i, d: i === 2500 ? 40 : 10 + Math.sin(i / 50), c: 25 }));
  const out = downsample(recs, 100);
  assert.ok(out.length <= 100);
  assert.deepEqual(out[0].slice(0, 1), [0]);
  assert.equal(out.at(-1)[0], 4999);
  assert.ok(out.some((s) => s[1] === 40), "spike kept");
});

test("imports fill hand-written dives, skip re-imports, and create the rest", () => {
  const imp = (source, date, time) => ({ source, date, time, site: "From file" });
  const dives = [
    { id: "a", date: "2026-11-04", time: "13:30", site: "Jardín", source: "" },
    { id: "b", date: "2026-11-05", time: "", site: "Taj Mahal", source: "" },
    { id: "c", date: "2026-11-06", time: "09:00", site: "Done", source: "garmin:1" },
  ];
  const plan = planImport(
    [imp("garmin:2", "2026-11-04", "13:43"), imp("garmin:3", "2026-11-04", "16:10"), imp("garmin:4", "2026-11-05", "10:00"), imp("garmin:1", "2026-11-06", "09:00"), imp("garmin:2", "2026-11-04", "13:43")],
    dives,
  );
  assert.deepEqual(plan.map((p) => [p.kind, p.dive?.id ?? null]), [
    ["fill", "a"], // 13 minutes apart
    ["new", null], // second dive that day, too far from 13:30
    ["fill", "b"], // only untimed dive that day
    ["duplicate", "c"],
    ["duplicate", null], // same file twice in one go
  ]);
});

test("applying an import keeps your text and takes the computer's numbers", () => {
  const dive = { id: "a", date: "2026-11-04", time: "13:30", site: "Jardín", log: "Great vis", max_depth: 15, gas: "EAN30" };
  const out = applyImport(dive, { date: "2026-11-04", time: "13:43", max_depth: 14.2, avg_depth: 9.2, temp: 26, duration: 83, dive_no: 187, computer: "Garmin Fenix 8", source: "garmin:2", profile: { samples: [] }, gas: "Air", site: "From file" });
  assert.equal(out.max_depth, 14.2);
  assert.equal(out.time, "13:43");
  assert.equal(out.log, "Great vis");
  assert.equal(out.site, "Jardín");
  assert.equal(out.gas, "EAN30", "a gas you typed stays");
});
