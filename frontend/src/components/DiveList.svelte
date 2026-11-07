<script>
  import { app, createDive, tripNames } from "../lib/app.svelte.js";
  import { go } from "../lib/router.svelte.js";
  import TopBar from "./TopBar.svelte";
  import DiveRows from "./DiveRows.svelte";
  import InstallHint from "./InstallHint.svelte";

  let { trip } = $props();

  const trips = $derived(tripNames());
  const dives = $derived(trip ? app.dives.filter((d) => d.trip === trip) : app.dives);

  async function newDive() {
    const d = await createDive();
    go(`/dive/${d.id}/edit`);
  }
</script>

<TopBar />

<main class="wrap">
  <div class="head">
    <h1>{trip || "All dives"}</h1>
    <div class="actions">
      <a class="btn" href="#/import">Import</a>
      <button class="btn-primary" onclick={newDive}>New dive</button>
    </div>
  </div>

  <InstallHint />

  {#if trips.length}
    <nav class="trips" aria-label="Filter by trip">
      <a href="#/" aria-current={!trip ? "page" : undefined}>All</a>
      {#each trips as t}
        <a href={`#/trip/${encodeURIComponent(t)}`} aria-current={trip === t ? "page" : undefined}>{t}</a>
      {/each}
    </nav>
  {/if}

  {#if dives.length}
    <DiveRows {dives} maps={app.maps} photos={app.photos} />
  {:else}
    <div class="empty">
      <p>No dives logged{trip ? ` for ${trip}` : ""} yet.</p>
      <p class="muted">Start one now, even offline at the site. It syncs when you're back on a connection.</p>
    </div>
  {/if}
</main>

<style>
  main { padding-bottom: 4rem; }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 1rem;
    margin-top: 1.5rem;
  }
  .actions { display: flex; gap: 0.4rem; flex-shrink: 0; }
  .trips {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    margin: 1rem calc(var(--gutter) * -1) 0;
    padding: 0.2rem var(--gutter);
    scrollbar-width: none;
  }
  .trips a {
    flex-shrink: 0;
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 600;
    padding: 0.4rem 0.85rem;
    border-radius: 999px;
    border: 1px solid var(--rule);
    min-height: 36px;
    display: inline-flex;
    align-items: center;
  }
  .trips a[aria-current="page"] {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .empty { margin-top: 3rem; }
  .empty p { margin: 0.3rem 0; }
</style>
