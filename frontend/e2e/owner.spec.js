import { test, expect, FIX, newPage, chooseFiles, uniq } from "./helpers.js";

test("log a dive with a map, markers, route and photos; work offline; share it", async ({ page, browser, context }) => {
  const trip = uniq("Owner trip");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // sign in, wrong password first
  await page.goto("/");
  await page.getByLabel("Email").fill("me@example.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("wrong");
  await page.getByLabel("Password").fill("testpass123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "All dives" })).toBeVisible();

  // new dive
  await page.getByRole("button", { name: "New dive" }).click();
  await page.getByLabel("Site").fill("Cenote Dos Ojos");
  await page.getByLabel("Date").fill("2026-11-04");
  await page.getByLabel("Time in").fill("09:40");
  await page.getByLabel("Trip").fill(trip);
  await page.getByLabel("Team").fill("Nielu, Marta, Tomek");
  await page.getByLabel("Led by").fill("Marta");
  await page.getByLabel("Max depth (m)").fill("9.8");
  await page.getByLabel("Avg depth (m)").fill("6.2");
  await page.getByLabel("Water temp (°C)").fill("24.5");
  await page.getByLabel("Run time (min)").fill("96");
  await page.getByLabel("Navigation").fill("T1: left onto the Barbie line\nJump at arrow 3 to the blue line (gap 4 m)");
  await page.getByLabel("Log and comments").fill("Great vis, **30 m+** in the main line.\n- Halocline at 8 m");
  await expect(page.getByText("Saved on device")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.getByRole("heading", { name: "Cenote Dos Ojos" })).toBeVisible();
  await expect(page.locator(".prose strong")).toHaveText("30 m+");

  // map
  await chooseFiles(page, "Add map", `${FIX}/map.png`);
  await expect(page.getByText("Untitled map")).toBeVisible();

  // markers
  await page.getByRole("link", { name: /Open map/ }).click();
  await page.getByRole("radio", { name: "Markers" }).click();
  const box = await page.locator(".leaflet-image-layer").boundingBox();
  const at = (fx, fy) => page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  for (const [i, [fx, fy]] of [[0.25, 0.45], [0.45, 0.5], [0.62, 0.42]].entries()) {
    await at(fx, fy);
    if (i === 0) {
      await page.getByLabel("Label").fill("T1");
      await page.getByLabel("Note").fill("Go left, cookie placed");
      await page.getByRole("button", { name: "Done" }).click();
    }
  }
  await expect(page.locator(".line-arrow")).toHaveCount(3);
  await page.getByLabel("Map caption").fill("Main line, north section");

  // route through the markers plus free points, with undo and a second line
  await page.getByRole("radio", { name: "Route" }).click();
  await at(0.08, 0.5);
  for (const m of await page.locator(".line-arrow").all()) await m.click();
  await at(0.8, 0.35);
  await expect(page.locator(".vertex")).toHaveCount(5);
  await page.getByRole("button", { name: "Undo point" }).click();
  await expect(page.locator(".vertex")).toHaveCount(4);
  await page.getByRole("button", { name: "New line" }).click();
  await at(0.45, 0.5);
  await at(0.5, 0.7);
  await page.getByRole("radio", { name: "View" }).click();
  await page.getByRole("button", { name: /List \(3\)/ }).click();
  await page.locator(".sheet.list button", { hasText: "T1" }).click();
  await expect(page.getByText("Go left, cookie placed")).toBeVisible();
  await page.getByRole("link", { name: "Back to dive" }).click();

  // photo, then sync
  await chooseFiles(page, "Add photos", `${FIX}/photo0.jpg`);
  await expect(page.locator(".grid img")).toHaveCount(1);
  await expect(page.locator("button.sync")).toHaveText(/Synced/, { timeout: 20_000 });

  // offline: the app opens, a new dive is saved, the map still loads
  await page.waitForTimeout(1500); // let the offline cache warm up
  await context.setOffline(true);
  await page.goto("/#/");
  await page.reload();
  await expect(page.getByRole("heading", { name: "All dives" })).toBeVisible();
  await page.getByRole("button", { name: "New dive" }).click();
  await page.getByLabel("Site").fill("Cenote Taj Mahal");
  await page.getByLabel("Date").fill("2026-11-05");
  await page.getByLabel("Trip").fill(trip);
  await page.getByLabel("Max depth (m)").fill("14");
  await expect(page.getByText("Saved on device")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).first().click();
  await page.goto("/#/");
  await expect(page.getByRole("link", { name: /Cenote Taj Mahal/ })).toContainText("not synced");
  await expect(page.locator("button.sync")).toContainText("Offline");

  await page.getByRole("link", { name: /Cenote Dos Ojos/ }).first().click();
  await page.getByRole("link", { name: /Open map/ }).click();
  await expect(page.locator(".leaflet-image-layer")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator(".failed")).toHaveCount(0);
  expect(await page.locator(".leaflet-image-layer").evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Back to dive" }).click();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("button.sync")).toHaveText(/Synced/, { timeout: 20_000 });

  // share link for the trip
  await page.goto("/#/shares");
  await page.evaluate(() => (navigator.share = undefined));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByLabel("What to share").selectOption({ label: `${trip} (2 dives)` });
  await page.getByLabel("Name for the link").fill("Mexico for the family");
  await page.getByRole("button", { name: "Create link" }).click();
  const row = page.locator("li", { hasText: "Mexico for the family" });
  await expect(row).toBeVisible();
  const href = await row.getByRole("link", { name: "Preview" }).getAttribute("href");
  const token = href.split("/s/")[1];

  // family view: logged out, read-only
  const fam = await newPage(browser);
  await fam.goto(`/#/s/${token}`);
  await expect(fam.getByRole("heading", { name: "Mexico for the family" })).toBeVisible();
  await expect(fam.getByRole("link", { name: /Taj Mahal/ })).toBeVisible();
  await fam.getByRole("link", { name: /Dos Ojos/ }).click();
  await expect(fam.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(fam.getByText("Add map")).toHaveCount(0);
  const thumb = fam.locator(".grid img").first();
  await expect(thumb).toHaveAttribute("src", new RegExp(`/api/share/${token}/file/photos/`));
  await expect.poll(() => thumb.evaluate((img) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await fam.getByRole("link", { name: /Open map/ }).click();
  await expect(fam.locator(".line-arrow")).toHaveCount(3);
  await expect(fam.getByRole("radio", { name: "Markers" })).toHaveCount(0);
  await fam.goto(`/#/s/${"x".repeat(32)}`);
  await expect(fam.getByRole("heading", { name: "Link unavailable" })).toBeVisible();

  expect(errors).toEqual([]);
});
