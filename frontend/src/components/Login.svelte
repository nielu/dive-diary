<script>
  import { signIn } from "../lib/app.svelte.js";

  let email = $state("");
  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  async function submit(e) {
    e.preventDefault();
    error = "";
    busy = true;
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      error = !navigator.onLine
        ? "You're offline. Sign in once with a connection; after that the app works without one."
        : err?.status === 400
          ? "Email or password is wrong."
          : err?.message || "Couldn't sign in.";
    } finally {
      busy = false;
    }
  }
</script>

<main class="wrap login">
  <div class="mark" aria-hidden="true"><span></span></div>
  <h1>Dive diary</h1>
  <p class="muted">Logs, cave maps and routes. Works offline after the first sign-in.</p>

  <form onsubmit={submit}>
    <label class="field">Email
      <input type="email" autocomplete="username" bind:value={email} required />
    </label>
    <label class="field">Password
      <input type="password" autocomplete="current-password" bind:value={password} required />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </form>
</main>

<style>
  .login {
    max-width: 380px;
    padding-top: 18vh;
    display: grid;
    gap: 0.75rem;
  }
  .mark {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
  }
  .mark span {
    display: block;
    width: 36px;
    height: 46px;
    background: var(--accent);
    clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
  }
  h1 { font-size: 2.75rem; }
  form {
    display: grid;
    gap: 1rem;
    margin-top: 1.25rem;
  }
  .error { color: var(--danger); margin: 0; }
</style>
