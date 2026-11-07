import { test } from "node:test";
import assert from "node:assert/strict";
import { endOfLocalDay } from "../src/lib/format.js";
import { offlineDiveIds } from "../src/lib/offline.js";
import { classify, describe, SyncAbort } from "../src/lib/sync.js";

test("share expiry is the end of the chosen day in the user's time zone", () => {
  const tz = process.env.TZ;
  try {
    process.env.TZ = "America/Cancun";
    assert.equal(endOfLocalDay("2026-11-10"), "2026-11-11 04:59:59.999Z");
    process.env.TZ = "Europe/Warsaw";
    assert.equal(endOfLocalDay("2026-11-10"), "2026-11-10 22:59:59.999Z");
  } finally {
    process.env.TZ = tz;
  }
});

test("offline cache keeps the current trip and the last 30 days", () => {
  const dives = [
    { id: "a", date: "2026-11-05", trip: "Mexico" },
    { id: "b", date: "2026-11-01", trip: "Mexico" },
    { id: "c", date: "2026-10-10", trip: "" },
    { id: "d", date: "2026-09-01", trip: "Mexico" }, // same trip, older
    { id: "e", date: "2026-09-01", trip: "Hranice" },
  ];
  assert.deepEqual([...offlineDiveIds(dives)].sort(), ["a", "b", "c", "d"]);
  assert.equal(offlineDiveIds([]).size, 0);
});

test("errors are sorted into temporary kinds and permanent rejections", () => {
  assert.equal(classify({ status: 0 }), "offline");
  assert.equal(classify({ status: 0, isAbort: true }), "offline");
  assert.equal(classify({ status: 401 }), "auth");
  assert.equal(classify({ status: 429 }), "busy");
  assert.equal(classify({ status: 502 }), "server");
  assert.equal(classify({ status: 400 }), null);
  assert.equal(classify(new TypeError("bug")), null);
  assert.equal(classify(new SyncAbort("offline")), "offline");
});

test("rejection reasons use field names people know", () => {
  const err = { status: 400, response: { data: { date: { message: "Cannot be blank." }, site: { message: "Must be no more than 200 character(s)." } } } };
  assert.equal(describe(err), "Date: Cannot be blank. Site: Must be no more than 200 character(s).");
});
