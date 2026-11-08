// Marker references in log text: "#T1" links to the marker labelled T1 on
// one of the dive's maps. Matching ignores case. A reference to a label that
// doesn't exist stays plain text.

import { Marked } from "marked";
import { escapeHtml } from "./mapstyle.js";

// "#" not preceded by a word character or "&" (so "abc#1" and "&#39;" are
// left alone), then a label of letters/digits, optionally joined by . _ -
// ("#T1", "#3", "#J-2"). Trailing punctuation is not part of the label.
const REF = /(?<![\w&#])#([A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*)/;
const REF_AT_START = new RegExp("^" + REF.source.replace("(?<![\\w&#])", ""));

/** Labels that can be written as a reference. */
export function isReferenceable(label) {
  return REF_AT_START.test("#" + (label || "")) && REF_AT_START.exec("#" + label)[0].length === label.length + 1;
}

/**
 * Lookup of the dive's markers by lowercase label. Maps are taken in their
 * display order; if two markers share a label, the first one wins.
 */
export function markerIndex(maps) {
  const index = new Map();
  for (const map of maps) {
    for (const m of Array.isArray(map.markers) ? map.markers : []) {
      const key = (m.label || "").trim().toLowerCase();
      if (key && isReferenceable(m.label.trim()) && !index.has(key)) {
        index.set(key, { mapId: map.id, markerId: m.id, label: m.label.trim(), note: m.note || "" });
      }
    }
  }
  return index;
}

/** Every "#label" written in the text, in order, each once (as first written). */
export function findLabels(text) {
  const seen = new Set();
  const out = [];
  for (const m of (text || "").matchAll(new RegExp(REF.source, "g"))) {
    const key = m[1].toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(m[1]);
    }
  }
  return out;
}

/** Find references in plain text (used by tests and the editor). */
export function findRefs(text, index) {
  const re = new RegExp(REF.source, "g");
  const out = [];
  for (const m of (text || "").matchAll(re)) {
    const hit = index.get(m[1].toLowerCase());
    if (hit) out.push({ index: m.index, text: m[0], ...hit });
  }
  return out;
}

/**
 * Markdown renderer that turns references into links.
 * `hrefFor(ref)` returns the link target for a reference.
 */
export function createRenderer(index, hrefFor) {
  const md = new Marked({ breaks: true, gfm: true });
  if (!index.size) return md;
  md.use({
    extensions: [
      {
        name: "markerRef",
        level: "inline",
        start(src) {
          // first reference to a label that exists (skip unknown "#tags")
          for (const m of src.matchAll(new RegExp(REF.source, "g"))) {
            if (index.has(m[1].toLowerCase())) return m.index;
          }
          return undefined;
        },
        tokenizer(src) {
          const m = REF_AT_START.exec(src);
          if (!m) return undefined;
          const ref = index.get(m[1].toLowerCase());
          if (!ref) return undefined;
          return { type: "markerRef", raw: m[0], ref };
        },
        renderer(token) {
          const r = token.ref;
          const title = r.note ? ` title="${escapeHtml(r.note)}"` : "";
          return `<a class="mref" href="${escapeHtml(hrefFor(r))}" data-marker="${escapeHtml(r.markerId)}"${title}><i aria-hidden="true"></i>${escapeHtml(r.label)}</a>`;
        },
      },
    ],
  });
  return md;
}
