<script>
  // "Follow the route": a scroll-driven walk along the drawn route.
  // The map sits fixed in the background; scrolling moves the diver along the
  // route, the camera follows, and each waypoint's card (note + photos)
  // scrolls into view while the diver waits at it.
  import { onMount, tick } from "svelte";
  import { buildChapter, buildTimeline, stateAt, pointAt, pathUpTo } from "../lib/tour.js";
  import { formatNum, formatDate } from "../lib/format.js";
  import Markdown from "./Markdown.svelte";
  import PhotoGrid from "./PhotoGrid.svelte";
  import { markerIndex } from "../lib/refs.js";

  /** @type {{ dive: any, maps: any[], photos: any[], fileUrl: (r: any, thumb?: string) => string, backHref: string }} */
  let { dive, maps, photos, fileUrl, backHref } = $props();

  const refs = $derived(markerIndex(maps));
  // backHref is the dive page, so map links hang off it
  const refHref = (r) => `${backHref}/map/${r.mapId}?m=${r.markerId}`;

  /** "#T1" in the plan or log: scroll to that waypoint if the route passes it. */
  function onRef(ref, e) {
    const i = blocks.findIndex(
      (b) => b.kind === "stop" && chapters[b.chapter].stops[b.stop].marker.id === ref.markerId,
    );
    if (i < 0 || !layout[i]) return; // not on the route: follow the link to the map
    e.preventDefault();
    const top = layout[i].top + layout[i].height / 2 - vh / 2;
    window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }

  const chapters = $derived(maps.map((m) => buildChapter(m)).filter((c) => c.total > 0));
  const multi = $derived(chapters.length > 1);
  const photoById = $derived(new Map(photos.map((p) => [p.id, p])));
  const stopPhotos = (stop) => (stop.marker.photos || []).map((id) => photoById.get(id)).filter(Boolean);
  const gallery = $derived.by(() => {
    const shown = new Set(chapters.flatMap((c) => c.stops.flatMap((s) => s.marker.photos || [])));
    return photos.filter((p) => !shown.has(p.id));
  });
  const totalLength = $derived(chapters.reduce((a, c) => a + c.total, 0));
  const stops = $derived(chapters.reduce((a, c) => a + c.stops.length, 0));

  const stats = $derived(
    [
      { label: "Max depth", value: dive.max_depth, unit: "m" },
      { label: "Avg depth", value: dive.avg_depth, unit: "m" },
      { label: "Water", value: dive.temp, unit: "°C" },
      { label: "Run time", value: dive.duration, unit: "min" },
    ].filter((s) => Number(s.value)),
  );

  // ---------- viewport ----------

  let vw = $state(window.innerWidth);
  let vh = $state(window.innerHeight);
  let scrollY = $state(0);
  const desktop = $derived(vw >= 900);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Where the map is visible (cards cover the rest), and where the diver sits.
  const area = $derived(desktop ? { x: vw * 0.42, y: 0, w: vw * 0.58, h: vh } : { x: 0, y: 56, w: vw, h: vh * 0.44 });
  const followAnchor = $derived(desktop ? { x: vw * 0.71, y: vh * 0.5 } : { x: vw / 2, y: vh * 0.27 });

  const blocks = $derived(buildTimeline(chapters, vh));
  let sections = $state([]);
  let layout = $state([]); // measured {top, height} per block

  function measure() {
    layout = sections.map((el) => (el ? { top: el.offsetTop, height: el.offsetHeight } : { top: 0, height: 0 }));
  }
  const laidOut = $derived(blocks.map((b, i) => ({ ...b, ...(layout[i] || {}) })));
  const target = $derived(chapters.length ? stateAt(laidOut, chapters, scrollY + vh * 0.5) : null);

  // ---------- camera ----------

  function overviewCam(ch) {
    const bw = ch.bbox.x1 - ch.bbox.x0;
    const bh = ch.bbox.y1 - ch.bbox.y0;
    const s = Math.min(area.w / (bw * 1.25), area.h / (bh * 1.25));
    return { cx: (ch.bbox.x0 + ch.bbox.x1) / 2, cy: (ch.bbox.y0 + ch.bbox.y1) / 2, s, ax: area.x + area.w / 2, ay: area.y + area.h / 2 };
  }

  const targetCam = $derived.by(() => {
    if (!target) return null;
    const ch = chapters[target.chapter];
    const o = overviewCam(ch);
    if (target.view === "overview") return { ...o, chapter: target.chapter };
    const p = pointAt(ch.path, target.d);
    const s = Math.min(Math.max(o.s * 2.6, o.s), 1.25);
    return { cx: p.x, cy: p.y, s, ax: followAnchor.x, ay: followAnchor.y, chapter: target.chapter };
  });

  let cam = $state(null);
  let raf = 0;
  let last = 0;

  function step(now) {
    raf = 0;
    const t = targetCam;
    if (!t) return;
    if (!cam || cam.chapter !== t.chapter || reduced) {
      cam = { ...t };
      return;
    }
    const dt = Math.min(64, now - (last || now));
    last = now;
    const k = 1 - Math.pow(1 - 0.12, dt / 16.7 || 1);
    const lerp = (a, b) => a + (b - a) * k;
    const next = {
      cx: lerp(cam.cx, t.cx),
      cy: lerp(cam.cy, t.cy),
      s: Math.exp(lerp(Math.log(cam.s), Math.log(t.s))),
      ax: lerp(cam.ax, t.ax),
      ay: lerp(cam.ay, t.ay),
      chapter: t.chapter,
    };
    const done =
      Math.abs(next.cx - t.cx) * next.s < 0.3 &&
      Math.abs(next.cy - t.cy) * next.s < 0.3 &&
      Math.abs(next.s / t.s - 1) < 0.002 &&
      Math.abs(next.ax - t.ax) < 0.3 &&
      Math.abs(next.ay - t.ay) < 0.3;
    cam = done ? { ...t } : next;
    if (!done) raf = requestAnimationFrame(step);
  }

  $effect(() => {
    targetCam; // re-run when the target moves
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(step);
    }
  });

  // ---------- drawing in screen space ----------

  const sx = (x) => cam.ax + (x - cam.cx) * cam.s;
  const sy = (y) => cam.ay + (y - cam.cy) * cam.s;
  const pts = (line) => line.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");

  const active = $derived(target && cam ? chapters[cam.chapter] : null);
  const fullLines = $derived(active && cam ? pathUpTo(active.path, Infinity).map(pts) : []);
  const doneLines = $derived(active && cam && target ? pathUpTo(active.path, target.d).map(pts) : []);
  const diver = $derived(active && cam && target ? pointAt(active.path, target.d) : null);
  const progress = $derived.by(() => {
    if (!target || !totalLength) return 0;
    const before = chapters.slice(0, target.chapter).reduce((a, c) => a + c.total, 0);
    return Math.min(1, (before + target.d) / totalLength);
  });

  // ---------- lifecycle ----------

  function onScroll() {
    scrollY = window.scrollY;
  }

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // ignore small height changes from mobile browser toolbars
    if (w !== vw || Math.abs(h - vh) > 120) {
      vw = w;
      vh = h;
      tick().then(measure);
    }
  }

  onMount(() => {
    window.scrollTo(0, 0);
    measure();
    const ro = new ResizeObserver(() => measure());
    for (const el of sections) if (el) ro.observe(el);
    // preload every chapter's map
    for (const c of chapters) new Image().src = fileUrl(c.map);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  });

  // Fade cards in as they arrive.
  function reveal(node) {
    if (reduced || !("IntersectionObserver" in window)) {
      node.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) node.classList.add("in");
      },
      { threshold: 0.15 },
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  function restart() {
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }
</script>

<svelte:window onscroll={onScroll} onresize={onResize} />

{#if !chapters.length}
  <main class="wrap empty">
    <h1>No route yet</h1>
    <p class="muted">A route needs to be drawn on one of this dive's maps before it can be followed.</p>
    <a class="btn" href={backHref}>Back to the dive</a>
  </main>
{:else}
  <!-- fixed background: the map and everything drawn on it -->
  <div class="stage" aria-hidden="true">
    {#each chapters as ch, i (ch.map.id)}
      <div
        class="world"
        class:on={cam?.chapter === i}
        style:width={`${ch.W}px`}
        style:height={`${ch.H}px`}
        style:transform={cam && cam.chapter === i ? `translate(${cam.ax - cam.cx * cam.s}px, ${cam.ay - cam.cy * cam.s}px) scale(${cam.s})` : "none"}
      >
        <img src={fileUrl(ch.map)} alt="" draggable="false" />
      </div>
    {/each}

    {#if active && cam}
      <svg class="overlay" width={vw} height={vh}>
        {#each fullLines as p}
          <polyline points={p} class="route-dim" />
        {/each}
        {#each doneLines as p}
          <polyline points={p} class="route-halo" />
          <polyline points={p} class="route-done" />
        {/each}
        {#each active.offRoute as m (m.id)}
          <g transform={`translate(${sx(m.x * active.W)} ${sy(m.y * active.H)}) scale(0.75)`} class="arrow off">
            <path d="M-13 -33 H13 V-13 L0 0 L-13 -13 Z" />
            <text y="-19" text-anchor="middle">{(m.label || "").slice(0, 3)}</text>
          </g>
        {/each}
        {#each active.stops as s, i (s.marker.id)}
          <g
            transform={`translate(${sx(s.x)} ${sy(s.y)})`}
            class="arrow"
            class:passed={target.chapter === cam.chapter && s.d <= target.d + 0.5}
            class:current={target.chapter === cam.chapter && target.stop === i}
          >
            <path d="M-13 -33 H13 V-13 L0 0 L-13 -13 Z" />
            <text y="-19" text-anchor="middle">{(s.marker.label || "").slice(0, 3)}</text>
          </g>
        {/each}
        {#if diver && target.showDiver && target.chapter === cam.chapter}
          <g transform={`translate(${sx(diver.x)} ${sy(diver.y)})`} class="diver">
            <circle r="16" class="pulse" />
            <circle r="9" class="dot" />
          </g>
        {/if}
      </svg>
    {/if}
    <div class="scrim" class:show={target?.block.kind === "intro" || target?.block.kind === "outro"}></div>
  </div>

  <header class="tour-bar">
    <a class="close" href={backHref} aria-label="Close and go back to the dive">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
    </a>
    <span class="where">{dive.site || "Dive"}{multi && target ? `, map ${target.chapter + 1} of ${chapters.length}` : ""}</span>
    <div class="progress" role="progressbar" aria-label="Route progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
      <i style:transform={`scaleX(${progress})`}></i>
    </div>
  </header>

  <!-- scrolling story -->
  <div class="story">
    {#each blocks as b, i (i)}
      <section
        bind:this={sections[i]}
        class={`blk ${b.kind}`}
        style:min-height={b.kind === "outro" ? null : `${b.height}px`}
      >
        {#if b.kind === "intro"}
          <div class="intro">
            <p class="when">{formatDate(dive.date, dive.time)}</p>
            <h1>{dive.site || "Untitled dive"}</h1>
            {#if dive.trip}<span class="trip-tag">{dive.trip}</span>{/if}
            {#if stats.length}
              <dl class="stats">
                {#each stats as s}<div><dt>{s.label}</dt><dd>{formatNum(s.value)}<small>{s.unit}</small></dd></div>{/each}
              </dl>
            {/if}
            {#if dive.leader || dive.team}
              <p class="team">
                {#if dive.leader}Led by {dive.leader}.{/if}
                {#if dive.team}Team: {dive.team}.{/if}
              </p>
            {/if}
            {#if dive.navigation}
              <div class="card plan">
                <h2>The plan</h2>
                <Markdown text={dive.navigation} {refs} hrefFor={refHref} {onRef} />
              </div>
            {/if}
            <p class="hint">Scroll to follow the route{stops ? ` past ${stops} ${stops === 1 ? "waypoint" : "waypoints"}` : ""}.</p>
          </div>
        {:else if b.kind === "chapter"}
          <div class="card chapter-card rv" use:reveal>
            <p class="muted small">Map {b.chapter + 1} of {chapters.length}</p>
            <h2>{chapters[b.chapter].map.caption || "Next map"}</h2>
          </div>
        {:else if b.kind === "stop"}
          {@const s = chapters[b.chapter].stops[b.stop]}
          {@const pics = stopPhotos(s)}
          <article class="card stop-card rv" use:reveal aria-label={`Waypoint ${s.marker.label || b.stop + 1}`}>
            <div class="stop-head">
              <span class="badge"><span>{(s.marker.label || "").slice(0, 4)}</span></span>
              <span class="muted small">Waypoint {b.stop + 1} of {chapters[b.chapter].stops.length}{multi ? `, map ${b.chapter + 1}` : ""}</span>
            </div>
            {#if s.marker.note}<p class="note">{s.marker.note}</p>{/if}
            {#if pics.length}
              <div class="pics" class:single={pics.length === 1}>
                <PhotoGrid photos={pics} {fileUrl} />
              </div>
            {/if}
          </article>
        {:else if b.kind === "outro"}
          <div class="outro">
            <div class="card rv" use:reveal>
              <h2>End of the route</h2>
              {#if dive.log}
                <Markdown text={dive.log} {refs} hrefFor={refHref} {onRef} />
              {:else}
                <p class="muted">That's the whole route{multi ? ` across ${chapters.length} maps` : ""}.</p>
              {/if}
            </div>
            {#if gallery.length}
              <div class="card rv" use:reveal>
                <h2>More photos from this dive</h2>
                <PhotoGrid photos={gallery} {fileUrl} />
              </div>
            {/if}
            <div class="outro-actions">
              <button onclick={restart}>Start again</button>
              <a class="btn btn-primary" href={backHref}>Back to the dive</a>
            </div>
          </div>
        {/if}
      </section>
    {/each}
  </div>
{/if}

<style>
  .empty { padding-top: 4rem; display: grid; gap: 0.75rem; justify-items: start; }

  /* ---------- background ---------- */
  .stage {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: var(--paper);
    z-index: 0;
  }
  .world {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    opacity: 0;
    transition: opacity 0.5s;
    will-change: transform;
  }
  .world.on { opacity: 1; }
  .world img {
    width: 100%;
    height: 100%;
    display: block;
    user-select: none;
    box-shadow: 0 0 0 1px var(--rule), 0 10px 40px rgba(0, 0, 0, 0.12);
  }
  .overlay { position: absolute; inset: 0; }
  .route-dim {
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 3;
    stroke-dasharray: 2 7;
    stroke-linecap: round;
    opacity: 0.8;
  }
  .route-halo { fill: none; stroke: var(--halo); stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; }
  .route-done { fill: none; stroke: var(--accent); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
  .arrow path { fill: var(--surface); stroke: var(--accent); stroke-width: 2; }
  .arrow text { font: 760 12px var(--font-ui); font-stretch: 70%; fill: var(--accent-text); }
  .arrow.passed path { fill: var(--accent); stroke: var(--halo); }
  .arrow.passed text { fill: var(--accent-ink); }
  .arrow.current path { fill: var(--ink); stroke: var(--accent); stroke-width: 2.5; }
  .arrow.current text { fill: var(--paper); }
  .arrow.off path { fill: var(--surface); stroke: var(--ink-2); opacity: 0.7; }
  .arrow.off text { fill: var(--ink-2); }
  .diver .dot { fill: #fff; stroke: var(--accent); stroke-width: 5; }
  .diver .pulse { fill: var(--accent); opacity: 0.25; transform-box: fill-box; transform-origin: center; animation: pulse 1.8s ease-out infinite; }
  @keyframes pulse {
    from { transform: scale(0.6); opacity: 0.45; }
    to { transform: scale(1.9); opacity: 0; }
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, var(--paper) 30%, transparent 75%);
    opacity: 0;
    transition: opacity 0.4s;
  }
  .scrim.show { opacity: 0.92; }
  @media (min-width: 900px) {
    .scrim { background: linear-gradient(to right, var(--paper) 35%, transparent 60%); }
  }

  /* ---------- top bar ---------- */
  .tour-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: calc(env(safe-area-inset-top) + 8px) 12px 8px;
    background: color-mix(in srgb, var(--paper) 85%, transparent);
    backdrop-filter: blur(8px);
  }
  .close {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 1px solid var(--rule);
    background: var(--surface);
    flex-shrink: 0;
  }
  .where { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--rule);
  }
  .progress i {
    display: block;
    height: 100%;
    background: var(--accent);
    transform-origin: 0 50%;
  }

  /* ---------- story ---------- */
  .story {
    position: relative;
    z-index: 10;
    pointer-events: none;
  }
  .story :global(a), .story :global(button), .card { pointer-events: auto; }
  .blk {
    display: flex;
    padding: 0 16px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.16);
    padding: 1.1rem 1.15rem;
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
  }
  .card h2 { margin-bottom: 0.6rem; }

  .intro {
    align-self: flex-end;
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    padding: 45vh 0 3rem;
    display: grid;
    gap: 0.6rem;
    justify-items: start;
    pointer-events: auto;
  }
  .intro .when { margin: 0; color: var(--ink-2); font-weight: 600; }
  .intro h1 { font-size: clamp(2.6rem, 11vw, 4.5rem); overflow-wrap: anywhere; }
  .stats { display: flex; flex-wrap: wrap; gap: 0.4rem 1.4rem; margin: 0.4rem 0 0; }
  .stats dt { font-size: 0.8rem; color: var(--ink-2); font-weight: 600; }
  .stats dd { margin: 0; font-size: 1.7rem; font-weight: 760; font-stretch: 65%; line-height: 1.1; }
  .stats small { font-size: 0.9rem; color: var(--ink-2); margin-left: 0.15rem; font-stretch: 100%; }
  .team { margin: 0; }
  .plan { margin: 0.6rem 0 0; max-width: 100%; }
  .hint { margin: 1rem 0 0; color: var(--ink-2); font-weight: 600; }

  .chapter { align-items: center; }
  .chapter-card { text-align: left; }
  .chapter-card p { margin: 0 0 0.3rem; }

  /* stop cards sit below the diver on phones */
  .stop { align-items: flex-start; }
  .stop-card { margin-top: 48vh; }
  .stop-head { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.4rem; }
  .badge { filter: drop-shadow(0 1px 1.5px var(--halo)); flex-shrink: 0; }
  .badge span {
    display: grid;
    place-items: start center;
    width: 30px;
    height: 38px;
    padding-top: 6px;
    background: var(--accent);
    color: var(--accent-ink);
    clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
    font: 760 13px/1 var(--font-ui);
    font-stretch: 70%;
  }
  .note {
    margin: 0.2rem 0 0;
    font-family: var(--font-log);
    font-size: 1.2rem;
    line-height: 1.5;
  }
  .pics { margin-top: 0.8rem; }
  .pics.single :global(.grid) { grid-template-columns: 1fr; }
  .pics.single :global(.grid button) { aspect-ratio: 4 / 3; }

  .outro { width: 100%; padding: 30vh 0 calc(env(safe-area-inset-bottom) + 3rem); display: grid; gap: 1rem; }
  .outro-actions { display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap; }
  .outro-actions button, .outro-actions .btn { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15); }

  /* reveal */
  .rv {
    opacity: 0;
    transform: translateY(28px) scale(0.98);
    transition: opacity 0.45s ease-out, transform 0.45s ease-out;
  }
  .rv:global(.in) { opacity: 1; transform: none; }

  /* ---------- desktop: cards in a left column, map on the right ---------- */
  @media (min-width: 900px) {
    .blk { padding: 0 0 0 4vw; }
    .card { margin: 0; max-width: min(460px, 34vw); }
    .intro { margin: 0; max-width: min(520px, 36vw); padding-top: 22vh; align-self: center; }
    .stop { align-items: center; }
    .stop-card { margin-top: 0; }
    .outro { max-width: min(520px, 36vw); padding-top: 20vh; }
    .outro-actions { justify-content: flex-start; }
  }

  @media (prefers-reduced-motion: reduce) {
    .rv { opacity: 1; transform: none; }
    .diver .pulse { animation: none; }
  }
</style>
