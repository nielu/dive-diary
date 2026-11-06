// Route segment colors: line-arrow orange first, then cave-water teal, then
// guideline gold. Read from CSS so dark mode applies.
const VARS = ["--accent", "--water", "--gold"];

export function segmentColor(i) {
  return `var(${VARS[i % VARS.length]})`;
}

export function segmentColorValue(i) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(VARS[i % VARS.length]).trim();
  return v || "#ff5a1f";
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
