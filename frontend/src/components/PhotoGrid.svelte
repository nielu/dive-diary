<script>
  import { savePhoto, deleteRecord } from "../lib/app.svelte.js";

  let { photos, fileUrl, owner = false } = $props();

  let open = $state(-1);
  let caption = $state("");
  const current = $derived(open >= 0 ? photos[open] : null);

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
    if (!current || !confirm("Delete this photo?")) return;
    const id = current.id;
    close();
    await deleteRecord("photos", id);
  }
  function onKey(e) {
    if (open < 0 || e.target.tagName === "INPUT") return;
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

  // swipe between photos
  let startX = 0;
  function touchStart(e) {
    startX = e.touches[0].clientX;
  }
  function touchEnd(e) {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  }
</script>

<svelte:window onkeydown={onKey} />

<ul class="grid">
  {#each photos as p, i (p.id)}
    <li>
      <button onclick={() => show(i)} aria-label={p.caption || `Photo ${i + 1}`}>
        <img src={fileUrl(p, "480x480f")} alt={p.caption || ""} loading="lazy" />
      </button>
    </li>
  {/each}
</ul>

{#if current}
  <div class="lightbox" use:portal role="dialog" aria-modal="true" aria-label="Photo">
    <div class="top">
      <span class="count">{open + 1} of {photos.length}</span>
      <div>
        {#if owner}<button class="btn-quiet light" onclick={del}>Delete</button>{/if}
        <button class="btn-quiet light" onclick={close}>Close</button>
      </div>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="stage" ontouchstart={touchStart} ontouchend={touchEnd}>
      <img src={fileUrl(current)} alt={current.caption || ""} />
      {#if photos.length > 1}
        <button class="nav prev" onclick={() => step(-1)} aria-label="Previous photo">‹</button>
        <button class="nav next" onclick={() => step(1)} aria-label="Next photo">›</button>
      {/if}
    </div>
    <div class="cap">
      {#if owner}
        <input placeholder="Add a caption" bind:value={caption} onblur={saveCaption} onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
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
    display: block;
    aspect-ratio: 1;
    width: 100%;
    background: var(--rule);
    border-radius: 4px;
    overflow: hidden;
  }
  .grid button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .grid img { width: 100%; height: 100%; object-fit: cover; display: block; }

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
  .stage img { max-width: 100%; max-height: 100%; object-fit: contain; }
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
