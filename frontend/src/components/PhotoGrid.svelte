<script>
  import { savePhoto, deleteRecord } from "../lib/app.svelte.js";
  import { isClip, formatClipLength } from "../lib/clip.js";

  let { photos, fileUrl, owner = false } = $props();

  let open = $state(-1);
  let fullFailed = $state({});
  let clipFailed = $state({});

  function tileLabel(p, i) {
    if (!isClip(p)) return p.caption || `Photo ${i + 1}`;
    return `Clip, ${formatClipLength(p.duration)}${p.caption ? `: ${p.caption}` : ""}`;
  }
  let caption = $state("");
  const current = $derived(open >= 0 ? photos[open] : null);
  const currentIsClip = $derived(isClip(current));

  async function show(i) {
    open = i;
    caption = photos[i]?.caption || "";
  }
  function close() {
    open = -1;
  }
  function step(d) {
    if (!photos.length) return;
    show((open + d + photos.length) % photos.length);
  }
  async function saveCaption() {
    if (!owner || !current || caption === (current.caption || "")) return;
    await savePhoto({ ...current, caption });
  }
  async function del() {
    if (!current || !confirm(currentIsClip ? "Delete this clip?" : "Delete this photo?")) return;
    const id = current.id;
    close();
    await deleteRecord("photos", id);
  }
  function onKey(e) {
    if (open < 0 || e.target.tagName === "INPUT" || e.target.tagName === "VIDEO") return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  }

  // Render the lightbox at the end of <body> so no parent stacking context
  // (like the tour's story layer) can sit on top of it.
  function portal(node) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  // swipe between photos (not on a clip, where a sideways drag scrubs it)
  let startX = null;
  function touchStart(e) {
    startX = currentIsClip ? null : e.touches[0].clientX;
  }
  function touchEnd(e) {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  }
</script>

<svelte:window onkeydown={onKey} />

<ul class="grid">
  {#each photos as p, i (p.id)}
    <li>
      <button onclick={() => show(i)} aria-label={tileLabel(p, i)}>
        <img src={fileUrl(p, "480x480f")} alt={p.caption || ""} loading="lazy" />
        {#if isClip(p)}
          <span class="clip-badge" aria-hidden="true">
            <svg width="10" height="12" viewBox="0 0 10 12"><path d="M0 0l10 6-10 6z" fill="currentColor" /></svg>
            {formatClipLength(p.duration)}
          </span>
        {/if}
      </button>
    </li>
  {/each}
</ul>

{#if current}
  <div class="lightbox" use:portal role="dialog" aria-modal="true" aria-label={currentIsClip ? "Clip" : "Photo"}>
    <div class="top">
      <span class="count">{open + 1} of {photos.length}</span>
      <div>
        {#if owner}<button class="btn-quiet light" onclick={del}>Delete</button>{/if}
        <button class="btn-quiet light" onclick={close}>Close</button>
      </div>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="stage" ontouchstart={touchStart} ontouchend={touchEnd}>
      {#if currentIsClip && !clipFailed[current.id]}
        {#key current.id}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            src={fileUrl(current, null, "video")}
            poster={fileUrl(current)}
            controls
            playsinline
            autoplay
            preload="auto"
            aria-label={current.caption || "Clip"}
            onerror={() => (clipFailed[current.id] = true)}
          ></video>
        {/key}
      {:else}
        <!-- Full size isn't kept offline; fall back to the cached thumbnail. -->
        <img
          src={fullFailed[current.id] || clipFailed[current.id] ? fileUrl(current, "480x480f") : fileUrl(current)}
          alt={current.caption || ""}
          onerror={() => {
            if (!fullFailed[current.id]) fullFailed[current.id] = true;
          }}
        />
      {/if}
      {#if clipFailed[current.id]}
        <p class="lowres">This clip can't play right now{navigator.onLine ? "" : "; clips need a connection"}.</p>
      {:else if fullFailed[current.id]}
        <p class="lowres">Full size isn't available offline.</p>
      {/if}
      {#if photos.length > 1}
        <button class="nav prev" onclick={() => step(-1)} aria-label="Previous">‹</button>
        <button class="nav next" onclick={() => step(1)} aria-label="Next">›</button>
      {/if}
    </div>
    <div class="cap">
      {#if owner}
        <input placeholder="Add a caption" maxlength="500" bind:value={caption} onblur={saveCaption} onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      {:else if current.caption}
        <p>{current.caption}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(30%, 160px), 1fr));
    gap: 4px;
  }
  .grid button {
    all: unset;
    cursor: pointer;
    position: relative;
    display: block;
    aspect-ratio: 1;
    width: 100%;
    background: var(--rule);
    border-radius: 4px;
    overflow: hidden;
  }
  .grid button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .grid img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .clip-badge {
    position: absolute;
    left: 6px;
    bottom: 6px;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: rgba(5, 13, 16, 0.72);
    color: #fff;
    font-size: 0.78rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    line-height: 1.3;
  }

  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 3000;
    background: #050d10;
    color: #fff;
    display: grid;
    grid-template-rows: auto 1fr auto;
    padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
  }
  .top { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0.75rem; }
  .count { font-size: 0.9rem; opacity: 0.8; }
  .light { color: #fff; }
  .stage { position: relative; min-height: 0; display: grid; place-items: center; }
  .stage img, .stage video { max-width: 100%; max-height: 100%; object-fit: contain; }
  .stage video { width: 100%; height: 100%; background: #000; }
  .lowres {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 0.25rem 0.7rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.6);
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    border: none;
    font-size: 2rem;
    width: 44px;
    height: 64px;
    border-radius: 8px;
    padding: 0;
  }
  .prev { left: 8px; }
  .next { right: 8px; }
  .cap { padding: 0.6rem 0.75rem 0.9rem; }
  .cap input { background: rgba(255, 255, 255, 0.08); color: #fff; border-color: rgba(255, 255, 255, 0.2); }
  .cap p { margin: 0; text-align: center; }
</style>
