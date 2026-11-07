export function formatNum(n) {
  const v = Number(n);
  if (!v && v !== 0) return "";
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, "");
}

export function formatDate(date, time) {
  const [y, m, d] = (date || "").split("-").map(Number);
  if (!y) return "";
  const s = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return time ? `${s}, ${time}` : s;
}

/**
 * A date picked as "stops working after" (YYYY-MM-DD) as the server's UTC
 * datetime for the end of that day in the user's own time zone.
 */
export function endOfLocalDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString().replace("T", " ");
}

/** Server datetime ("2026-11-10 04:59:59.999Z") as a local date for display. */
export function localDate(serverDate) {
  if (!serverDate) return "";
  return new Date(serverDate.replace(" ", "T")).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
