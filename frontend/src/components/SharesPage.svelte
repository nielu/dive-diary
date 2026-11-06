<script>
  import { app, pb, tripNames, newShareToken, shareUrl } from "../lib/app.svelte.js";
  import TopBar from "./TopBar.svelte";

  let shares = $state([]);
  let loading = $state(true);
  let error = $state("");
  let copied = $state("");

  let trip = $state(tripNames()[0] || "");
  let label = $state("");
  let expires = $state("");
  let creating = $state(false);

  const trips = $derived(tripNames());

  async function load() {
    loading = true;
    error = "";
    try {
      shares = await pb.collection("shares").getFullList({ sort: "-created" });
    } catch (e) {
      error = navigator.onLine ? e.message : "Share links need a connection. Your dives are still available offline.";
    } finally {
      loading = false;
    }
  }
  load();

  async function create(e) {
    e.preventDefault();
    creating = true;
    error = "";
    try {
      const rec = await pb.collection("shares").create({
        token: newShareToken(),
        trip,
        label: label.trim() || trip || "All dives",
        expires: expires ? `${expires} 23:59:59.000Z` : "",
      });
      shares = [rec, ...shares];
      label = "";
      expires = "";
      send(rec);
    } catch (err) {
      error = err.message;
    } finally {
      creating = false;
    }
  }

  async function send(s) {
    const url = shareUrl(s.token);
    if (navigator.share) {
      try {
        await navigator.share({ title: s.label, text: `Dive diary: ${s.label}`, url });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    await copy(s);
  }

  async function copy(s) {
    try {
      await navigator.clipboard.writeText(shareUrl(s.token));
      copied = s.id;
      setTimeout(() => copied === s.id && (copied = ""), 2000);
    } catch {
      prompt("Copy this link:", shareUrl(s.token));
    }
  }

  async function turnOff(s) {
    if (!confirm(`Turn off "${s.label}"? Anyone with the link will lose access.`)) return;
    try {
      await pb.collection("shares").delete(s.id);
      shares = shares.filter((x) => x.id !== s.id);
    } catch (err) {
      error = err.message;
    }
  }

  const expired = (s) => s.expires && new Date(s.expires.replace(" ", "T")) < new Date();
  const count = (t) => (t ? app.dives.filter((d) => d.trip === t).length : app.dives.length);
</script>

<TopBar backHref="#/" backLabel="All dives" />

<main class="wrap">
  <h1>Share links</h1>
  <p class="muted lede">Send a read-only link to family or buddies. They see the logs, maps with markers and routes, and photos. They can't edit anything, and you can turn a link off at any time.</p>

  <form onsubmit={create}>
    <label class="field">What to share
      <select bind:value={trip}>
        {#each trips as t}<option value={t}>{t} ({count(t)} dives)</option>{/each}
        <option value="">All dives ({count("")})</option>
      </select>
    </label>
    <label class="field">Name for the link
      <input bind:value={label} placeholder={trip || "All dives"} />
    </label>
    <label class="field">Stops working after (optional)
      <input type="date" bind:value={expires} />
    </label>
    <button class="btn-primary" disabled={creating || !app.sync.online}>{creating ? "Creating…" : "Create link"}</button>
  </form>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <h2>Active links</h2>
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if shares.length}
    <ul>
      {#each shares as s (s.id)}
        <li class:dead={expired(s)}>
          <div>
            <strong>{s.label}</strong>
            <p class="muted small">
              {s.trip ? `Trip: ${s.trip}` : "All dives"}{s.expires ? `, ${expired(s) ? "expired" : "until"} ${s.expires.slice(0, 10)}` : ""}
            </p>
          </div>
          <div class="actions">
            <button onclick={() => send(s)}>{copied === s.id ? "Copied" : "Send"}</button>
            <a class="btn btn-quiet" href={`#/s/${s.token}`} target="_blank" rel="noopener">Preview</a>
            <button class="btn-danger" onclick={() => turnOff(s)}>Turn off</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else if !error}
    <p class="muted">No links yet.</p>
  {/if}
</main>

<style>
  main { padding-bottom: 4rem; }
  h1 { margin-top: 1.5rem; }
  .lede { max-width: 60ch; }
  form {
    display: grid;
    gap: 1rem;
    margin: 1.5rem 0 2rem;
    padding: 1rem;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
  }
  form button { justify-self: start; }
  h2 { margin: 1rem 0 0.5rem; }
  ul { list-style: none; padding: 0; margin: 0; }
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    padding: 0.9rem 0;
    border-bottom: 1px solid var(--rule);
  }
  li p { margin: 0.15rem 0 0; }
  li.dead strong { text-decoration: line-through; color: var(--ink-2); }
  .actions { display: flex; gap: 0.3rem; flex-wrap: wrap; }
  .error { color: var(--danger); }
</style>
