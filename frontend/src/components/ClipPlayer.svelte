<script>
  // A clip inside "Follow the route": it plays muted and on a loop while it's
  // on screen and pauses when scrolled away, so the cave moves as you pass the
  // waypoint. The controls turn the sound on or go full screen. With reduced
  // motion it waits for a tap instead.
  import { formatClipLength } from "../lib/clip.js";

  let { clip, fileUrl } = $props();
  let failed = $state(false);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const w = $derived(clip.width || 16);
  const h = $derived(clip.height || 9);

  function playWhileVisible(video) {
    if (reduced || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.6 },
    );
    io.observe(video);
    return { destroy: () => io.disconnect() };
  }
</script>

<figure class="clip">
  <div class="frame" style:aspect-ratio={`${w} / ${h}`} style:--r={w / h}>
    {#if failed}
      <img src={fileUrl(clip, "480x480f")} alt={clip.caption || ""} />
      <p class="off">This clip can't play right now{navigator.onLine ? "" : "; clips need a connection"}.</p>
    {:else}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        src={fileUrl(clip, null, "video")}
        poster={fileUrl(clip)}
        muted
        loop
        playsinline
        controls
        preload="none"
        aria-label={`${clip.caption || "Clip"}, ${formatClipLength(clip.duration)}`}
        use:playWhileVisible
        onerror={() => (failed = true)}
      ></video>
    {/if}
  </div>
  {#if clip.caption}<figcaption>{clip.caption}</figcaption>{/if}
</figure>

<style>
  .clip { margin: 0.8rem 0 0; }
  /* Portrait clips stay short enough on a phone to leave the map in view. */
  .frame {
    position: relative;
    margin-inline: auto;
    width: min(100%, calc(45vh * var(--r)));
    border-radius: 6px;
    overflow: hidden;
    background: #050d10;
  }
  @media (min-width: 900px) {
    .frame { width: min(100%, calc(60vh * var(--r))); }
  }
  video, img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .off {
    position: absolute;
    left: 50%;
    bottom: 8px;
    transform: translateX(-50%);
    margin: 0;
    padding: 0.25rem 0.7rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 0.85rem;
    white-space: nowrap;
  }
  figcaption { margin-top: 0.35rem; font-size: 0.9rem; color: var(--ink-2); text-align: center; }
</style>
