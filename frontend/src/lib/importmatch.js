// How imported dives relate to the dives already in the log.

const minutes = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);

/**
 * For each imported dive (in file order), one of:
 *   { kind: "duplicate", dive }  already imported (same dive computer start)
 *   { kind: "fill", dive }       a dive you logged by hand: same day, time in
 *                                within 45 min, or the only untimed dive that day
 *   { kind: "new" }
 * A logged dive is filled by at most one file; files repeated in the batch
 * count as duplicates.
 */
export function planImport(imported, dives) {
  const claimed = new Set();
  const seen = new Map(dives.filter((d) => d.source).map((d) => [d.source, d]));
  return imported.map((imp) => {
    const dup = seen.get(imp.source);
    if (dup) return { kind: "duplicate", dive: dup };
    seen.set(imp.source, { id: null, site: imp.site, date: imp.date });

    const sameDay = dives.filter((d) => !d.source && d.date === imp.date && !claimed.has(d.id));
    const t = minutes(imp.time);
    const timed = sameDay
      .filter((d) => d.time)
      .map((d) => ({ d, gap: Math.abs(minutes(d.time) - t) }))
      .filter((c) => c.gap <= 45)
      .sort((a, b) => a.gap - b.gap);
    const untimed = sameDay.filter((d) => !d.time);
    const target = timed[0]?.d || (untimed.length === 1 ? untimed[0] : null);
    if (target) {
      claimed.add(target.id);
      return { kind: "fill", dive: target };
    }
    return { kind: "new" };
  });
}

/** Fields the dive computer knows better than a hand-written entry. */
export const COMPUTER_FIELDS = ["date", "time", "max_depth", "avg_depth", "temp", "duration", "dive_no", "computer", "source", "profile"];

/** A logged dive with an import applied: the computer's numbers win, your text stays. */
export function applyImport(dive, imp) {
  const out = { ...dive };
  for (const f of COMPUTER_FIELDS) out[f] = imp[f];
  if (!dive.gas) out.gas = imp.gas;
  if (!dive.site) out.site = imp.site;
  return out;
}
