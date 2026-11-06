<script>
  // Read-only view for family and buddies, opened from a share link.
  import { route } from "../lib/router.svelte.js";
  import DiveRows from "./DiveRows.svelte";
  import DiveDetail from "./DiveDetail.svelte";
  import MapScreen from "./MapScreen.svelte";
  import TourPage from "./TourPage.svelte";

  let { token } = $props();

  let data = $state(null);
  let error = $state("");

  $effect(() => {
    const t = token;
    data = null;
    error = "";
    fetch(`/api/share/${encodeURIComponent(t)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || "This link doesn't work.");
        data = body;
        document.title = body.label;
      })
      .catch((e) => (error = navigator.onLine ? e.message : "You're offline. Open this link again with a connection."));
  });

  const base = $derived(`/s/${token}`);
  const tripFilter = $derived(route.params.trip);
  const dives = $derived(data ? data.dives.filter((d) => !tripFilter || d.trip === tripFilter) : []);
  const dive = $derived(data?.dives.find((d) => d.id === route.params.dive));
  const maps = $derived(data?.maps.filter((m) => m.dive === route.params.dive) || []);
  const photos = $derived(data?.photos.filter((p) => p.dive === route.params.dive) || []);
  const map = $derived(maps.find((m) => m.id === route.params.map));

  function fileUrl(rec, thumb) {
    if (!rec?.image) return "";
    const url = `/api/files/${rec.collectionName}/${rec.id}/${encodeURIComponent(rec.image)}`;
    return thumb ? `${url}?thumb=${thumb}` : url;
  }
</script>

{#if error}
  <main class="wrap msg">
    <h1>Link unavailable</h1>
    <p>{error}</p>
    <p class="muted">Ask the person who sent it for a new link.</p>
  </main>
{:else if !data}
  <p class="wrap muted msg">Loading…</p>
{:else if route.name === "tour" && dive}
  <TourPage {dive} {maps} {photos} {fileUrl} backHref={`#${base}/dive/${dive.id}`} />
{:else if route.name === "map" && map}
  {#key map.id}
    <MapScreen
      {map}
      {dive}
      {maps}
      src={fileUrl(map)}
      backHref={`#${base}/dive/${dive.id}`}
      mapHref={(m) => `#${base}/dive/${dive.id}/map/${m.id}`}
      {photos}
      {fileUrl}
      tourHref={`#${base}/dive/${dive.id}/tour`}
      focusMarker={route.query.m || ""}
    />
  {/key}
{:else if route.name === "dive" && dive}
  <header class="bar">
    <div class="wrap row">
      <a class="back" href={`#${base}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {data.label}
      </a>
    </div>
  </header>
  <DiveDetail {dive} {maps} {photos} {base} {fileUrl} />
{:else}
  <header class="bar"><div class="wrap row"><span class="brand">Dive diary</span><span class="muted small">Read-only</span></div></header>
  <main class="wrap">
    <h1 class="head">{tripFilter || data.label}</h1>
    {#if tripFilter}<a href={`#${base}`} class="muted">Show all shared dives</a>{/if}
    {#if dives.length}
      <DiveRows {dives} {base} maps={data.maps} photos={data.photos} />
    {:else}
      <p class="muted">No dives here yet.</p>
    {/if}
  </main>
{/if}

<style>
  .msg { padding-top: 4rem; }
  main { padding-bottom: 4rem; }
  .head { margin: 1.5rem 0 0.25rem; }
  .bar {
    position: sticky;
    top: 0;
    z-index: 1000;
    background: color-mix(in srgb, var(--paper) 88%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--rule);
    padding-top: env(safe-area-inset-top);
  }
  .row { display: flex; align-items: center; justify-content: space-between; min-height: 56px; }
  .brand { font-weight: 780; font-stretch: 72%; font-size: 1.3rem; }
  .back { display: inline-flex; align-items: center; gap: 0.2rem; text-decoration: none; font-weight: 600; min-height: 44px; }
</style>
