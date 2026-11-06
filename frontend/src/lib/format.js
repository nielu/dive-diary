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
