<script>
  import { app, fileUrl } from "../lib/app.svelte.js";
  import TourPage from "./TourPage.svelte";

  let { diveId } = $props();
  const dive = $derived(app.dives.find((d) => d.id === diveId));
  const maps = $derived(app.maps.filter((m) => m.dive === diveId));
  const photos = $derived(app.photos.filter((p) => p.dive === diveId));
</script>

{#if dive}
  <TourPage {dive} {maps} {photos} {fileUrl} backHref={`#/dive/${diveId}`} />
{:else}
  <main class="wrap" style="padding-top:2rem"><p>This dive doesn't exist on this device.</p><a class="btn" href="#/">All dives</a></main>
{/if}
