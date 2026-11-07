<script>
  // Static map preview: the image with markers and route drawn as SVG on top.
  // No Leaflet here, so it never fights page scrolling on a phone.
  import { segmentColor } from "../lib/mapstyle.js";

  let { map, src, href } = $props();

  const w = $derived(map.width || 1000);
  const h = $derived(map.height || 1000);
  const markers = $derived(Array.isArray(map.markers) ? map.markers : []);
  const route = $derived(Array.isArray(map.route) ? map.route : []);
  // marker size relative to the image so it looks the same at any resolution
  const s = $derived(Math.max(w, h) / 28);
</script>

<a class="preview" {href} aria-label={`Open map${map.caption ? `: ${map.caption}` : ""}`}>
  <div class="frame" style:aspect-ratio={`${w} / ${h}`} style:width={`min(100%, calc(70vh * ${w} / ${h}))`}>
    <img {src} alt={map.caption || "Cave map"} loading="lazy" />
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {#each route as seg, i}
        {#if seg.length > 1}
          {@const pts = seg.map((p) => `${p.x * w},${p.y * h}`).join(" ")}
          <polyline points={pts} fill="none" style:stroke="var(--halo)" stroke-width={s * 0.32} stroke-linejoin="round" stroke-linecap="round" />
          <polyline points={pts} fill="none" style:stroke={segmentColor(i)} stroke-width={s * 0.17} stroke-linejoin="round" stroke-linecap="round" />
        {/if}
      {/each}
      {#each markers as m (m.id)}
        <g transform={`translate(${m.x * w} ${m.y * h})`}>
          <path
            d={`M${-s * 0.5} ${-s * 1.27} H${s * 0.5} V${-s * 0.51} L0 0 L${-s * 0.5} ${-s * 0.51} Z`}
            style:fill="var(--accent)"
            style:stroke="var(--halo)"
            stroke-width={s * 0.05}
          />
          <text y={-s * 0.78} text-anchor="middle" font-size={s * 0.45} font-weight="760" style:fill="var(--accent-ink)" style="font-stretch:70%">{(m.label || "").slice(0, 3)}</text>
        </g>
      {/each}
    </svg>
  </div>
</a>

<style>
  .preview { display: block; text-decoration: none; }
  .frame {
    position: relative;
    margin: 0 auto;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    overflow: hidden;
  }
  img, svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  img { object-fit: fill; }
  text { font-family: var(--font-ui); }
</style>
