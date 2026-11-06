<script>
  import { app, syncNow, signOut } from "../lib/app.svelte.js";

  /** @type {{ backHref?: string, backLabel?: string, children?: any, showSync?: boolean }} */
  let { backHref, backLabel = "Back", children, showSync = true } = $props();
  let menuOpen = $state(false);

  const status = $derived.by(() => {
    const s = app.sync;
    if (s.running) return { text: "Syncing…", tone: "busy" };
    if (!s.online) return { text: s.pending ? `Offline, ${s.pending} to sync` : "Offline", tone: "off" };
    if (s.error) return { text: s.pending ? `${s.pending} not synced` : "Sync failed", tone: "err" };
    if (s.failed.length) return { text: `${s.failed.length} couldn't sync`, tone: "err" };
    if (s.pending) return { text: `${s.pending} to sync`, tone: "busy" };
    return { text: "Synced", tone: "ok" };
  });

  function onWindowClick(e) {
    if (menuOpen && !e.target.closest?.(".menu")) menuOpen = false;
  }
</script>

<svelte:window onclick={onWindowClick} />

<header class="bar">
  <div class="wrap row">
    {#if backHref}
      <a class="back" href={backHref}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {backLabel}
      </a>
    {:else}
      <a class="brand" href="#/">Dive diary</a>
    {/if}

    <div class="right">
      {@render children?.()}
      {#if showSync && app.user}
        <button class="sync {status.tone}" onclick={syncNow} title={app.sync.error || (app.sync.failed[0]?.message ?? "Sync now")}>
          <i aria-hidden="true"></i>{status.text}
        </button>
        <div class="menu">
          <button class="btn-quiet dots" aria-label="Menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>
          </button>
          {#if menuOpen}
            <div class="pop" role="menu">
              <a role="menuitem" href="#/shares" onclick={() => (menuOpen = false)}>Share links</a>
              <button role="menuitem" onclick={() => { menuOpen = false; signOut(); }}>Sign out</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
  {#if app.sync.error && app.sync.online}
    <p class="wrap notice">{app.sync.error}</p>
  {/if}
</header>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 1000;
    background: color-mix(in srgb, var(--paper) 88%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--rule);
    padding-top: env(safe-area-inset-top);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 56px;
  }
  .brand {
    font-weight: 780;
    font-stretch: 72%;
    font-size: 1.3rem;
    text-decoration: none;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    text-decoration: none;
    font-weight: 600;
    margin-left: -4px;
    min-height: 44px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .sync {
    border: none;
    background: transparent;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink-2);
    padding: 0.4rem 0.5rem;
  }
  .sync i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--water);
  }
  .sync.busy i { background: var(--gold); }
  .sync.off i { background: var(--ink-2); }
  .sync.err i { background: var(--danger); }
  .sync.err { color: var(--danger); }
  .dots { padding: 0.4rem; min-width: 40px; }
  .menu { position: relative; }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    padding: 0.35rem;
    display: grid;
    min-width: 170px;
  }
  .pop a, .pop button {
    all: unset;
    cursor: pointer;
    padding: 0.65rem 0.8rem;
    border-radius: var(--radius-s);
    font-weight: 600;
  }
  .pop a:hover, .pop button:hover, .pop a:focus-visible, .pop button:focus-visible { background: var(--paper); }
  .notice {
    margin: 0 auto;
    padding-bottom: 0.6rem;
    color: var(--danger);
    font-size: 0.9rem;
  }
</style>
