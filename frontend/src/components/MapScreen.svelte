<script>
  import { untrack } from "svelte";
  import MapCanvas from "./MapCanvas.svelte";
  import PhotoGrid from "./PhotoGrid.svelte";
  import { segmentColor } from "../lib/mapstyle.js";

  /**
   * @type {{
   *   map: any, dive: any, src: string, maps?: any[], owner?: boolean,
   *   backHref: string, mapHref: (m: any) => string,
   *   onSave?: (patch: any) => void, onDelete?: () => void,
   *   photos?: any[], fileUrl?: (r: any, thumb?: string) => string,
   *   onUploadPhoto?: (file: File) => Promise<any>, tourHref?: string
   * }}
   */
  let { map, dive, src, maps = [], owner = false, backHref, mapHref, onSave, onDelete, photos = [], fileUrl = () => "", onUploadPhoto, tourHref = "", focusMarker = "" } = $props();

  // Working copies, taken once per map (the parent re-mounts on map change);
  // edits are written back through onSave (debounced).
  const initial = untrack(() => $state.snapshot(map));
  let markers = $state(Array.isArray(initial.markers) ? initial.markers : []);
  let route = $state(Array.isArray(initial.route) ? initial.route : []);
  let caption = $state(initial.caption || "");

  let mode = $state("view");
  let selectedId = $state(null);
  let sheet = $state(null); // "marker" | "list" | null
  let activeSeg = $state(Math.max(0, route.length - 1));
  let focus = $state(null);

  // Opened from a "#T1" link: select that marker and fly to it.
  $effect(() => {
    const id = focusMarker;
    if (!id) return;
    untrack(() => {
      if (!markers.some((m) => m.id === id)) return;
      mode = "view";
      selectedId = id;
      sheet = "marker";
      focus = { id, n: (focus?.n || 0) + 1 };
    });
  });

  const selected = $derived(markers.find((m) => m.id === selectedId) || null);
  const index = $derived(maps.findIndex((m) => m.id === map.id));
  const sorted = $derived([...markers].sort((a, b) => (a.label || "").localeCompare(b.label || "", undefined, { numeric: true })));
  const hasRoute = $derived(route.some((s) => s.length > 0));
  const selectedPhotos = $derived(selected ? photos.filter((p) => (selected.photos || []).includes(p.id)) : []);
  let uploading = $state(false);

  function togglePhoto(id) {
    if (!selected) return;
    const list = selected.photos || [];
    selected.photos = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    persist();
  }

  async function uploadPhotos(e) {
    const files = [...(e.currentTarget.files || [])];
    e.currentTarget.value = "";
    if (!files.length || !selected || !onUploadPhoto) return;
    const target = selected;
    uploading = true;
    try {
      for (const f of files) {
        const rec = await onUploadPhoto(f);
        if (rec) target.photos = [...(target.photos || []), rec.id];
      }
      persist();
    } catch (err) {
      alert(err.message);
    } finally {
      uploading = false;
    }
  }

  let timer;
  function persist() {
    if (!owner) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 400);
  }
  function flush() {
    clearTimeout(timer);
    onSave?.({
      markers: $state.snapshot(markers),
      route: $state.snapshot(route).filter((s) => s.length > 0),
      caption: caption.trim(),
    });
  }

  function newMarkerId() {
    return Math.random().toString(36).slice(2, 10);
  }
  function nextLabel() {
    const nums = markers.map((m) => parseInt(m.label, 10)).filter((n) => !Number.isNaN(n));
    return String(nums.length ? Math.max(...nums) + 1 : markers.length + 1);
  }

  function setMode(m) {
    mode = m;
    sheet = null;
    selectedId = null;
    if (m === "route" && route.length === 0) {
      route.push([]);
      activeSeg = 0;
    }
  }

  // ---------- taps from the canvas ----------

  function onMapTap(pt) {
    if (mode === "marker") {
      const m = { id: newMarkerId(), x: pt.x, y: pt.y, label: nextLabel(), note: "" };
      markers.push(m);
      selectedId = m.id;
      sheet = "marker";
      persist();
    } else if (mode === "route") {
      addPoint(pt);
    } else {
      selectedId = null;
      if (sheet === "marker") sheet = null;
    }
  }

  function onMarkerTap(m) {
    if (mode === "route") {
      addPoint({ x: m.x, y: m.y }); // snap the route through decision points
      return;
    }
    selectedId = m.id;
    sheet = "marker";
  }

  function onMarkerMove(id, pt) {
    const m = markers.find((x) => x.id === id);
    if (!m) return;
    m.x = pt.x;
    m.y = pt.y;
    persist();
  }

  function addPoint(pt) {
    if (!route[activeSeg]) {
      route.push([]);
      activeSeg = route.length - 1;
    }
    route[activeSeg].push(pt);
    persist();
  }

  function onPointMove(seg, idx, pt) {
    route[seg][idx] = pt;
    persist();
  }

  // ---------- route tools ----------

  function undoPoint() {
    route[activeSeg]?.pop();
    persist();
  }
  function newLine() {
    if (route[activeSeg]?.length === 0) return;
    route.push([]);
    activeSeg = route.length - 1;
  }
  function deleteLine() {
    if (!route[activeSeg]?.length) return;
    if (!confirm("Delete this route line?")) return;
    route.splice(activeSeg, 1);
    if (route.length === 0) route.push([]);
    activeSeg = Math.min(activeSeg, route.length - 1);
    persist();
  }

  // ---------- marker sheet ----------

  function deleteMarker() {
    const i = markers.findIndex((m) => m.id === selectedId);
    if (i >= 0) markers.splice(i, 1);
    selectedId = null;
    sheet = null;
    persist();
  }

  function closeSheet() {
    sheet = null;
    if (mode !== "marker") selectedId = null;
  }

  function goTo(m) {
    selectedId = m.id;
    sheet = "marker";
    focus = { id: m.id, n: (focus?.n || 0) + 1 };
  }

  function onKey(e) {
    if (e.key === "Escape" && sheet) closeSheet();
  }

  function remove() {
    if (confirm("Delete this map with its markers and route?")) {
      clearTimeout(timer);
      onDelete?.();
    }
  }

  $effect(() => () => {
    // flush pending edits when leaving the screen
    if (timer) flush();
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="screen">
  <MapCanvas
    {src}
    width={map.width}
    height={map.height}
    {markers}
    {route}
    {mode}
    selectedMarker={selectedId}
    {activeSeg}
    {focus}
    {onMapTap}
    {onMarkerTap}
    {onMarkerMove}
    {onPointMove}
    onSegmentTap={(i) => (activeSeg = i)}
  />

  <header class="top">
    <a class="pill back" href={backHref} aria-label="Back to dive">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>{dive?.site || "Dive"}</span>
    </a>
    <div class="title pill">
      {#if owner && mode !== "view"}
        <input aria-label="Map caption" placeholder="Map caption" bind:value={caption} oninput={persist} />
      {:else}
        <span>{caption || "Untitled map"}</span>
      {/if}
      {#if maps.length > 1}
        <nav class="pager" aria-label="Other maps">
          <a href={mapHref(maps[(index - 1 + maps.length) % maps.length])} aria-label="Previous map">‹</a>
          <span>{index + 1}/{maps.length}</span>
          <a href={mapHref(maps[(index + 1) % maps.length])} aria-label="Next map">›</a>
        </nav>
      {/if}
    </div>
  </header>

  {#if sheet === "marker" && selected}
    <div class="sheet" class:raised={mode === "marker"} role="dialog" aria-label="Marker">
      {#if owner && mode === "marker"}
        <div class="sheet-row">
          <label class="field label-in">Label
            <input bind:value={selected.label} oninput={persist} maxlength="4" />
          </label>
          <label class="field grow">Note
            <input bind:value={selected.note} oninput={persist} placeholder="e.g. T: go left, cookie placed" />
          </label>
        </div>
        <div class="attach">
          <span class="attach-label">Photos at this marker</span>
          <div class="strip">
            {#each photos as p (p.id)}
              <button class="thumb" aria-pressed={(selected.photos || []).includes(p.id)} onclick={() => togglePhoto(p.id)} aria-label={`${(selected.photos || []).includes(p.id) ? "Remove" : "Show"} photo${p.caption ? `: ${p.caption}` : ""}`}>
                <img src={fileUrl(p, "480x480f")} alt="" />
              </button>
            {/each}
            {#if onUploadPhoto}
              <label class="thumb add" aria-label="Upload photos to this marker">
                {uploading ? "…" : "+"}
                <input type="file" accept="image/*" multiple hidden onchange={uploadPhotos} disabled={uploading} />
              </label>
            {/if}
          </div>
          {#if photos.length}<span class="muted small">Tap a dive photo to show it here. It pops up when someone follows the route.</span>{/if}
        </div>
        <div class="sheet-actions">
          <button class="btn-danger" onclick={deleteMarker}>Delete marker</button>
          <span class="muted small">Drag the marker to move it</span>
          <button onclick={closeSheet}>Done</button>
        </div>
      {:else}
        <div class="read">
          <span class="arrow"><span>{selected.label}</span></span>
          <p>{selected.note || (selectedPhotos.length ? "" : "No note")}</p>
        </div>
        {#if selectedPhotos.length}
          <PhotoGrid photos={selectedPhotos} {fileUrl} />
        {/if}
        <div class="sheet-actions">
          {#if owner}<button onclick={() => { mode = "marker"; }}>Edit</button>{:else}<span></span>{/if}
          <button onclick={closeSheet}>Close</button>
        </div>
      {/if}
    </div>
  {:else if sheet === "list"}
    <div class="sheet list" role="dialog" aria-label="Markers">
      <div class="sheet-actions head">
        <h2>Markers</h2>
        <button onclick={closeSheet}>Close</button>
      </div>
      <ol>
        {#each sorted as m (m.id)}
          <li>
            <button onclick={() => goTo(m)}>
              <span class="arrow"><span>{m.label}</span></span>
              <span class="note">{m.note || "No note"}</span>
            </button>
          </li>
        {/each}
      </ol>
    </div>
  {/if}

  <footer class="tools" hidden={!!sheet && mode !== "marker"}>
    {#if mode === "route"}
      <div class="route-tools">
        <span class="swatch" style:background={segmentColor(activeSeg)} title="Current line"></span>
        <button onclick={undoPoint} disabled={!route[activeSeg]?.length}>Undo point</button>
        <button onclick={newLine} disabled={!route[activeSeg]?.length}>New line</button>
        <button class="btn-danger" onclick={deleteLine} disabled={!route[activeSeg]?.length}>Delete line</button>
      </div>
      <p class="hint">Tap the map to extend the line. Tap a marker to route through it. Drag a point to move it.</p>
    {:else if mode === "marker" && sheet !== "marker"}
      <p class="hint">Tap the map to drop a marker. Tap a marker to edit it.</p>
    {/if}

    <div class="modes">
      {#if owner}
        <div class="seg" role="radiogroup" aria-label="Map mode">
          <button role="radio" aria-checked={mode === "view"} onclick={() => setMode("view")}>View</button>
          <button role="radio" aria-checked={mode === "marker"} onclick={() => setMode("marker")}>Markers</button>
          <button role="radio" aria-checked={mode === "route"} onclick={() => setMode("route")}>Route</button>
        </div>
      {/if}
      {#if tourHref && mode === "view" && hasRoute}
        <a class="pill btn follow" href={tourHref}>Follow the route</a>
      {/if}
      {#if markers.length && mode === "view"}
        <button class="pill" onclick={() => (sheet = sheet === "list" ? null : "list")}>List ({markers.length})</button>
      {/if}
      {#if owner && mode === "view"}
        <button class="pill danger" onclick={remove} aria-label="Delete map">Delete</button>
      {/if}
    </div>
    {#if !owner && !markers.length && !hasRoute}
      <p class="hint">No markers on this map.</p>
    {/if}
  </footer>
</div>

<style>
  .screen {
    position: fixed;
    inset: 0;
    background: var(--paper);
    overflow: hidden;
  }
  .top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    display: flex;
    gap: 0.5rem;
    padding: calc(env(safe-area-inset-top) + 8px) 8px 0;
    pointer-events: none;
  }
  .top > * { pointer-events: auto; }
  .pill {
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid var(--rule);
    border-radius: 999px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
    min-height: 44px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0 0.85rem 0 0.55rem;
    text-decoration: none;
    font-weight: 600;
    max-width: 40%;
    flex-shrink: 0;
  }
  .back span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.4rem 0 0.9rem;
    font-weight: 700;
  }
  .title > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .title input {
    flex: 1;
    min-width: 0;
    min-height: 36px;
    border: none;
    background: transparent;
    padding: 0;
    font-weight: 700;
  }
  .pager { display: flex; align-items: center; gap: 0.1rem; flex-shrink: 0; font-size: 0.85rem; color: var(--ink-2); }
  .pager a { text-decoration: none; font-size: 1.5rem; width: 32px; text-align: center; color: var(--ink); line-height: 1; }

  .tools {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    padding: 0 8px calc(env(safe-area-inset-bottom) + 10px);
    display: grid;
    gap: 0.5rem;
    justify-items: center;
    pointer-events: none;
  }
  .tools > * { pointer-events: auto; }
  .tools[hidden] { display: none; }
  .modes { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center; }
  .modes .pill { padding: 0 1rem; }
  .danger { color: var(--danger); }
  .seg {
    display: inline-flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--ink);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
  }
  .seg button {
    border: none;
    background: transparent;
    color: var(--paper);
    min-height: 40px;
    padding: 0 1rem;
  }
  .seg button[aria-checked="true"] { background: var(--accent); color: #fff; }
  .route-tools {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
  }
  .route-tools button { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12); }
  .route-tools .btn-danger { background: var(--surface); }
  .swatch { width: 22px; height: 22px; border-radius: 50%; border: 3px solid var(--surface); box-shadow: 0 0 0 1px var(--rule); }
  .hint {
    margin: 0;
    font-size: 0.85rem;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    padding: 0.3rem 0.75rem;
    border-radius: 999px;
    text-align: center;
    max-width: 100%;
  }

  .sheet {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: calc(env(safe-area-inset-bottom) + 12px);
    z-index: 1100;
    max-width: 560px;
    margin: 0 auto;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    padding: 0.9rem;
    display: grid;
    gap: 0.75rem;
  }
  .sheet.raised { bottom: calc(env(safe-area-inset-bottom) + 66px); }
  .sheet-row { display: flex; gap: 0.6rem; }
  .label-in { width: 5.5rem; flex-shrink: 0; }
  .grow { flex: 1; }
  .sheet-actions { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .sheet-actions.head h2 { font-size: 1.2rem; }
  .read { display: flex; gap: 0.8rem; align-items: start; }
  .read p { margin: 0.3rem 0 0; font-family: var(--font-log); font-size: 1.05rem; line-height: 1.5; }
  .arrow { flex-shrink: 0; filter: drop-shadow(0 1px 1.5px var(--halo)); }
  .arrow span {
    display: grid;
    place-items: start center;
    width: 30px;
    height: 38px;
    padding-top: 6px;
    background: var(--accent);
    color: #fff;
    clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
    font: 760 13px/1 var(--font-ui);
    font-stretch: 70%;
  }
  .list { max-height: 55vh; overflow: auto; }
  .sheet { max-height: calc(100dvh - 140px); overflow: auto; }
  .attach { display: grid; gap: 0.4rem; }
  .attach-label { font-size: 0.9rem; font-weight: 600; color: var(--ink-2); }
  .strip { display: flex; gap: 6px; overflow-x: auto; padding: 3px; }
  .thumb {
    all: unset;
    cursor: pointer;
    flex-shrink: 0;
    width: 56px;
    height: 56px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--rule);
    opacity: 0.45;
    display: grid;
    place-items: center;
    font-size: 1.5rem;
    font-weight: 600;
    box-sizing: border-box;
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb[aria-pressed="true"] { opacity: 1; outline: 3px solid var(--accent); outline-offset: -3px; }
  .thumb:focus-visible { outline: 3px solid var(--ink); }
  .thumb.add { opacity: 1; border: 1.5px dashed var(--ink-2); background: transparent; color: var(--ink-2); }
  .follow { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 700; display: inline-flex; align-items: center; text-decoration: none; }
  .list ol { list-style: none; margin: 0; padding: 0; }
  .list li + li { border-top: 1px solid var(--rule); }
  .list li button {
    all: unset;
    cursor: pointer;
    display: flex;
    gap: 0.8rem;
    align-items: center;
    width: 100%;
    padding: 0.5rem 0.25rem;
    box-sizing: border-box;
  }
  .list li button:focus-visible { outline: 3px solid var(--accent); }
  .note { font-family: var(--font-log); }
</style>
