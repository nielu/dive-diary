<script>
  import { app, fileUrl, saveMap, deleteRecord, addPhoto } from "../lib/app.svelte.js";
  import { preparePhoto } from "../lib/image.js";
  import { go } from "../lib/router.svelte.js";
  import MapScreen from "./MapScreen.svelte";

  let { diveId, mapId, focusMarker = "" } = $props();

  const dive = $derived(app.dives.find((d) => d.id === diveId));
  const maps = $derived(app.maps.filter((m) => m.dive === diveId));
  const map = $derived(maps.find((m) => m.id === mapId));
  const photos = $derived(app.photos.filter((p) => p.dive === diveId));

  async function onUploadPhoto(file) {
    return addPhoto(diveId, await preparePhoto(file));
  }

  function onSave(patch) {
    const latest = app.maps.find((m) => m.id === mapId);
    if (latest) saveMap({ ...latest, ...patch });
  }

  async function onDelete() {
    await deleteRecord("maps", mapId);
    go(`/dive/${diveId}`);
  }
</script>

{#if map}
  {#key mapId}
    <MapScreen
      {map}
      {dive}
      {maps}
      src={fileUrl(map)}
      owner
      backHref={`#/dive/${diveId}`}
      mapHref={(m) => `#/dive/${diveId}/map/${m.id}`}
      {onSave}
      {onDelete}
      {photos}
      {fileUrl}
      {onUploadPhoto}
      tourHref={`#/dive/${diveId}/tour`}
      {focusMarker}
    />
  {/key}
{:else}
  <main class="wrap" style="padding-top:2rem">
    <p>This map doesn't exist on this device.</p>
    <a class="btn" href={`#/dive/${diveId}`}>Back to the dive</a>
  </main>
{/if}
