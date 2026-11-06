import { test } from "node:test";
import assert from "node:assert/strict";
import { markerIndex, findRefs, createRenderer, isReferenceable } from "../src/lib/refs.js";

const maps = [
  { id: "mapA", markers: [{ id: "a1", label: "T1", note: "Go left" }, { id: "a2", label: "3" }, { id: "a3", label: "J-2" }] },
  { id: "mapB", markers: [{ id: "b1", label: "t1" }, { id: "b2", label: "X" }, { id: "b3", label: "A/1" }] },
];
const index = markerIndex(maps);
const href = (r) => `#/dive/d/map/${r.mapId}?m=${r.markerId}`;

test("index: first marker wins for a duplicate label, unreferenceable labels skipped", () => {
  assert.equal(index.get("t1").markerId, "a1");
  assert.equal(index.get("x").mapId, "mapB");
  assert.equal(index.has("a/1"), false);
  assert.equal(isReferenceable("J-2"), true);
  assert.equal(isReferenceable("A/1"), false);
  assert.equal(isReferenceable("2."), false);
});

test("findRefs: case-insensitive, ignores unknown labels, mid-word # and entities", () => {
  const refs = findRefs("At #t1 go left, then #3. Not #99, not abc#3, not &#3; but (#J-2) and #X!", index);
  assert.deepEqual(refs.map((r) => r.text), ["#t1", "#3", "#J-2", "#X"]);
  assert.deepEqual(refs.map((r) => r.markerId), ["a1", "a2", "a3", "b2"]);
});

test("renderer: links references, keeps markdown, escapes, leaves unknown as text", () => {
  const html = createRenderer(index, href).parse("**Turn** at #T1.\n- jump at #3\n- #nope stays");
  assert.match(html, /<strong>Turn<\/strong> at <a class="mref" href="#\/dive\/d\/map\/mapA\?m=a1" data-marker="a1" title="Go left"><i aria-hidden="true"><\/i>T1<\/a>\./);
  assert.match(html, /jump at <a class="mref"[^>]*data-marker="a2"/);
  assert.match(html, /#nope stays/);
  assert.equal((html.match(/class="mref"/g) || []).length, 2);
});

test("renderer: references at the start of a line are not headings", () => {
  const html = createRenderer(index, href).parse("#T1 first decision\n#3 second");
  assert.doesNotMatch(html, /<h1/);
  assert.equal((html.match(/class="mref"/g) || []).length, 2);
});

test("renderer: real headings and code are untouched", () => {
  const html = createRenderer(index, href).parse("# Plan\n\n`#T1` in code");
  assert.match(html, /<h1>Plan<\/h1>/);
  assert.match(html, /<code>#T1<\/code>/);
  assert.doesNotMatch(html, /mref/);
});

test("renderer: an unknown #tag earlier in the paragraph doesn't hide a later reference", () => {
  const html = createRenderer(index, href).parse("Dive #2 of the day, turned at #T1");
  assert.equal((html.match(/class="mref"/g) || []).length, 1);
  assert.match(html, /Dive #2 of the day, turned at <a class="mref"/);
});
