<script>
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import { createRenderer } from "../lib/refs.js";

  /** @type {{ text?: string, refs?: Map<string, any>, hrefFor?: (ref: any) => string, onRef?: (ref: any, e: MouseEvent) => void }} */
  let { text = "", refs, hrefFor, onRef } = $props();

  const md = $derived(refs?.size && hrefFor ? createRenderer(refs, hrefFor) : null);
  // breaks: true keeps wetnotes-style line-by-line logs as written
  const html = $derived(
    DOMPurify.sanitize(md ? md.parse(text || "") : marked.parse(text || "", { breaks: true, gfm: true })),
  );

  function click(e) {
    const a = e.target.closest?.("a.mref");
    if (!a || !onRef) return;
    const ref = [...refs.values()].find((r) => r.markerId === a.dataset.marker);
    if (ref) onRef(ref, e);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="prose" onclick={click}>{@html html}</div>
