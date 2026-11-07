<script>
  import { app, start } from "./lib/app.svelte.js";
  import { route } from "./lib/router.svelte.js";
  import Login from "./components/Login.svelte";
  import DiveList from "./components/DiveList.svelte";
  import DivePage from "./components/DivePage.svelte";
  import DiveEdit from "./components/DiveEdit.svelte";
  import OwnerMap from "./components/OwnerMap.svelte";
  import OwnerTour from "./components/OwnerTour.svelte";
  import ImportPage from "./components/ImportPage.svelte";
  import SharesPage from "./components/SharesPage.svelte";
  import ShareApp from "./components/ShareApp.svelte";

  let started = false;
  $effect(() => {
    if (!route.share && app.user && !started) {
      started = true;
      start();
    }
  });
</script>

{#if route.share}
  <ShareApp token={route.share} />
{:else if !app.user}
  <Login />
{:else if !app.ready}
  <p class="wrap muted" style="padding-top:3rem">Loading your dives…</p>
{:else if route.name === "dive"}
  <DivePage id={route.params.dive} />
{:else if route.name === "edit"}
  <DiveEdit id={route.params.dive} />
{:else if route.name === "tour"}
  <OwnerTour diveId={route.params.dive} />
{:else if route.name === "map"}
  <OwnerMap diveId={route.params.dive} mapId={route.params.map} focusMarker={route.query.m || ""} />
{:else if route.name === "import"}
  <ImportPage />
{:else if route.name === "shares"}
  <SharesPage />
{:else}
  <DiveList trip={route.params.trip} />
{/if}
