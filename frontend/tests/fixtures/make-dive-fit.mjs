// Writes made-up Garmin dives in the same shape as a Descent/fēnix export
// (no GPS, no personal data):
//   synthetic-dive.fit    2026-03-14 10:05 local, 21.3 m, EAN32 (+ unused O2), dive 42
//   synthetic-dive-2.fit  2026-03-15 11:00 local, 17 m, air, dive 43
//   synthetic-dive-3.fit  2026-03-16 09:30 local, 12.8 m, air, dive 44
//   node tests/fixtures/make-dive-fit.mjs
import fs from "node:fs";
import { Encoder, Profile } from "@garmin/fitsdk";

const M = Profile.MesgNum;
const offsetS = -5 * 3600; // Cancún (UTC−5)
const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z

for (const cfg of [
  { file: "synthetic-dive.fit", start: new Date("2026-03-14T15:05:00Z"), scale: 1, diveNumber: 42, gases: [32, 100] },
  { file: "synthetic-dive-2.fit", start: new Date("2026-03-15T16:00:00Z"), scale: 0.8, diveNumber: 43, gases: [21] },
  { file: "synthetic-dive-3.fit", start: new Date("2026-03-16T14:30:00Z"), scale: 0.6, diveNumber: 44, gases: [21] },
]) write(cfg);

// depth (m) over time (s): descent, wander at 18–21 m, ascent, 3 min stop at 5 m
function depthAt(t) {
  if (t < 180) return (t / 180) * 18;
  if (t < 2580) return 19.5 + 1.8 * Math.sin(t / 300);
  if (t < 2880) return 19.5 - ((t - 2580) / 300) * 14.5;
  if (t < 3060) return 5;
  if (t < 3150) return 5 - ((t - 3060) / 90) * 5;
  return 0;
}
function write({ file, start, scale, diveNumber, gases }) {
const samples = [];
for (let t = 0; t <= 3160; t += 2) {
  const depth = Math.max(0, +(depthAt(t) * scale).toFixed(3));
  samples.push({ t, depth, temperature: depth > 12 ? 24 : 25 });
}
const under = samples.filter((s) => s.depth > 0);
const maxDepth = Math.max(...under.map((s) => s.depth));
const avgDepth = under.reduce((a, s) => a + s.depth, 0) / under.length;
const end = new Date(start.getTime() + 3160 * 1000);

const enc = new Encoder();
enc.onMesg(M.FILE_ID, { type: "activity", manufacturer: "garmin", product: 4223, serialNumber: 1234567890, timeCreated: start });
enc.onMesg(M.DEVICE_INFO, { timestamp: start, deviceIndex: "creator", manufacturer: "garmin", product: 4223, serialNumber: 1234567890, softwareVersion: 20.1 });
enc.onMesg(M.DIVE_SETTINGS, { messageIndex: 0, model: "zhl16c", gfLow: 50, gfHigh: 80, waterType: "fresh", waterDensity: 1000 });
gases.forEach((o2, i) => enc.onMesg(M.DIVE_GAS, { messageIndex: i, heliumContent: 0, oxygenContent: o2, status: "enabled", mode: "openCircuit" }));
enc.onMesg(M.DIVE_GAS, { messageIndex: gases.length, heliumContent: 0, oxygenContent: 50, status: "disabled", mode: "openCircuit" });
enc.onMesg(M.EVENT, { timestamp: start, event: "timer", eventType: "start" });
for (const s of samples) {
  enc.onMesg(M.RECORD, { timestamp: new Date(start.getTime() + s.t * 1000), depth: s.depth, temperature: s.temperature });
}
enc.onMesg(M.EVENT, { timestamp: end, event: "timer", eventType: "stopAll" });
const session = { timestamp: end, startTime: start, totalElapsedTime: 3160, totalTimerTime: 3160, sport: "diving", subSport: "multiGasDiving", minTemperature: 24, maxTemperature: 25, avgTemperature: 24, messageIndex: 0, event: "session", eventType: "stop" };
enc.onMesg(M.LAP, { ...session, event: "lap" });
enc.onMesg(M.DIVE_SUMMARY, { timestamp: end, referenceMesg: "session", referenceIndex: 0, avgDepth, maxDepth, bottomTime: 3150, diveNumber, surfaceInterval: 7200 });
enc.onMesg(M.SESSION, session);
enc.onMesg(M.ACTIVITY, { timestamp: end, localTimestamp: Math.round(end.getTime() / 1000) - FIT_EPOCH_S + offsetS, totalTimerTime: 3160, numSessions: 1, type: "manual", event: "activity", eventType: "stop" });

const out = new URL(`./${file}`, import.meta.url);
fs.writeFileSync(out, enc.close());
console.log(`wrote ${out.pathname}: max ${maxDepth.toFixed(2)} m, avg ${avgDepth.toFixed(2)} m`);
}
