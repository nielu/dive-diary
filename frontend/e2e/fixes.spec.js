// One test per fix from the November 2026 review.
import { test, expect, FIX, newPage, signIn, ownerApi, uniq, shareToken, chooseFiles, triggerSync, devices } from "./helpers.js";

test("a dive can't lose its date, and text is capped at what the server accepts", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New dive" }).click();
  const site = uniq("Capped") + " " + "x".repeat(250);
  await page.getByLabel("Site").fill(site);
  await expect(page.getByLabel("Site")).toHaveValue(site.slice(0, 200));
  await page.getByLabel("Date").fill("");
  await expect(page.getByText("A dive needs a date.")).toBeVisible();
  await page.getByLabel("Site").click(); // leave the date field
  await expect(page.getByLabel("Date")).not.toHaveValue("");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.locator("button.sync")).toHaveText(/Synced/, { timeout: 20_000 });
});

test("a change the server rejects is listed with the reason, holds back its photos, and syncs once fixed", async ({ page }) => {
  const api = await ownerApi();
  const diveId = Math.random().toString(36).slice(2, 10).padEnd(15, "0").slice(0, 15);
  await signIn(page);
  // A dive saved without a date (possible before this fix) sitting on the device.
  await page.evaluate(async (rec) => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("dive-diary");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("dives", "readwrite");
        tx.objectStore("dives").put(rec);
        tx.oncomplete = () => (open.result.close(), resolve());
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { id: diveId, collectionName: "dives", date: "", time: "", trip: uniq("Broken trip"), site: "Sistema Broken", team: "", leader: "", max_depth: 0, avg_depth: 0, temp: 0, duration: 0, navigation: "", log: "", _dirty: true, _rev: 1, _onServer: false, _deleted: false });
  const photoUploads = [];
  page.on("request", (r) => r.method() === "POST" && r.url().includes("/api/collections/photos/records") && photoUploads.push(r.url()));
  await page.goto(`/#/dive/${diveId}`);
  await page.reload();
  await chooseFiles(page, "Add photos or clips", `${FIX}/photo1.jpg`);
  await expect(page.locator(".grid img")).toHaveCount(1);

  const status = page.locator("button.sync");
  await expect(status).toHaveText("1 couldn't sync", { timeout: 20_000 });
  for (let i = 0; i < 2; i++) {
    await triggerSync(page);
    await page.waitForTimeout(1500);
  }
  expect(photoUploads).toEqual([]); // the photo isn't re-sent while its dive is stuck

  await status.click();
  const panel = page.getByRole("dialog", { name: "Changes that didn't sync" });
  await expect(panel).toContainText("Sistema Broken");
  await expect(panel).toContainText("Date: Cannot be blank.");
  await expect(panel).toContainText("1 map or photo is waiting for their dive to sync.");
  await panel.getByRole("link", { name: "Fix" }).click();

  await page.getByLabel("Date").fill("2026-11-02");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(status).toHaveText(/Synced/, { timeout: 20_000 });
  const photos = await api.get(`/api/collections/photos/records?filter=${encodeURIComponent(`dive="${diveId}"`)}`);
  expect(photos.items).toHaveLength(1);
});

test("a dropped connection mid-sync reads as offline, not as an error", async ({ browser }) => {
  const page = await newPage(browser, { serviceWorkers: "block" });
  await signIn(page);
  await expect(page.locator("button.sync")).toHaveText(/Synced/, { timeout: 20_000 });
  await page.context().route("**/api/**", (r) => r.abort("internetdisconnected"));
  await triggerSync(page);
  await expect(page.locator("button.sync")).toHaveText(/Offline/);
  await page.locator("button.sync").click(); // nothing to list, so it just tries again
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("turning off a share link stops its images, and image files aren't public", async ({ browser }) => {
  const api = await ownerApi();
  const trip = uniq("Revoke trip");
  const dive = await api.post("/api/collections/dives/records", { date: "2026-11-01", trip, site: "Cenote Revoke" });
  const photo = await api.upload("photos", { dive: dive.id, sort: 0 }, `${FIX}/photo2.jpg`);
  const token = shareToken();
  const share = await api.post("/api/collections/shares/records", { token, trip, label: "Revoke test" });

  const fam = await newPage(browser);
  await fam.goto(`/#/s/${token}/dive/${dive.id}`);
  const img = fam.locator(".grid img").first();
  await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  const src = new URL(await img.getAttribute("src"), fam.url()).href;
  expect((await fam.request.get(`/api/files/photos/${photo.id}/${photo.image}`)).status()).toBe(404);

  await api.del(`/api/collections/shares/records/${share.id}`);
  expect((await fam.request.get(src)).status()).toBe(404);
  await fam.reload();
  await expect(fam.getByRole("heading", { name: "Link unavailable" })).toBeVisible();
});

test("a full-size photo that can't load offline falls back to the thumbnail", async ({ browser }) => {
  const api = await ownerApi();
  const dive = await api.post("/api/collections/dives/records", { date: "2026-11-01", trip: uniq("Lightbox trip"), site: "Cenote Lightbox" });
  await api.upload("photos", { dive: dive.id, sort: 0 }, `${FIX}/photo0.jpg`);
  const page = await newPage(browser, { serviceWorkers: "block" });
  await page.context().route(/\/api\/files\/photos\//, (r) => (r.request().url().includes("thumb=") ? r.continue() : r.abort("internetdisconnected")));
  await signIn(page);
  await page.goto(`/#/dive/${dive.id}`);
  await page.locator(".grid button").first().click();
  const shown = page.getByRole("dialog", { name: "Photo" }).locator(".stage img");
  await expect(shown).toHaveAttribute("src", /thumb=480x480f/);
  await expect(page.getByText("Full size isn't available offline.")).toBeVisible();
});

test("a share link's end date is the end of that day where you are", async ({ browser }) => {
  const api = await ownerApi();
  const trip = uniq("Expiry trip");
  await api.post("/api/collections/dives/records", { date: "2026-11-01", trip, site: "Cenote Expiry" });
  const page = await newPage(browser, { timezoneId: "America/Cancun", locale: "en-US" });
  await signIn(page);
  await page.goto("/#/shares");
  await page.evaluate(() => (navigator.share = undefined));
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const label = uniq("Expiring link");
  await page.getByLabel("What to share").selectOption({ label: `${trip} (1 dives)` });
  await page.getByLabel("Name for the link").fill(label);
  await page.getByLabel("Stops working after (optional)").fill("2026-12-10");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.locator("li", { hasText: label })).toContainText("until Dec 10, 2026");
  const rec = await api.get(`/api/collections/shares/records?filter=${encodeURIComponent(`label="${label}"`)}`);
  expect(rec.items[0].expires).toBe("2026-12-11 04:59:59.999Z");
});

test("iPhone Safari shows the Home Screen tip until dismissed", async ({ browser }) => {
  const page = await newPage(browser, { ...devices["iPhone 13"], defaultBrowserType: undefined });
  await signIn(page);
  const tip = page.getByRole("complementary", { name: "Install tip" });
  await expect(tip).toContainText("Add Dive diary to your Home Screen");
  await tip.getByRole("button", { name: "Got it" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "All dives" })).toBeVisible();
  await expect(tip).toHaveCount(0);
});

test("text on orange buttons is dark for contrast", async ({ page }) => {
  await signIn(page);
  const color = await page.getByRole("button", { name: "New dive" }).evaluate((b) => getComputedStyle(b).color);
  expect(color).toBe("rgb(11, 31, 38)");
});

test("five wrong passwords from one address get a wait-a-minute message", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto("/");
  await page.getByLabel("Email").fill("me@example.com");
  for (let i = 0; i < 5; i++) {
    await page.getByLabel("Password").fill(`wrong-${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("wrong");
  }
  await page.getByLabel("Password").fill("testpass123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Too many sign-in attempts");
});
