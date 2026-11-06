<script>
  import { formatNum } from "../lib/format.js";

  /** @type {{ dives: any[], base?: string, maps?: any[], photos?: any[] }} */
  let { dives, base = "", maps = [], photos = [] } = $props();

  const deepest = $derived(Math.max(10, ...dives.map((d) => Number(d.max_depth) || 0)));
  const counts = $derived.by(() => {
    const c = {};
    for (const m of maps) (c[m.dive] ??= { maps: 0, photos: 0 }).maps++;
    for (const p of photos) (c[p.dive] ??= { maps: 0, photos: 0 }).photos++;
    return c;
  });

  // Group by month so the list reads like a logbook.
  const groups = $derived.by(() => {
    const out = [];
    for (const d of dives) {
      const key = (d.date || "").slice(0, 7);
      if (out.at(-1)?.key !== key) out.push({ key, label: monthLabel(key), dives: [] });
      out.at(-1).dives.push(d);
    }
    return out;
  });

  function monthLabel(ym) {
    const [y, m] = ym.split("-").map(Number);
    if (!y || !m) return "No date";
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  function day(d) {
    return Number((d.date || "").slice(8, 10)) || "";
  }
  function weekday(d) {
    const [y, m, dd] = (d.date || "").split("-").map(Number);
    if (!y) return "";
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: "short" });
  }
</script>

{#each groups as g (g.key)}
  <section>
    <h2 class="month">{g.label}</h2>
    <ol>
      {#each g.dives as d (d.id)}
        {@const depth = Number(d.max_depth) || 0}
        <li>
          <a href={`#${base}/dive/${d.id}`}>
            <div class="date">
              <b>{day(d)}</b>
              <span>{weekday(d)}{d.time ? ` ${d.time}` : ""}</span>
            </div>
            <div class="main">
              <h3>{d.site || "Untitled dive"}</h3>
              <div class="meta">
                {#if d.trip}<span class="trip-tag">{d.trip}</span>{/if}
                {#if depth}<span>{formatNum(depth)} m</span>{/if}
                {#if d.duration}<span>{d.duration} min</span>{/if}
                {#if d.temp}<span>{formatNum(d.temp)}°C</span>{/if}
                {#if counts[d.id]?.maps}<span class="muted">{counts[d.id].maps} {counts[d.id].maps === 1 ? "map" : "maps"}</span>{/if}
                {#if d._dirty}<span class="unsynced" title="Saved on this device, not synced yet">not synced</span>{/if}
              </div>
            </div>
            <div class="depth" aria-hidden="true" title={depth ? `${formatNum(depth)} m max` : ""}>
              <i style:height={`${(depth / deepest) * 100}%`}></i>
            </div>
          </a>
        </li>
      {/each}
    </ol>
  </section>
{/each}

<style>
  section { margin-top: 1.5rem; }
  .month {
    font-size: 1rem;
    font-weight: 650;
    font-stretch: 100%;
    color: var(--ink-2);
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--rule);
  }
  ol { list-style: none; margin: 0; padding: 0; }
  li { border-bottom: 1px solid var(--rule); }
  a {
    display: grid;
    grid-template-columns: 3.4rem 1fr 6px;
    gap: 0.9rem;
    align-items: stretch;
    padding: 0.85rem 0;
    text-decoration: none;
  }
  a:hover h3 { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
  .date { display: grid; align-content: start; line-height: 1; }
  .date b {
    font-size: 2rem;
    font-weight: 780;
    font-stretch: 65%;
  }
  .date span { font-size: 0.78rem; color: var(--ink-2); margin-top: 0.25rem; }
  .main { min-width: 0; }
  h3 {
    font-size: 1.3rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.75rem;
    margin-top: 0.35rem;
    font-size: 0.9rem;
    align-items: center;
  }
  .unsynced { color: var(--accent-text); font-size: 0.8rem; font-weight: 600; }
  .depth {
    background: var(--rule);
    border-radius: 3px;
    overflow: hidden;
    min-height: 44px;
  }
  .depth i {
    display: block;
    width: 100%;
    background: var(--water);
    border-radius: 3px;
  }
</style>
