/**
 * Dives whose maps and photo thumbnails are kept offline: the current trip
 * (the newest dive's) and anything from the 30 days before the newest dive.
 * Older dives work offline only if they were opened before.
 * `dives` must be sorted newest first.
 */
export function offlineDiveIds(dives) {
  const newest = dives[0];
  if (!newest?.date) return new Set();
  const [y, m, d] = newest.date.split("-").map(Number);
  const c = new Date(Date.UTC(y, m - 1, d) - 30 * 86_400_000);
  const cutoff = c.toISOString().slice(0, 10);
  return new Set(dives.filter((x) => (newest.trip && x.trip === newest.trip) || (x.date || "") >= cutoff).map((x) => x.id));
}
