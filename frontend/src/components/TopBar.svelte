<script>
  import { app, syncNow, signOut } from "../lib/app.svelte.js";
  import SyncPanel from "./SyncPanel.svelte";

  /** @type {{ backHref?: string, backLabel?: string, children?: any, showSync?: boolean }} */
  let { backHref, backLabel = "Back", children, showSync = true } = $props();
  let menuOpen = $state(false);
  let panelOpen = $state(false);

  const status = $derived.by(() => {
    const s = app.sync;
    const kind = s.error?.kind;
    if (s.running) return { text: "Syncing…", tone: "busy" };
    if (s.problems.length) return { text: `${s.problems.length} couldn't sync`, tone: "err" };
    if (!s.online || kind === "offline") return { text: s.pending ? `Offline, ${s.pending} to sync` : "Offline", tone: "off" };
    if (kind === "server") return { text: "Server unavailable", tone: "off" };
    if (kind === "busy") return { text: "Sync paused", tone: "busy" };
    if (kind) return { text: "Sync failed", tone: "err" };
    if (s.pending) return { text: `${s.pending} to sync`, tone: "busy" };
    return { text: "Synced", tone: "ok" };
  });

  // With problems to show, the status opens the list; otherwise it syncs.
  function onStatus() {
    if (app.sync.problems.length || app.sync.error?.kind === "other") panelOpen = true;
    else syncNow();
  }

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
        <button class="sync {status.tone}" onclick={onStatus} aria-haspopup={app.sync.problems.length ? "dialog" : undefined}>
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
</header>

{#if panelOpen}
  <SyncPanel onClose={() => (panelOpen = false)} />
{/if}

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
</style>
