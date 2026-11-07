// Reads a Garmin dive (.fit, one dive per file, as the Garmin Dive and
// Connect apps share it) into dive fields and a compact depth profile.
// GPS positions in the file are ignored on purpose: cave entrances shouldn't
// end up in share links.
//
// The Garmin FIT SDK is ~1.5 MB of source, so it's loaded only when a file is
// actually imported.

const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z, FIT's time zero
const MAX_POINTS = 360; // profile samples kept per dive

export class DiveFileError extends Error {}

/** @returns {Promise<ImportedDive>} */
export async function readDiveFile(bytes, fileName = "") {
  const { Decoder, Stream } = await import("@garmin/fitsdk");
  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decoder = new Decoder(Stream.fromArrayBuffer(buffer));
  if (!decoder.isFIT()) throw new DiveFileError("This isn't a Garmin .fit file.");

  const { messages, errors } = decoder.read({
    convertDateTimesToDates: true,
    convertTypesToStrings: true,
    includeUnknownData: false,
    mergeHeartRates: false,
  });
  const session = messages.sessionMesgs?.[0];
  if (!session) {
    throw new DiveFileError(errors?.length ? "This file is damaged or incomplete." : "This file has no activity in it.");
  }
  if (session.sport !== "diving") {
    throw new DiveFileError(`This is a ${String(session.sport || "non-dive").replace(/([A-Z])/g, " $1").toLowerCase()} activity, not a dive.`);
  }
  return toDive(messages, session, fileName);
}

function toDive(messages, session, fileName) {
  const summaries = messages.diveSummaryMesgs || [];
  const summary = summaries.find((s) => s.referenceMesg === "session") || summaries[0] || {};
  const start = new Date(session.startTime);
  const records = (messages.recordMesgs || [])
    .filter((r) => r.timestamp && typeof r.depth === "number")
    .map((r) => ({ t: (new Date(r.timestamp) - start) / 1000, d: r.depth, c: typeof r.temperature === "number" ? r.temperature : null }))
    .sort((a, b) => a.t - b.t);

  const local = new Date(start.getTime() + localOffsetSeconds(messages, start) * 1000);
  const iso = local.toISOString();

  const depths = records.map((r) => r.d);
  const temps = records.map((r) => r.c).filter((c) => c !== null);
  const maxDepth = summary.maxDepth ?? (depths.length ? Math.max(...depths) : 0);
  const avgDepth = summary.avgDepth ?? timeWeightedAverage(records);
  const seconds = summary.bottomTime ?? underwaterSeconds(records) ?? session.totalElapsedTime ?? 0;
  const minTemp = session.minTemperature ?? (temps.length ? Math.min(...temps) : 0);

  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
    max_depth: round(maxDepth, 1),
    avg_depth: round(avgDepth, 1),
    temp: round(minTemp, 1),
    duration: Math.round(seconds / 60),
    dive_no: summary.diveNumber ?? 0,
    gas: gasesUsed(messages),
    computer: computerName(messages),
    source: `garmin:${Math.round(start.getTime() / 1000)}`,
    profile: { from: "garmin", samples: downsample(records, MAX_POINTS) },
    site: siteFromFileName(fileName),
  };
}

/** Offset of the dive site's clock from UTC, from the activity's local timestamp. */
function localOffsetSeconds(messages, start) {
  const activity = messages.activityMesgs?.[0];
  if (activity?.localTimestamp != null && activity.timestamp) {
    const raw = activity.localTimestamp + FIT_EPOCH_S - new Date(activity.timestamp).getTime() / 1000;
    return Math.round(raw / 900) * 900; // whole quarter hours
  }
  return -start.getTimezoneOffset() * 60; // fall back to this device's zone
}

function timeWeightedAverage(records) {
  let area = 0;
  let time = 0;
  for (let i = 1; i < records.length; i++) {
    const dt = records[i].t - records[i - 1].t;
    if (dt <= 0 || dt > 120) continue;
    area += ((records[i].d + records[i - 1].d) / 2) * dt;
    time += dt;
  }
  return time ? area / time : 0;
}

function underwaterSeconds(records) {
  const under = records.filter((r) => r.d > 0.5);
  return under.length > 1 ? under.at(-1).t - under[0].t : null;
}

/** The gas the dive started on plus any switched to, e.g. "EAN32, O2". */
function gasesUsed(messages) {
  const gases = (messages.diveGasMesgs || []).filter((g) => g.status !== "disabled" && typeof g.oxygenContent === "number");
  if (!gases.length) return "";
  const byIndex = new Map(gases.map((g, i) => [g.messageIndex ?? i, g]));
  const used = [gases[0]];
  for (const e of messages.eventMesgs || []) {
    if (e.event === "gasSwitched" || e.event === "gasSwitch") {
      const g = byIndex.get(e.data);
      if (g && !used.includes(g)) used.push(g);
    }
  }
  return used.map(gasLabel).join(", ");
}

function gasLabel(g) {
  const o2 = Math.round(g.oxygenContent);
  const he = Math.round(g.heliumContent || 0);
  let label = he ? `Tx ${o2}/${he}` : o2 === 21 ? "Air" : o2 === 100 ? "O2" : `EAN${o2}`;
  if (String(g.mode || "").startsWith("closedCircuit")) label += " (CCR)";
  return label;
}

function computerName(messages) {
  const creator = (messages.deviceInfoMesgs || []).find((d) => d.deviceIndex === "creator") || messages.fileIdMesgs?.[0] || {};
  const product = creator.garminProduct ?? messages.fileIdMesgs?.[0]?.garminProduct;
  if (typeof product !== "string") return "Garmin";
  const words = product
    .replace(/([a-z])([A-Z])/g, "$1 $2") // fenix8Small → fenix8 Small
    .replace(/([a-z]{3,})(\d)/g, "$1 $2") // fenix8 → fenix 8, but Mk3i stays
    .replace(/\b(Small|Large|Solar|Sapphire)\b/gi, "")
    .trim()
    .replace(/\s+/g, " ");
  return `Garmin ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * Keeps the shape of a profile in at most `max` points: per time bucket the
 * shallowest and deepest sample, in time order, plus the first and last.
 * Each point is [seconds from start, depth m, temperature °C or null].
 */
export function downsample(records, max) {
  const pack = (r) => [Math.round(r.t), round(r.d, 1), r.c === null ? null : round(r.c, 1)];
  if (records.length <= max) return records.map(pack);
  const buckets = Math.floor((max - 2) / 2);
  const span = records.at(-1).t - records[0].t || 1;
  const picked = new Set([0, records.length - 1]);
  let bucket = -1;
  let lo = -1;
  let hi = -1;
  const flush = () => {
    if (lo >= 0) picked.add(lo).add(hi);
  };
  records.forEach((r, i) => {
    const b = Math.min(buckets - 1, Math.floor(((r.t - records[0].t) / span) * buckets));
    if (b !== bucket) {
      flush();
      bucket = b;
      lo = hi = i;
    } else {
      if (r.d < records[lo].d) lo = i;
      if (r.d > records[hi].d) hi = i;
    }
  });
  flush();
  return [...picked].sort((a, b) => a - b).map((i) => pack(records[i]));
}

/**
 * A readable site name from the shared file's name, e.g.
 * "Cenote_jardi_n_del_Ede_n_2.fit" → "Cenote jardín del Edén 2".
 * Some apps write accented letters as letter + "_" (a stripped combining
 * accent); a lone consonant after a vowel is put back as an accent.
 */
export function siteFromFileName(name) {
  let base = (name || "").normalize("NFC").replace(/\.[^.]*$/, "");
  base = base.replace(/^[0-9a-f]{6,}-\d+_/i, ""); // upload id prefix some apps add
  if (/^\d+(_ACTIVITY)?$/i.test(base) || !base) return ""; // Garmin's numeric default
  const ACUTE = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };
  base = base.replace(/([aeiouAEIOU])_([b-df-hj-np-tv-zñ])(?=_|$)/g, (_, v, c) => ACUTE[v] + c);
  return base.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
