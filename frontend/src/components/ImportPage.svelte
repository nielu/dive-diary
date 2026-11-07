<script>
  import { app, saveDive, lastTrip } from "../lib/app.svelte.js";
  import { newId } from "../lib/localdb.js";
  import { readDiveFile } from "../lib/fitimport.js";
  import { planImport, applyImport } from "../lib/importmatch.js";
  import { formatDate, formatNum } from "../lib/format.js";
  import { LIMITS } from "../lib/schema.js";
  import { go } from "../lib/router.svelte.js";
  import TopBar from "./TopBar.svelte";
  import DepthProfile from "./DepthProfile.svelte";

  let items = $state([]);
  let reading = $state(false);
  let importing = $state(false);
  const chosen = $derived(items.filter((i) => i.include));

  async function pick(e) {
    const files = [...(e.currentTarget.files || [])];
    e.currentTarget.value = "";
    if (!files.length) return;
    reading = true;
    const read = [];
    for (const file of files) {
      try {
        const data = await readDiveFile(new Uint8Array(await file.arrayBuffer()), file.name);
        read.push({ name: file.name, data });
      } catch (err) {
        read.push({ name: file.name, error: err?.message || "Couldn't read this file." });
      }
    }
    read.sort((a, b) => (a.data?.source || "").localeCompare(b.data?.source || ""));
    const ok = read.filter((r) => r.data);
    const plan = planImport(ok.map((r) => r.data), app.dives);
    const trip = lastTrip();
    items = read.map((r) => {
      if (!r.data) return { ...r, kind: "error", include: false };
      const p = plan[ok.indexOf(r)];
      return { ...r, kind: p.kind, dive: p.dive, include: p.kind !== "duplicate", site: r.data.site, trip };
    });
    reading = false;
  }

  async function run() {
    importing = true;
    let last = null;
    for (const item of chosen) {
      if (item.kind === "fill") {
        const current = app.dives.find((d) => d.id === item.dive.id) || item.dive;
        last = await saveDive(applyImport(current, item.data));
      } else if (item.kind === "new") {
        last = await saveDive({
          id: newId(),
          team: "",
          leader: "",
          navigation: "",
          log: "",
          ...item.data,
          site: item.site.trim(),
          trip: item.trip.trim(),
        });
      }
    }
    importing = false;
    go(chosen.length === 1 && last ? `/dive/${last.id}` : "/");
  }

  function stats(d) {
    return [
      d.max_depth && `${formatNum(d.max_depth)} m max`,
      d.avg_depth && `${formatNum(d.avg_depth)} m avg`,
      d.duration && `${d.duration} min`,
      d.temp && `${formatNum(d.temp)} °C`,
      d.gas,
    ].filter(Boolean);
  }
</script>

<TopBar backHref="#/" backLabel="All dives" />

<main class="wrap">
  <h1>Import dives</h1>
  <p class="muted lede">
    In the Garmin app, share a dive as a <b>.fit</b> file and save it to Files, then pick it here.
    One file per dive; you can pick several at once. Dives you already logged by hand on the same day and time get the
    computer's numbers and profile; your notes stay.
  </p>

  <label class="btn btn-primary pick">
    {reading ? "Reading…" : items.length ? "Choose other files" : "Choose .fit files"}
    <input type="file" multiple hidden onchange={pick} disabled={reading} />
  </label>

  {#if items.length}
    <ul class="items">
      {#each items as item, i (item.name + i)}
        <li class={item.kind}>
          {#if item.kind === "error"}
            <p class="name">{item.name}</p>
            <p class="error">{item.error}</p>
          {:else}
            <div class="head">
              <div>
                <p class="when">{formatDate(item.data.date, item.data.time)}{item.data.dive_no ? `, dive ${item.data.dive_no}` : ""}</p>
                <p class="stats">{#each stats(item.data) as s}<span>{s}</span>{/each}</p>
              </div>
              {#if item.kind !== "duplicate"}
                <label class="include">
                  <input type="checkbox" bind:checked={item.include} />
                  Import
                </label>
              {/if}
            </div>
            <DepthProfile profile={item.data.profile} compact />
            {#if item.kind === "new"}
              <div class="fields">
                <label class="field">Site
                  <input bind:value={item.site} maxlength={LIMITS.site} placeholder="Cenote, cave or entrance" />
                </label>
                <label class="field">Trip
                  <input bind:value={item.trip} maxlength={LIMITS.trip} />
                </label>
              </div>
              <p class="note">Adds a new dive.</p>
            {:else if item.kind === "fill"}
              <p class="note">Adds the computer's numbers and profile to <a href={`#/dive/${item.dive.id}`}>{item.dive.site || "your dive"}</a>{item.dive.time ? ` (${item.dive.time})` : ""}. Your notes stay.</p>
            {:else}
              <p class="note muted">Already in your log as <a href={`#/dive/${item.dive?.id}`}>{item.dive?.site || "a dive"}</a>.</p>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>

    <div class="foot">
      <button class="btn-primary" onclick={run} disabled={!chosen.length || importing}>
        {importing ? "Importing…" : chosen.length === 1 ? "Import 1 dive" : `Import ${chosen.length} dives`}
      </button>
    </div>
  {/if}
</main>

<style>
  main { padding-bottom: 4rem; }
  h1 { margin-top: 1.5rem; }
  .lede { max-width: 60ch; }
  .pick { margin: 0.5rem 0 1.25rem; }
  .items { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
  li {
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    padding: 0.85rem 0.95rem;
    display: grid;
    gap: 0.6rem;
  }
  li.duplicate { opacity: 0.7; }
  .head { display: flex; justify-content: space-between; gap: 0.75rem; align-items: start; }
  .when { margin: 0; font-weight: 700; }
  .stats { margin: 0.2rem 0 0; display: flex; flex-wrap: wrap; gap: 0.2rem 0.8rem; font-size: 0.9rem; color: var(--ink-2); }
  .include { display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600; white-space: nowrap; min-height: 44px; }
  .include input { width: 20px; height: 20px; min-height: 0; accent-color: var(--accent); }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .note { margin: 0; font-size: 0.9rem; }
  .name { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
  .error { margin: 0; color: var(--danger); }
  .foot { margin-top: 1rem; display: flex; justify-content: flex-end; }
  @media (max-width: 420px) { .fields { grid-template-columns: 1fr; } }
</style>
