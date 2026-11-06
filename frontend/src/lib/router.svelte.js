// Tiny hash router. Hash URLs keep the share links working on any static host.

function parse() {
  const [path, qs = ""] = (location.hash.replace(/^#/, "") || "/").split("?");
  const parts = path.split("/").filter(Boolean);
  const r = { path, name: "list", params: {}, query: Object.fromEntries(new URLSearchParams(qs)) };

  let p = parts;
  if (p[0] === "s" && p[1]) {
    r.share = p[1];
    p = p.slice(2);
  }
  if (p[0] === "dive" && p[1]) {
    r.params.dive = p[1];
    if (p[2] === "edit") r.name = "edit";
    else if (p[2] === "tour") r.name = "tour";
    else if (p[2] === "map" && p[3]) {
      r.name = "map";
      r.params.map = p[3];
    } else r.name = "dive";
  } else if (p[0] === "shares") r.name = "shares";
  else if (p[0] === "trip" && p[1]) {
    r.name = "list";
    r.params.trip = decodeURIComponent(p[1]);
  }
  return r;
}

export const route = $state(parse());

window.addEventListener("hashchange", () => {
  const prev = route.path;
  Object.assign(route, { params: {}, query: {}, share: undefined }, parse());
  // only a real page change scrolls to the top (not ?m= on the same map)
  if (route.path !== prev) window.scrollTo(0, 0);
});

export function go(path) {
  location.hash = path;
}

