<script>
  // Depth over time from an imported dive computer profile.
  // One series, one axis (depth grows downward). Temperature has its own scale,
  // so it lives in the readout instead of a second axis.
  // Touch or hover scrubs a crosshair; arrow keys do the same when focused.

  /** @type {{ profile: { samples: [number, number, number | null][] }, compact?: boolean }} */
  let { profile, compact = false } = $props();

  const samples = $derived((profile?.samples || []).filter((s) => Array.isArray(s) && s.length >= 2));
  let width = $state(0);
  const height = $derived(compact ? 44 : 220);
  // bottom padding leaves a row for the deepest-point label above the time axis
  const pad = $derived(compact ? { l: 0, r: 0, t: 3, b: 3 } : { l: 34, r: 12, t: 12, b: 44 });

  const tMax = $derived(Math.max(60, samples.at(-1)?.[0] || 0));
  const dMax = $derived(Math.max(...samples.map((s) => s[1]), 1));
  const yTop = $derived(niceStep(dMax) * Math.ceil(dMax / niceStep(dMax))); // axis bottom value
  const deepest = $derived(samples.reduce((a, s) => (s[1] > a[1] ? s : a), samples[0] || [0, 0]));

  const x = (t) => pad.l + (t / tMax) * Math.max(1, width - pad.l - pad.r);
  const y = (d) => pad.t + (d / yTop) * (height - pad.t - pad.b);

  const line = $derived(samples.map((s) => `${x(s[0]).toFixed(1)},${y(s[1]).toFixed(1)}`).join(" "));
  const area = $derived(samples.length ? `${x(samples[0][0]).toFixed(1)},${y(0)} ${line} ${x(samples.at(-1)[0]).toFixed(1)},${y(0)}` : "");

  function niceStep(max) {
    for (const s of [1, 2, 5, 10, 20, 25, 50]) if (max / s <= 5) return s;
    return 100;
  }
  const depthTicks = $derived.by(() => {
    const step = niceStep(dMax);
    const out = [];
    for (let v = 0; v <= yTop + 1e-9; v += step) out.push(v);
    return out;
  });
  const timeTicks = $derived.by(() => {
    const min = tMax / 60;
    const step = [5, 10, 15, 20, 30, 60].find((s) => min / s <= (width < 420 ? 4 : 7)) || 60;
    const out = [];
    for (let m = 0; m <= min; m += step) out.push(m);
    return out;
  });

  // ---------- crosshair ----------
  let active = $state(-1);
  const point = $derived(active >= 0 ? samples[active] : null);

  function nearest(t) {
    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid][0] < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(samples[lo - 1][0] - t) < Math.abs(samples[lo][0] - t)) lo--;
    return lo;
  }
  function onPointer(e) {
    if (compact || !samples.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left - pad.l) / Math.max(1, width - pad.l - pad.r)) * tMax;
    active = nearest(Math.max(0, Math.min(tMax, t)));
  }
  function onKey(e) {
    if (!samples.length) return;
    const step = e.shiftKey ? 300 : 60;
    const t = point ? point[0] : 0;
    if (e.key === "ArrowRight") active = nearest(t + step);
    else if (e.key === "ArrowLeft") active = nearest(t - step);
    else if (e.key === "Home") active = 0;
    else if (e.key === "End") active = samples.length - 1;
    else if (e.key === "Escape") active = -1;
    else return;
    e.preventDefault();
  }

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const summary = $derived(
    samples.length
      ? `Depth profile: ${clock(samples.at(-1)[0])} long, deepest ${fmt(deepest[1])} m at ${clock(deepest[0])}.`
      : "No depth profile.",
  );
  const readout = $derived(
    point ? `${clock(point[0])}: ${fmt(point[1])} metres${point[2] != null ? `, ${fmt(point[2])} degrees` : ""}` : "Use the arrow keys to move through the dive",
  );
  // A coarse table for screen readers and anyone who prefers numbers.
  const tableRows = $derived.by(() => {
    if (compact) return [];
    const rows = [];
    for (let m = 0; m <= tMax / 60; m += 5) rows.push(samples[nearest(m * 60)]);
    return rows;
  });
</script>

<figure class="profile" class:compact>
  <div class="plot" bind:clientWidth={width} style:height={`${height}px`}>
    {#if width && samples.length}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <svg
        {width}
        {height}
        role={compact ? "img" : "slider"}
        aria-label={summary}
        aria-orientation={compact ? undefined : "horizontal"}
        aria-valuemin={compact ? undefined : 0}
        aria-valuemax={compact ? undefined : Math.round(samples.at(-1)[0])}
        aria-valuenow={compact ? undefined : Math.round(point ? point[0] : 0)}
        aria-valuetext={compact ? undefined : readout}
        tabindex={compact ? undefined : 0}
        onpointermove={onPointer}
        onpointerdown={onPointer}
        onpointerleave={(e) => e.pointerType === "mouse" && (active = -1)}
        onkeydown={onKey}
        onblur={() => (active = -1)}
      >
        {#if !compact}
          {#each depthTicks as v}
            <line class="grid" x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
            <text class="tick" x={pad.l - 6} y={y(v)} dy="0.32em" text-anchor="end">{v === 0 ? "0 m" : v}</text>
          {/each}
          {#each timeTicks as m}
            <text class="tick" x={x(m * 60)} y={height - 4} text-anchor={m === 0 ? "start" : "middle"}>{m}{m === 0 ? " min" : ""}</text>
          {/each}
        {/if}
        <polygon class="wash" points={area} />
        <polyline class="line" points={line} />
        {#if !compact}
          <!-- the one direct label: the deepest point -->
          <circle class="dot" cx={x(deepest[0])} cy={y(deepest[1])} r="4" />
          <text class="label" x={x(deepest[0])} y={y(deepest[1]) + 17} text-anchor={x(deepest[0]) > width - 60 ? "end" : x(deepest[0]) < 60 ? "start" : "middle"}>
            {fmt(deepest[1])} m
          </text>
          {#if point}
            <line class="cross" x1={x(point[0])} x2={x(point[0])} y1={pad.t} y2={height - pad.b} />
            <circle class="dot active" cx={x(point[0])} cy={y(point[1])} r="5" />
          {/if}
        {/if}
      </svg>
      {#if point}
        <div
          class="tip"
          style:left={`${Math.min(Math.max(x(point[0]), 70), width - 70)}px`}
          style:top={`${y(point[1]) > height / 2 ? Math.max(0, y(point[1]) - 58) : y(point[1]) + 14}px`}
        >
          <strong>{clock(point[0])}</strong>
          <span>{fmt(point[1])} m{point[2] != null ? `, ${fmt(point[2])} °C` : ""}</span>
        </div>
      {/if}
    {/if}
  </div>
  {#if !compact}
    <details class="table">
      <summary>Profile as a table</summary>
      <table>
        <thead><tr><th scope="col">Time</th><th scope="col">Depth</th><th scope="col">Water</th></tr></thead>
        <tbody>
          {#each tableRows as r}
            <tr><td>{clock(r[0])}</td><td>{fmt(r[1])} m</td><td>{r[2] != null ? `${fmt(r[2])} °C` : ""}</td></tr>
          {/each}
        </tbody>
      </table>
    </details>
  {/if}
</figure>

<style>
  .profile { margin: 0; }
  .plot {
    position: relative;
    width: 100%;
  }
  svg {
    display: block;
    overflow: visible;
    touch-action: pan-y; /* vertical swipes still scroll the page */
    outline: none;
  }
  svg:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; border-radius: 4px; }
  .grid { stroke: var(--rule); stroke-width: 1; }
  .tick { font: 500 11px var(--font-ui); fill: var(--ink-2); }
  .wash { fill: var(--water); opacity: 0.1; }
  .line { fill: none; stroke: var(--water); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .compact .line { stroke-width: 1.5; }
  .dot { fill: var(--water); stroke: var(--surface); stroke-width: 2; }
  .label { font: 700 12px var(--font-ui); fill: var(--ink); }
  .cross { stroke: var(--ink-2); stroke-width: 1; }
  .tip {
    position: absolute;
    transform: translateX(-50%);
    pointer-events: none;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius-s);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
    padding: 0.3rem 0.55rem;
    font-size: 0.85rem;
    white-space: nowrap;
    display: grid;
    line-height: 1.3;
  }
  .table { margin-top: 0.4rem; font-size: 0.85rem; color: var(--ink-2); }
  .table summary { cursor: pointer; width: fit-content; }
  .table table { border-collapse: collapse; margin-top: 0.4rem; }
  .table th, .table td { text-align: right; padding: 0.15rem 0.9rem 0.15rem 0; font-variant-numeric: tabular-nums; }
  .table th { font-weight: 600; }
</style>
