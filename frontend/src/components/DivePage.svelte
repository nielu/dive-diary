<script>
  import { app, fileUrl, addMap, saveDive } from "../lib/app.svelte.js";
  import { prepareMap } from "../lib/image.js";
  import { addMedia } from "../lib/media.js";
  import { readDiveFile } from "../lib/fitimport.js";
  import { applyImport } from "../lib/importmatch.js";
  import { formatDate } from "../lib/format.js";
  import TopBar from "./TopBar.svelte";
  import DiveDetail from "./DiveDetail.svelte";

  let { id } = $props();

  const dive = $derived(app.dives.find((d) => d.id === id));
  const maps = $derived(app.maps.filter((m) => m.dive === id));
  const photos = $derived(app.photos.filter((p) => p.dive === id));
  let busy = $state("");
  let progress = $state("");
  let error = $state("");
  let notice = $state("");

  async function onAddMaps(files) {
    busy = "maps";
    error = "";
    try {
      for (const f of files) {
        const prepared = await prepareMap(f);
        await addMap(id, prepared, files.length > 1 ? prepared.fileName.replace(/\.jpg$/, "").replace(/_/g, " ") : "");
      }
    } catch (e) {
      error = e.message;
    } finally {
      busy = "";
    }
  }

  async function onImportFile(file) {
    busy = "fit";
    error = "";
    try {
      const imp = await readDiveFile(new Uint8Array(await file.arrayBuffer()), file.name);
      const other = app.dives.find((d) => d.source === imp.source && d.id !== id);
      if (other) {
        error = `That dive is already in your log as ${other.site || "another dive"}.`;
        return;
      }
      const days = Math.abs(new Date(imp.date) - new Date(dive.date)) / 86_400_000;
      if (days >= 1 && !confirm(`This file is from ${formatDate(imp.date, imp.time)}, but this dive is on ${formatDate(dive.date)}. Use it anyway?`)) return;
      await saveDive(applyImport(dive, imp));
    } catch (e) {
      error = e.message;
    } finally {
      busy = "";
    }
  }

  async function onAddPhotos(files) {
    busy = "photos";
    error = "";
    notice = "";
    try {
      const { notes } = await addMedia(id, files, { onStatus: (s) => (progress = s) });
      notice = notes.join(" ");
    } catch (e) {
      error = e.message;
    } finally {
      busy = "";
      progress = "";
    }
  }
</script>

<TopBar backHref={dive?.trip ? `#/trip/${encodeURIComponent(dive.trip)}` : "#/"} backLabel={dive?.trip || "All dives"}>
  {#if dive}<a class="btn" href={`#/dive/${id}/edit`}>Edit</a>{/if}
</TopBar>

{#if dive}
  {#if error}<p class="wrap error" role="alert">{error}</p>{/if}
  {#if notice}<p class="wrap notice" role="status">{notice}</p>{/if}
  {#if !dive.site && !dive.log && !dive.navigation && !maps.length}
    <p class="wrap hint muted">This dive is empty. <a href={`#/dive/${id}/edit`}>Fill in the details</a> or add a map below.</p>
  {/if}
  <DiveDetail {dive} {maps} {photos} owner {fileUrl} {onAddMaps} {onAddPhotos} {onImportFile} {busy} {progress} />
{:else}
  <main class="wrap" style="padding-top:2rem">
    <p>This dive doesn't exist on this device. It may have been deleted.</p>
    <a class="btn" href="#/">All dives</a>
  </main>
{/if}

<style>
  .error { color: var(--danger); margin-top: 1rem; }
  .notice { margin-top: 1rem; color: var(--ink-2); }
  .hint { margin-top: 1rem; margin-bottom: -0.5rem; }
</style>
