import { test, expect, FIX, newPage, signIn, ownerApi, uniq, shareToken } from "./helpers.js";

const FIT = new URL("../tests/fixtures/", import.meta.url).pathname;

async function chooseOn(page, label, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByText(label, { exact: true }).click()]);
  await chooser.setFiles(files);
}

test("import a Garmin dive as a new dive, with profile, and skip it on re-import", async ({ page, browser }) => {
  const api = await ownerApi();
  const site = uniq("Cenote Calimba");
  const trip = uniq("Import trip");
  await signIn(page);
  await page.getByRole("link", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: "Import dives" })).toBeVisible();

  // one dive file and one that isn't
  await chooseOn(page, "Choose .fit files", [`${FIT}synthetic-dive.fit`, `${FIX}/photo0.jpg`]);
  const item = page.locator("li.new");
  await expect(item).toContainText("Saturday, March 14, 2026, 10:05, dive 42");
  await expect(item).toContainText("21.3 m max");
  await expect(item).toContainText("53 min");
  await expect(item).toContainText("EAN32");
  await expect(item.getByRole("img", { name: /Depth profile/ })).toBeVisible();
  await expect(item.getByLabel("Site")).toHaveValue("synthetic-dive");
  await expect(page.locator("li.error")).toContainText("This isn't a Garmin .fit file.");

  await item.getByLabel("Site").fill(site);
  await item.getByLabel("Trip").fill(trip);
  await page.getByRole("button", { name: "Import 1 dive" }).click();

  await expect(page.getByRole("heading", { name: site })).toBeVisible();
  await expect(page.getByText("dive 42")).toBeVisible();
  await expect(page.locator(".stats")).toContainText("21.3");
  await expect(page.getByText("Recorded by Garmin Descent Mk3i")).toBeVisible();
  await expect(page.locator(".team")).toContainText("EAN32");

  // the chart scrubs with keys and touch
  const chart = page.getByRole("slider", { name: /Depth profile/ });
  await chart.focus();
  await chart.press("ArrowRight");
  await expect(chart).toHaveAttribute("aria-valuetext", /^0:5\d: [\d.]+ metres, 25 degrees$/); // nearest recorded point to 1:00
  const box = await chart.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.locator(".tip")).toContainText(" m, ");

  // synced, profile included
  await expect(page.locator("button.sync")).toHaveText(/Synced/, { timeout: 20_000 });
  const rec = (await api.get(`/api/collections/dives/records?filter=${encodeURIComponent(`site="${site}"`)}`)).items[0];
  expect(rec.source).toBe("garmin:1773500700");
  expect(rec.profile.samples.length).toBeLessThanOrEqual(360);

  // the same file again is recognised
  await page.goto("/#/import");
  await chooseOn(page, "Choose .fit files", `${FIT}synthetic-dive.fit`);
  await expect(page.locator("li.duplicate")).toContainText(`Already in your log as ${site}`);
  await expect(page.getByRole("button", { name: "Import 0 dives" })).toBeDisabled();

  // family sees the profile too
  const token = shareToken();
  await api.post("/api/collections/shares/records", { token, trip, label: "Import family" });
  const fam = await newPage(browser);
  await fam.goto(`/#/s/${token}/dive/${rec.id}`);
  await expect(fam.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(fam.getByRole("slider", { name: /deepest 21.3 m/ })).toBeVisible();
});

test("a file added to a hand-written dive fills in the numbers and keeps the notes", async ({ page }) => {
  const api = await ownerApi();
  const site = uniq("Hand-written");
  const dive = await api.post("/api/collections/dives/records", { date: "2026-03-15", time: "11:10", site, trip: uniq("Fill trip"), log: "My own notes", max_depth: 18 });
  await signIn(page);
  await page.goto(`/#/dive/${dive.id}`);
  await expect(page.getByRole("heading", { name: site })).toBeVisible();
  await chooseOn(page, "Add Garmin .fit file", `${FIT}synthetic-dive-2.fit`);

  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.locator(".when")).toContainText("11:00, dive 43");
  await expect(page.locator(".stats")).toContainText("17");
  await expect(page.locator(".team")).toContainText("Air");
  await expect(page.getByText("My own notes")).toBeVisible();
  await expect(page.getByRole("heading", { name: site })).toBeVisible();
  await expect(page.locator("button.sync")).toHaveText(/Synced/, { timeout: 20_000 });
  expect((await api.get(`/api/collections/dives/records/${dive.id}`)).dive_no).toBe(43);

  // and the import page now treats that file as done
  await page.goto("/#/import");
  await chooseOn(page, "Choose .fit files", `${FIT}synthetic-dive-2.fit`);
  await expect(page.locator("li.duplicate")).toContainText(site);
});

test("the import page fills a hand-written dive from the same day and time", async ({ page }) => {
  const api = await ownerApi();
  const site = uniq("Morning dive");
  const dive = await api.post("/api/collections/dives/records", { date: "2026-03-16", time: "09:40", site, trip: uniq("Match trip"), log: "Kept" });
  await signIn(page);
  await page.goto("/#/import");
  await chooseOn(page, "Choose .fit files", `${FIT}synthetic-dive-3.fit`);
  const li = page.locator("li.fill");
  await expect(li).toContainText(`Adds the computer's numbers and profile to ${site} (09:40)`);
  await expect(li.getByLabel("Site")).toHaveCount(0); // nothing to name: it's your dive
  await page.getByRole("button", { name: "Import 1 dive" }).click();
  await expect(page.getByRole("heading", { name: site })).toBeVisible();
  await expect(page.locator(".when")).toContainText("9:30, dive 44");
  await expect(page.getByText("Kept")).toBeVisible();
  await expect(page.locator("button.sync")).toHaveText(/Synced/, { timeout: 20_000 });
  expect((await api.get(`/api/collections/dives/records/${dive.id}`)).source).toBe("garmin:1773671400");
});
