<script>
  import { formatNum, formatDate } from "../lib/format.js";
  import Markdown from "./Markdown.svelte";
  import MapPreview from "./MapPreview.svelte";
  import PhotoGrid from "./PhotoGrid.svelte";
  import { markerIndex } from "../lib/refs.js";

  /** @type {{ dive: any, maps: any[], photos: any[], base?: string, owner?: boolean, fileUrl: (r: any, thumb?: string) => string, onAddMaps?: (files: File[]) => void, onAddPhotos?: (files: File[]) => void, busy?: string }} */
  let { dive, maps, photos, base = "", owner = false, fileUrl, onAddMaps, onAddPhotos, busy = "" } = $props();

  const refs = $derived(markerIndex(maps));
  const refHref = (r) => `#${base}/dive/${dive.id}/map/${r.mapId}?m=${r.markerId}`;
  const hasRoute = $derived(maps.some((m) => Array.isArray(m.route) && m.route.some((s) => s.length > 1)));

  const stats = $derived(
    [
      { label: "Max depth", value: dive.max_depth, unit: "m" },
      { label: "Avg depth", value: dive.avg_depth, unit: "m" },
      { label: "Water", value: dive.temp, unit: "°C" },
      { label: "Run time", value: dive.duration, unit: "min" },
    ].filter((s) => Number(s.value)),
  );

  function pick(e, handler) {
    const files = [...(e.currentTarget.files || [])];
    e.currentTarget.value = "";
    if (files.length) handler?.(files);
  }
</script>

<article class="wrap">
  <header class="title">
    <p class="when">{formatDate(dive.date, dive.time)}</p>
    <h1>{dive.site || "Untitled dive"}</h1>
    {#if dive.trip}<a class="trip-tag" href={`#${base}/trip/${encodeURIComponent(dive.trip)}`}>{dive.trip}</a>{/if}
    {#if hasRoute}
      <a class="btn btn-primary follow" href={`#${base}/dive/${dive.id}/tour`}>Follow the route</a>
    {/if}
  </header>

  {#if stats.length}
    <dl class="stats" style:--n={stats.length} style:--cols-narrow={stats.length === 4 ? 2 : stats.length}>
      {#each stats as s}
        <div><dt>{s.label}</dt><dd>{formatNum(s.value)}<small>{s.unit}</small></dd></div>
      {/each}
    </dl>
  {/if}

  {#if dive.team || dive.leader}
    <dl class="team">
      {#if dive.leader}<div><dt>Led by</dt><dd>{dive.leader}</dd></div>{/if}
      {#if dive.team}<div><dt>Team</dt><dd>{dive.team}</dd></div>{/if}
    </dl>
  {/if}

  {#if dive.navigation}
    <section>
      <h2>Navigation</h2>
      <Markdown text={dive.navigation} {refs} hrefFor={refHref} />
    </section>
  {/if}

  {#if dive.log}
    <section>
      <h2>Log</h2>
      <Markdown text={dive.log} {refs} hrefFor={refHref} />
    </section>
  {/if}

  {#if maps.length || owner}
    <section>
      <div class="sec-head">
        <h2>{maps.length === 1 ? "Map" : "Maps"}</h2>
        {#if owner}
          <label class="btn">
            {busy === "maps" ? "Adding…" : "Add map"}
            <input type="file" accept="image/*" multiple hidden onchange={(e) => pick(e, onAddMaps)} disabled={!!busy} />
          </label>
        {/if}
      </div>
      {#each maps as m (m.id)}
        <figure>
          <MapPreview map={m} src={fileUrl(m)} href={`#${base}/dive/${dive.id}/map/${m.id}`} />
          <figcaption>
            <span>{m.caption || "Untitled map"}</span>
            <span class="muted small">
              {(m.markers?.length || 0) === 1 ? "1 marker" : `${m.markers?.length || 0} markers`}{m.route?.some((s) => s.length > 1) ? ", route drawn" : ""}
            </span>
          </figcaption>
        </figure>
      {:else}
        <p class="muted">Add a photo of the cave map, then drop markers and draw the route on it.</p>
      {/each}
    </section>
  {/if}

  {#if photos.length || owner}
    <section>
      <div class="sec-head">
        <h2>Photos</h2>
        {#if owner}
          <label class="btn">
            {busy === "photos" ? "Adding…" : "Add photos"}
            <input type="file" accept="image/*" multiple hidden onchange={(e) => pick(e, onAddPhotos)} disabled={!!busy} />
          </label>
        {/if}
      </div>
      {#if photos.length}
        <PhotoGrid {photos} {fileUrl} {owner} />
      {:else}
        <p class="muted">No photos yet.</p>
      {/if}
    </section>
  {/if}
</article>

<style>
  article { padding-bottom: 5rem; }
  .title { margin: 1.5rem 0 1.25rem; display: grid; gap: 0.5rem; justify-items: start; }
  .when { margin: 0; color: var(--ink-2); font-weight: 600; }
  h1 { font-size: clamp(2.25rem, 9vw, 3.25rem); overflow-wrap: anywhere; }
  .trip-tag { text-decoration: none; }
  .follow { margin-top: 0.6rem; }

  .stats {
    display: grid;
    grid-template-columns: repeat(var(--cols-narrow), 1fr);
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    overflow: hidden;
    margin: 0;
  }
  @media (min-width: 560px) {
    .stats { grid-template-columns: repeat(var(--n), 1fr); }
  }
  .stats div { background: var(--surface); padding: 0.7rem 0.9rem; }
  .stats dt { font-size: 0.8rem; color: var(--ink-2); font-weight: 600; }
  .stats dd {
    margin: 0.15rem 0 0;
    font-size: 1.9rem;
    font-weight: 760;
    font-stretch: 65%;
    line-height: 1;
  }
  .stats small { font-size: 0.95rem; font-weight: 600; margin-left: 0.15rem; color: var(--ink-2); font-stretch: 100%; }

  .team { margin: 1.25rem 0 0; display: grid; gap: 0.5rem; }
  .team div { display: grid; grid-template-columns: 5rem 1fr; gap: 0.75rem; }
  .team dt { color: var(--ink-2); font-weight: 600; font-size: 0.9rem; padding-top: 0.1rem; }
  .team dd { margin: 0; }

  section { margin-top: 2.25rem; }
  section > h2, .sec-head h2 { margin-bottom: 0.75rem; }
  .sec-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .sec-head h2 { margin: 0; }
  figure { margin: 0 0 1.5rem; }
  figcaption {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.5rem;
    font-weight: 600;
  }
</style>
