// Geometry for the "Follow the route" tour. Pure functions, no DOM.
//
// A map's route is a list of segments of normalized points. The tour walks
// them in drawing order as one path; the gap between segments is a jump
// (no distance). A marker becomes a stop if the path passes close to it,
// placed at the first point along the path where that happens.

/** Distance threshold for "the route passes this marker", as a fraction of the image's long side. */
export const ON_ROUTE = 0.025;

export function buildChapter(map, { threshold = ON_ROUTE } = {}) {
  const W = map.width || 1000;
  const H = map.height || 1000;
  const segments = (Array.isArray(map.route) ? map.route : []).filter((s) => Array.isArray(s) && s.length >= 2);

  // Path in image pixels with cumulative distance.
  const path = [];
  let d = 0;
  segments.forEach((seg, si) => {
    seg.forEach((p, i) => {
      const x = p.x * W;
      const y = p.y * H;
      if (i > 0) {
        const prev = path[path.length - 1];
        d += Math.hypot(x - prev.x, y - prev.y);
      }
      path.push({ x, y, d, seg: si, jump: i === 0 && si > 0 });
    });
  });
  const total = d;

  const limit = threshold * Math.max(W, H);
  const stops = [];
  const offRoute = [];
  for (const m of Array.isArray(map.markers) ? map.markers : []) {
    const at = firstPass(path, m.x * W, m.y * H, limit);
    if (at === null) offRoute.push(m);
    else stops.push({ marker: m, d: at, x: m.x * W, y: m.y * H });
  }
  stops.sort((a, b) => a.d - b.d || (a.marker.label || "").localeCompare(b.marker.label || "", undefined, { numeric: true }));

  // Bounding box of what the tour shows, in image pixels.
  const pts = [...path, ...stops];
  let bbox = { x0: 0, y0: 0, x1: W, y1: H };
  if (pts.length) {
    bbox = {
      x0: Math.min(...pts.map((p) => p.x)),
      y0: Math.min(...pts.map((p) => p.y)),
      x1: Math.max(...pts.map((p) => p.x)),
      y1: Math.max(...pts.map((p) => p.y)),
    };
    // never zoom into less than 15% of the image
    const minSpan = 0.15 * Math.max(W, H);
    for (const [a, b] of [["x0", "x1"], ["y0", "y1"]]) {
      const span = bbox[b] - bbox[a];
      if (span < minSpan) {
        const c = (bbox[a] + bbox[b]) / 2;
        bbox[a] = c - minSpan / 2;
        bbox[b] = c + minSpan / 2;
      }
    }
  }

  return { map, W, H, path, total, stops, offRoute, bbox };
}

/** Arc-length position of the first place the path comes within `limit` of (px, py). */
function firstPass(path, px, py, limit) {
  if (path.length === 0) return null;
  if (path.length === 1) return Math.hypot(path[0].x - px, path[0].y - py) <= limit ? 0 : null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (b.jump) {
      if (Math.hypot(b.x - px, b.y - py) <= limit) return b.d;
      continue;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
    const qx = a.x + t * dx;
    const qy = a.y + t * dy;
    if (Math.hypot(qx - px, qy - py) <= limit) return a.d + t * (b.d - a.d);
  }
  return null;
}

/** Point on the path at arc length d. */
export function pointAt(path, d) {
  if (path.length === 0) return { x: 0, y: 0 };
  if (d <= 0) return { x: path[0].x, y: path[0].y };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (b.jump) {
      if (d <= b.d) return { x: a.x, y: a.y };
      continue;
    }
    if (d <= b.d) {
      const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
  }
  const last = path[path.length - 1];
  return { x: last.x, y: last.y };
}

/** The path split into drawable polylines, cut at distance d (d = Infinity for the whole route). */
export function pathUpTo(path, d) {
  const lines = [];
  let line = null;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i === 0 || p.jump) {
      if (p.d > d && i > 0) break;
      line = [p];
      lines.push(line);
      continue;
    }
    if (p.d <= d) line.push(p);
    else {
      line.push(pointAt(path, d));
      break;
    }
  }
  return lines.filter((l) => l.length > 1);
}

/**
 * Scroll timeline: a list of blocks (pixel heights) the page stacks
 * vertically. Travel blocks move the diver; stop blocks hold them at a
 * waypoint while its card scrolls past.
 */
export function buildTimeline(chapters, vh, { stopHeight = 1.05, travelPerStop = 0.75, minTravel = 0.3 } = {}) {
  const blocks = [];
  const multi = chapters.length > 1;
  blocks.push({ kind: "intro", chapter: 0, height: Math.round(vh * 1.15) });

  chapters.forEach((ch, ci) => {
    if (multi && ci > 0) blocks.push({ kind: "chapter", chapter: ci, height: Math.round(vh * 0.9) });
    blocks.push({ kind: "start", chapter: ci, height: Math.round(vh * 0.45) });

    const budget = vh * travelPerStop * (ch.stops.length + 1.5);
    let prev = 0;
    const travel = (to) => {
      const frac = ch.total ? (to - prev) / ch.total : 0;
      blocks.push({ kind: "travel", chapter: ci, d0: prev, d1: to, height: Math.round(Math.max(vh * minTravel, frac * budget)) });
      prev = to;
    };
    ch.stops.forEach((stop, si) => {
      travel(stop.d);
      blocks.push({ kind: "stop", chapter: ci, stop: si, d: stop.d, height: Math.round(vh * stopHeight) });
    });
    travel(ch.total);
    blocks.push({ kind: "end", chapter: ci, height: Math.round(vh * 0.8) });
  });

  blocks.push({ kind: "outro", chapter: chapters.length - 1, height: 0 }); // height = content
  let top = 0;
  for (const b of blocks) {
    b.top = top;
    top += b.height;
  }
  return blocks;
}

/** What the camera should show for a focus line at `y` (page px). */
export function stateAt(blocks, chapters, y) {
  let b = blocks[0];
  for (const blk of blocks) {
    if (y >= blk.top) b = blk;
    else break;
  }
  const ch = chapters[b.chapter];
  const t = b.height ? Math.max(0, Math.min(1, (y - b.top) / b.height)) : 1;
  switch (b.kind) {
    case "intro":
    case "chapter":
      return { chapter: b.chapter, d: 0, view: "overview", stop: -1, showDiver: false, block: b };
    case "start":
      return { chapter: b.chapter, d: 0, view: t < 0.5 ? "overview" : "follow", stop: -1, showDiver: true, block: b };
    case "travel":
      return { chapter: b.chapter, d: b.d0 + (b.d1 - b.d0) * t, view: "follow", stop: -1, showDiver: true, block: b };
    case "stop":
      return { chapter: b.chapter, d: b.d, view: "follow", stop: b.stop, showDiver: true, block: b };
    default:
      return { chapter: b.chapter, d: ch?.total || 0, view: "overview", stop: -1, showDiver: b.kind === "end", block: b };
  }
}
