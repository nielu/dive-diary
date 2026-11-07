<script>
  import { untrack, tick } from "svelte";
  import { markerIndex } from "../lib/refs.js";
  import { LIMITS } from "../lib/schema.js";
  import { FIELDS } from "../lib/localdb.js";
  import { app, saveDive, deleteRecord, tripNames } from "../lib/app.svelte.js";
  import { go } from "../lib/router.svelte.js";
  import TopBar from "./TopBar.svelte";

  let { id } = $props();

  const source = app.dives.find((d) => d.id === id);
  // Local working copy; saved to the device as you type.
  let form = $state(source ? { ...source } : null);
  let saved = $state(true);
  const trips = $derived(tripNames());

  let timer;
  let first = true;
  $effect(() => {
    JSON.stringify(form); // track every field
    if (first) {
      first = false;
      return;
    }
    saved = false;
    clearTimeout(timer);
    timer = setTimeout(() => untrack(flush), 500);
  });

  async function flush() {
    clearTimeout(timer);
    if (!form || saved) return;
    const current = app.dives.find((d) => d.id === id) || {};
    // Only the editable fields; sync bookkeeping stays as it is in the database.
    const edits = Object.fromEntries(FIELDS.dives.map((f) => [f, $state.snapshot(form[f])]));
    await saveDive({ ...current, ...edits, trip: (form.trip || "").trim(), site: (form.site || "").trim() });
    saved = true;
  }

  // A dive must have a date; clearing the field keeps the last one.
  let dateError = $state("");
  function onDate(e) {
    const v = e.currentTarget.value;
    if (v) {
      form.date = v;
      dateError = "";
    } else {
      dateError = "A dive needs a date. The last one is kept.";
    }
  }
  function onDateBlur(e) {
    if (!e.currentTarget.value) e.currentTarget.value = form.date;
  }

  async function done() {
    await flush();
    go(`/dive/${id}`);
  }

  async function del() {
    if (!confirm("Delete this dive with its maps and photos? This can't be undone.")) return;
    clearTimeout(timer);
    await deleteRecord("dives", id);
    go("/");
  }

  // "#T1" references: chips under the focused text field insert a marker label.
  const refList = $derived([...markerIndex(app.maps.filter((m) => m.dive === id)).values()]);
  let activeField = $state("");
  const fields = {};

  async function insertRef(field, label) {
    const el = fields[field];
    const text = form[field] || "";
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const pre = before && !/\s$/.test(before) ? " " : "";
    const post = after.startsWith(" ") ? "" : " ";
    const insert = `${pre}#${label}${post}`;
    form[field] = before + insert + after;
    await tick();
    const pos = start + insert.length;
    el?.focus();
    el?.setSelectionRange(pos, pos);
  }

  const num = (v) => (v === "" || v === null || Number.isNaN(Number(v)) ? 0 : Number(v));
</script>

<svelte:window onbeforeunload={() => flush()} />

<TopBar backHref={`#/dive/${id}`} backLabel="Dive" showSync={false}>
  <span class="state muted small" aria-live="polite">{saved ? "Saved on device" : "Saving…"}</span>
  <button class="btn-primary" onclick={done}>Done</button>
</TopBar>

{#if form}
  <main class="wrap">
    <h1>{form.site || "New dive"}</h1>

    <div class="grid">
      <label class="field span2">Site
        <input bind:value={form.site} maxlength={LIMITS.site} placeholder="Cenote, cave or entrance" />
      </label>
      <label class="field">Date
        <input type="date" value={form.date} oninput={onDate} onblur={onDateBlur} required aria-invalid={dateError ? "true" : undefined} aria-describedby={dateError ? "date-error" : undefined} />
        {#if dateError}<span id="date-error" class="field-error">{dateError}</span>{/if}
      </label>
      <label class="field">Time in
        <input type="time" value={form.time} oninput={(e) => (form.time = e.currentTarget.value.slice(0, 5))} />
      </label>
      <label class="field span2">Trip
        <input bind:value={form.trip} maxlength={LIMITS.trip} list="trip-names" placeholder="e.g. Mexico 2026" />
        <datalist id="trip-names">
          {#each trips as t}<option value={t}></option>{/each}
        </datalist>
      </label>
      <label class="field span2">Team
        <input bind:value={form.team} maxlength={LIMITS.team} placeholder="Who dived" />
      </label>
      <label class="field span2">Led by
        <input bind:value={form.leader} maxlength={LIMITS.leader} />
      </label>
      <label class="field">Max depth (m)
        <input inputmode="decimal" type="number" step="0.1" min="0" value={form.max_depth || ""} oninput={(e) => (form.max_depth = num(e.currentTarget.value))} />
      </label>
      <label class="field">Avg depth (m)
        <input inputmode="decimal" type="number" step="0.1" min="0" value={form.avg_depth || ""} oninput={(e) => (form.avg_depth = num(e.currentTarget.value))} />
      </label>
      <label class="field">Water temp (°C)
        <input inputmode="decimal" type="number" step="0.1" value={form.temp || ""} oninput={(e) => (form.temp = num(e.currentTarget.value))} />
      </label>
      <label class="field">Gas
        <input bind:value={form.gas} maxlength={LIMITS.gas} placeholder="e.g. Air, EAN32" />
      </label>
      <label class="field">Dive number
        <input inputmode="numeric" type="number" step="1" min="0" value={form.dive_no || ""} oninput={(e) => (form.dive_no = Math.round(num(e.currentTarget.value)))} />
      </label>
      <label class="field">Run time (min)
        <input inputmode="numeric" type="number" step="1" min="0" value={form.duration || ""} oninput={(e) => (form.duration = Math.round(num(e.currentTarget.value)))} />
      </label>
      <label class="field span2">Navigation
        <textarea class="log" rows="7" maxlength={LIMITS.navigation} bind:this={fields.navigation} bind:value={form.navigation} onfocus={() => (activeField = "navigation")} onblur={() => (activeField = "")} placeholder={"One decision per line, e.g.\n#T1 left, follow main line\nJump at arrow 3 to the blue line"}></textarea>
        {#if activeField === "navigation" && refList.length}
          <div class="chips" role="toolbar" aria-label="Insert a marker reference">
            {#each refList as r (r.markerId)}
              <button type="button" class="chip" title={r.note || r.label} onpointerdown={(e) => e.preventDefault()} onclick={() => insertRef("navigation", r.label)}><i aria-hidden="true"></i>{r.label}</button>
            {/each}
          </div>
        {/if}
      </label>
      <label class="field span2">Log and comments
        <textarea class="log" rows="10" maxlength={LIMITS.log} bind:this={fields.log} bind:value={form.log} onfocus={() => (activeField = "log")} onblur={() => (activeField = "")} placeholder="How the dive went, conditions, turn point and why"></textarea>
        {#if activeField === "log" && refList.length}
          <div class="chips" role="toolbar" aria-label="Insert a marker reference">
            {#each refList as r (r.markerId)}
              <button type="button" class="chip" title={r.note || r.label} onpointerdown={(e) => e.preventDefault()} onclick={() => insertRef("log", r.label)}><i aria-hidden="true"></i>{r.label}</button>
            {/each}
          </div>
        {/if}
      </label>
    </div>
    <p class="muted small">
      Markdown works in both text fields: <code>**bold**</code>, lists with <code>-</code>.
      {#if refList.length}
        Write a marker's label after <code>#</code>, like <code>#{refList[0].label}</code>, to link to it on the map.
      {:else}
        Once a map has markers, write <code>#</code> and a marker's label, like <code>#T1</code>, to link to it.
      {/if}
    </p>

    <div class="foot">
      <button class="btn-danger" onclick={del}>Delete dive</button>
      <button class="btn-primary" onclick={done}>Done</button>
    </div>
  </main>
{:else}
  <main class="wrap" style="padding-top:2rem"><p>This dive doesn't exist on this device.</p></main>
{/if}

<style>
  main { padding-bottom: 4rem; }
  h1 { margin: 1.5rem 0 1rem; overflow-wrap: anywhere; }
  .state { margin-right: 0.5rem; }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem 0.9rem;
  }
  .span2 { grid-column: span 2; }
  input[type="date"], input[type="time"] { min-width: 0; }
  code { font-size: 0.85em; }
  .field-error { color: var(--danger); font-weight: 600; font-size: 0.85rem; }
  .chips {
    display: flex;
    gap: 0.35rem;
    overflow-x: auto;
    padding: 0.15rem 0 0.1rem;
    scrollbar-width: none;
  }
  .chip {
    min-height: 36px;
    padding: 0.25rem 0.75rem 0.25rem 0.55rem;
    font-size: 0.9rem;
    color: var(--ink);
    flex-shrink: 0;
  }
  .chip i {
    width: 10px;
    height: 13px;
    background: var(--accent);
    clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
  }
  .foot {
    display: flex;
    justify-content: space-between;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--rule);
  }
</style>
