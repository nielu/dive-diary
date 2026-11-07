<script>
  // iPhone/iPad in Safari only: offline data in a Safari tab can be cleared
  // after a week without a visit; the Home Screen app keeps it.
  const KEY = "dd:installHintDismissed";
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  let dismissed = $state(readDismissed());

  function readDismissed() {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  }
  function dismiss() {
    dismissed = true;
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  }
</script>

{#if isIOS && !standalone && !dismissed}
  <aside class="hint" aria-label="Install tip">
    <p>
      <strong>Add Dive diary to your Home Screen.</strong>
      Safari can clear offline dives after a week without a visit; the Home Screen app keeps them.
      Tap <b>Share</b>, then <b>Add to Home Screen</b>, and sign in there.
    </p>
    <button onclick={dismiss}>Got it</button>
  </aside>
{/if}

<style>
  .hint {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-top: 1rem;
    padding: 0.8rem 0.9rem;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-left: 4px solid var(--water);
    border-radius: var(--radius-s);
  }
  p { margin: 0; font-size: 0.92rem; }
  button { flex-shrink: 0; }
</style>
