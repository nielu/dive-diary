<script>
  // Sheet listing changes that didn't sync, why, and where to fix them.
  import { app, syncNow } from "../lib/app.svelte.js";

  let { onClose } = $props();
  let first;

  $effect(() => first?.focus());

  function fixHref(p) {
    if (p.collection === "dives") return `#/dive/${p.id}/edit`;
    if (p.collection === "maps") return `#/dive/${p.dive}/map/${p.id}`;
    return `#/dive/${p.dive}`;
  }

  async function retry() {
    await syncNow({ force: true });
    if (!app.sync.problems.length && app.sync.error?.kind !== "other") onClose();
  }

  function onKey(e) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sync-title">
  <h2 id="sync-title">Changes that didn't sync</h2>
  <p class="muted small">These are saved on this device only. Fix them and they sync on their own.</p>

  {#if app.sync.error?.kind === "other"}
    <p class="general">{app.sync.error.message}</p>
  {/if}

  {#if app.sync.problems.length}
    <ul>
      {#each app.sync.problems as p (p.id)}
        <li>
          <div>
            <strong>{p.title}</strong>
            <p>{p.message}</p>
          </div>
          <a class="btn" href={fixHref(p)} onclick={onClose}>Fix</a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if app.sync.waiting}
    <p class="muted small">
      {app.sync.waiting === 1 ? "1 map or photo is" : `${app.sync.waiting} maps and photos are`} waiting for their dive to sync.
    </p>
  {/if}

  <div class="actions">
    <button onclick={onClose}>Close</button>
    <button bind:this={first} class="btn-primary" onclick={retry} disabled={app.sync.running || !app.sync.online}>
      {app.sync.running ? "Syncing…" : "Try again"}
    </button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 13, 16, 0.4);
    z-index: 2000;
  }
  .sheet {
    position: fixed;
    left: 8px;
    right: 8px;
    bottom: calc(env(safe-area-inset-bottom) + 8px);
    z-index: 2001;
    max-width: 520px;
    max-height: 80dvh;
    overflow: auto;
    margin: 0 auto;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
    padding: 1.1rem;
  }
  h2 { margin-bottom: 0.3rem; }
  .muted { margin: 0.3rem 0; }
  .general { color: var(--danger); }
  ul { list-style: none; margin: 0.75rem 0; padding: 0; }
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding: 0.7rem 0;
    border-top: 1px solid var(--rule);
  }
  li p { margin: 0.15rem 0 0; color: var(--danger); font-size: 0.92rem; }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.9rem; }
</style>
