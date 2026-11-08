<script>
  // Zoomable map photo with line-arrow markers and route lines (Leaflet, CRS.Simple).
  // All positions are normalized: {x, y} in 0..1 from the image's top-left,
  // so they don't depend on the image resolution.
  import { onMount, untrack } from "svelte";
  import L from "leaflet";
  import { segmentColorValue, escapeHtml } from "../lib/mapstyle.js";

  let {
    src,
    previewSrc = "", // lighter image shown until the full map has loaded
    width,
    height,
    markers = [],
    route = [],
    mode = "view", // "view" | "marker" | "route"
    selectedMarker = null,
    activeSeg = 0,
    focus = null, // { id, n } — bump n to pan to marker id
    onMapTap = () => {},
    onMarkerTap = () => {},
    onMarkerMove = () => {},
    onPointMove = () => {},
    onSegmentTap = () => {},
  } = $props();

  let el;
  let map = $state.raw(null);
  let layer;
  let failed = $state(false);
  let lowRes = $state(false);

  const W = $derived(width || 1000);
  const H = $derived(height || 1000);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const toLL = (p) => L.latLng(H * (1 - p.y), W * p.x);
  const fromLL = (ll) => ({ x: +clamp(ll.lng / W).toFixed(5), y: +clamp(1 - ll.lat / H).toFixed(5) });

  onMount(() => {
    const bounds = L.latLngBounds([0, 0], [H, W]);
    const m = L.map(el, {
      crs: L.CRS.Simple,
      minZoom: -10,
      maxZoom: 4,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      attributionControl: false,
      zoomControl: false,
      bounceAtZoomLimits: false,
    });
    if (!L.Browser.mobile) L.control.zoom({ position: "bottomright" }).addTo(m);
    // Start with the light preview, swap in the full map once it's downloaded.
    let showingFull = !previewSrc || previewSrc === src;
    const overlay = L.imageOverlay(showingFull ? src : previewSrc, bounds).addTo(m);
    overlay.on("error", () => {
      if (!showingFull) {
        showingFull = true; // no preview here: go straight to the full map
        overlay.setUrl(src);
      } else {
        failed = true;
      }
    });
    if (!showingFull) {
      const full = new Image();
      full.onload = () => {
        showingFull = true;
        lowRes = false;
        overlay.setUrl(src);
      };
      full.onerror = () => (lowRes = true);
      full.src = src;
    }
    m.fitBounds(bounds, { padding: [12, 12] });
    m.setMinZoom(m.getZoom() - 1);
    m.setMaxBounds(bounds.pad(0.3));
    layer = L.layerGroup().addTo(m);
    m.on("click", (e) => {
      const ll = e.latlng;
      if (ll.lng < 0 || ll.lng > W || ll.lat < 0 || ll.lat > H) return; // outside the image
      onMapTap(fromLL(ll));
    });

    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el);
    map = m;
    return () => {
      ro.disconnect();
      m.remove();
    };
  });

  $effect(() => {
    if (!map) return;
    // Taps add things in edit modes, so double-tap zoom only in view mode.
    if (mode === "view") map.doubleClickZoom.enable();
    else map.doubleClickZoom.disable();
    el.dataset.mode = mode;
  });

  $effect(() => {
    // track deep changes of the arrays
    const ms = JSON.parse(JSON.stringify(markers || []));
    const rt = JSON.parse(JSON.stringify(route || []));
    const md = mode;
    const sel = selectedMarker;
    const act = activeSeg;
    if (!map) return;
    draw(ms, rt, md, sel, act);
  });

  function draw(ms, rt, md, sel, act) {
    layer.clearLayers();
    const halo = getComputedStyle(document.documentElement).getPropertyValue("--halo").trim() || "rgba(0,0,0,.5)";

    rt.forEach((seg, i) => {
      const lls = seg.map(toLL);
      const editing = md === "route";
      if (lls.length > 1) {
        L.polyline(lls, { color: halo, weight: 8, opacity: 1, interactive: false, lineJoin: "round" }).addTo(layer);
        const line = L.polyline(lls, {
          color: segmentColorValue(i),
          weight: 4,
          opacity: editing && i !== act ? 0.55 : 1,
          dashArray: editing && i !== act ? "6 8" : null,
          lineJoin: "round",
          interactive: editing,
          bubblingMouseEvents: false,
        }).addTo(layer);
        if (editing) line.on("click", () => onSegmentTap(i));
      }
      if (editing && i === act) {
        seg.forEach((p, j) => {
          const v = L.marker(toLL(p), {
            icon: L.divIcon({ className: "vertex" + (j === seg.length - 1 ? " last" : ""), iconSize: [24, 24] }),
            draggable: true,
            keyboard: false,
            zIndexOffset: 500,
          }).addTo(layer);
          v.on("dragend", (e) => onPointMove(i, j, fromLL(e.target.getLatLng())));
        });
      }
    });

    for (const m of ms) {
      const mk = L.marker(toLL(m), {
        icon: L.divIcon({
          className: "line-arrow" + (m.id === sel ? " selected" : "") + (m.photos?.length ? " has-photos" : ""),
          html: `<span>${escapeHtml((m.label || "").slice(0, 4))}</span>`,
          iconSize: [30, 38],
          iconAnchor: [15, 38],
        }),
        draggable: md === "marker",
        title: (m.label || "") + (m.note ? ` — ${m.note}` : ""),
        alt: m.label || "Marker",
        riseOnHover: true,
        zIndexOffset: m.id === sel ? 1000 : 0,
        bubblingMouseEvents: false,
      }).addTo(layer);
      mk.on("click", () => onMarkerTap(m));
      mk.on("dragend", (e) => onMarkerMove(m.id, fromLL(e.target.getLatLng())));
    }
  }

  // Fly only when `focus` changes, not when markers are edited afterwards.
  $effect(() => {
    if (!map || !focus) return;
    const id = focus.id;
    untrack(() => {
      const m = (markers || []).find((x) => x.id === id);
      if (m) map.flyTo(toLL(m), Math.max(map.getZoom(), map.getMinZoom() + 2), { duration: 0.4 });
    });
  });
</script>

<div class="canvas" bind:this={el}></div>
{#if lowRes && !failed}
  <p class="lowres">Showing a lighter version of this map. The full one isn't available offline.</p>
{/if}
{#if failed}
  <p class="failed">This map image isn't available offline yet. Open it once with a connection and it will be kept on this device.</p>
{/if}

<style>
  .canvas {
    position: absolute;
    inset: 0;
  }
  .canvas:global([data-mode="marker"]),
  .canvas:global([data-mode="route"]) {
    cursor: crosshair;
  }
  .lowres {
    position: absolute;
    top: calc(env(safe-area-inset-top) + 62px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 500;
    margin: 0;
    max-width: calc(100% - 24px);
    padding: 0.3rem 0.75rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    border: 1px solid var(--rule);
    font-size: 0.85rem;
    text-align: center;
  }
  .failed {
    position: absolute;
    inset: 40% 1rem auto;
    z-index: 500;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    padding: 1rem;
    margin: 0;
  }
</style>
