import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChapter, pointAt, pathUpTo, buildTimeline, stateAt } from "../src/lib/tour.js";

const map = {
  width: 1000,
  height: 500,
  route: [
    [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 1 }],
    [{ x: 0.9, y: 0.1 }, { x: 1, y: 0.1 }],
    [{ x: 0.2, y: 0.2 }], // single point: ignored
  ],
  markers: [
    { id: "b", label: "2", x: 0.5, y: 0.75 }, // on the second leg
    { id: "a", label: "1", x: 0.3, y: 0.51 }, // just off the first leg, within threshold
    { id: "c", label: "3", x: 0.95, y: 0.1 }, // on the second segment
    { id: "x", label: "X", x: 0.1, y: 0.9 }, // off route
  ],
};

test("path walks segments in order with jumps adding no distance", () => {
  const ch = buildChapter(map);
  assert.equal(ch.path.length, 5);
  assert.equal(ch.total, 500 + 250 + 100);
  assert.equal(ch.path[3].jump, true);
  assert.equal(ch.path[3].d, 750);
});

test("markers near the route become stops in route order", () => {
  const ch = buildChapter(map);
  assert.deepEqual(ch.stops.map((s) => s.marker.id), ["a", "b", "c"]);
  assert.equal(Math.round(ch.stops[0].d), 300);
  assert.equal(Math.round(ch.stops[1].d), 625);
  assert.equal(Math.round(ch.stops[2].d), 800);
  assert.deepEqual(ch.offRoute.map((m) => m.id), ["x"]);
});

test("pointAt interpolates and jumps between segments", () => {
  const ch = buildChapter(map);
  assert.deepEqual(pointAt(ch.path, 250), { x: 250, y: 250 });
  assert.deepEqual(pointAt(ch.path, 750), { x: 500, y: 500 });
  assert.deepEqual(pointAt(ch.path, 800), { x: 950, y: 50 });
  assert.deepEqual(pointAt(ch.path, 9999), { x: 1000, y: 50 });
});

test("pathUpTo cuts the route at the diver", () => {
  const ch = buildChapter(map);
  const lines = pathUpTo(ch.path, 600);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].at(-1), { x: 500, y: 350 });
  assert.equal(pathUpTo(ch.path, Infinity).length, 2);
});

test("timeline holds the diver at each stop and ends at the route's end", () => {
  const ch = buildChapter(map);
  const blocks = buildTimeline([ch], 800);
  const stops = blocks.filter((b) => b.kind === "stop");
  assert.equal(stops.length, 3);
  for (const b of stops) {
    const mid = stateAt(blocks, [ch], b.top + b.height / 2);
    assert.equal(mid.d, b.d);
    assert.equal(mid.view, "follow");
  }
  const travels = blocks.filter((b) => b.kind === "travel");
  assert.equal(travels.at(-1).d1, ch.total);
  const end = blocks.find((b) => b.kind === "end");
  assert.equal(stateAt(blocks, [ch], end.top + 1).d, ch.total);
  assert.equal(stateAt(blocks, [ch], 0).view, "overview");
  // diver moves monotonically while scrolling
  let last = -1;
  for (let y = 0; y < end.top; y += 25) {
    const s = stateAt(blocks, [ch], y);
    assert.ok(s.d >= last);
    last = s.d;
  }
});
