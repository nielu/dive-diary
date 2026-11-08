import { test, expect, FIX, newPage, signIn, ownerApi, uniq, shareToken } from "./helpers.js";

async function scrollToBlock(page, selector, index = 0, frac = 0.5) {
  await page.evaluate(
    ([sel, i, f]) => {
      const el = document.querySelectorAll(sel)[i];
      window.scrollTo(0, el.offsetTop + el.offsetHeight * f - innerHeight / 2);
    },
    [selector, index, frac],
  );
  await page.waitForTimeout(1200);
}

test("follow the route: waypoints, photos on markers, read-only tour", async ({ page, browser }) => {
  const api = await ownerApi();
  const trip = uniq("Tour trip");
  const dive = await api.post("/api/collections/dives/records", {
    date: "2026-11-03", time: "10:15", trip, site: "Sistema Tour",
    team: "Nielu, Marta", leader: "Nielu", max_depth: 16.4, avg_depth: 9.1, temp: 25, duration: 88,
    navigation: "Main line upstream to T1, left.\nJump at arrow 3 to the side passage.",
    log: "Turned at the restriction past waypoint 3 on gas.",
  });
  const pics = [];
  for (let i = 0; i < 3; i++) {
    pics.push((await api.upload("photos", { dive: dive.id, caption: `Photo ${i + 1}`, sort: i }, `${FIX}/photo${i}.jpg`)).id);
  }
  const markers = [
    { id: "m1", x: 0.25, y: 0.45, label: "T1", note: "T-junction. Left onto the upstream line.", photos: [pics[0]] },
    { id: "m2", x: 0.45, y: 0.5, label: "2", note: "Arrow 3. Jump to the side passage." },
    { id: "m3", x: 0.62, y: 0.42, label: "3", note: "Restriction. Turned here.", photos: [pics[2]] },
    { id: "m4", x: 0.1, y: 0.9, label: "X", note: "Off route" },
  ];
  const route = [
    [{ x: 0.06, y: 0.5 }, { x: 0.25, y: 0.45 }, { x: 0.45, y: 0.5 }, { x: 0.62, y: 0.42 }],
    [{ x: 0.45, y: 0.5 }, { x: 0.5, y: 0.7 }],
  ];
  const map = await api.upload("maps", { dive: dive.id, caption: "Main line", sort: 0, width: 2400, height: 1600, markers, route }, `${FIX}/map.png`);
  const token = shareToken();
  await api.post("/api/collections/shares/records", { token, trip, label: "Tour family" });

  // owner attaches a dive photo to marker 2
  await signIn(page);
  await page.getByRole("link", { name: /Sistema Tour/ }).click();
  await expect(page.getByRole("link", { name: "Follow the route" })).toBeVisible();
  await page.getByRole("link", { name: /Open map/ }).click();
  await page.getByRole("radio", { name: "Markers" }).click();
  await page.locator(".line-arrow", { hasText: /^2$/ }).click();
  await expect(page.locator(".strip .thumb[aria-pressed]")).toHaveCount(3);
  await page.locator(".strip .thumb[aria-pressed]").nth(1).click();
  await expect(page.locator(".strip .thumb[aria-pressed='true']")).toHaveCount(1);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".line-arrow.has-photos")).toHaveCount(3);
  await page.getByRole("radio", { name: "View" }).click();
  await expect
    .poll(async () => (await api.get(`/api/collections/maps/records/${map.id}`)).markers.find((m) => m.id === "m2").photos, { timeout: 15_000 })
    .toEqual([pics[1]]);

  // family: the tour on a phone
  const fam = await newPage(browser);
  const errors = [];
  fam.on("pageerror", (e) => errors.push(e.message));
  await fam.goto(`/#/s/${token}/dive/${dive.id}`);
  await fam.getByRole("link", { name: "Follow the route" }).click();
  await expect(fam.getByRole("heading", { name: "Sistema Tour" })).toBeVisible();
  await expect(fam.locator("section.stop")).toHaveCount(3); // the off-route marker has no card
  // the background map starts light and becomes the full map once downloaded
  const bg = fam.locator(".world img");
  await expect(bg).not.toHaveAttribute("src", /thumb=/);
  await expect.poll(() => bg.evaluate((i) => i.complete && i.naturalWidth)).toBe(2400);

  await scrollToBlock(fam, "section.travel", 0, 0.6);
  await expect(fam.locator(".diver")).toHaveCount(1);

  await scrollToBlock(fam, "section.stop", 0);
  await expect(fam.locator(".stop-card").nth(0)).toContainText("T-junction");
  await expect(fam.locator(".arrow.current text")).toHaveText("T1");

  await scrollToBlock(fam, "section.stop", 2);
  await expect(fam.locator(".arrow.current text")).toHaveText("3");
  expect(Number(await fam.locator(".progress").getAttribute("aria-valuenow"))).toBeGreaterThan(50);

  const cardPhoto = fam.locator(".stop-card").nth(2).locator(".grid img").first();
  await expect.poll(() => cardPhoto.evaluate((img) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await fam.locator(".stop-card").nth(2).locator(".grid button").first().click();
  await expect(fam.getByRole("dialog", { name: "Photo" })).toBeVisible();
  await fam.getByRole("button", { name: "Close" }).click();

  await scrollToBlock(fam, "section.outro", 0, 0.5);
  await expect(fam.getByRole("heading", { name: "End of the route" })).toBeVisible();
  await fam.getByRole("button", { name: "Start again" }).click();
  await expect.poll(() => fam.evaluate(() => scrollY)).toBeLessThan(5);

  // desktop layout
  const desk = await newPage(browser, { viewport: { width: 1366, height: 860 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  await desk.goto(`/#/s/${token}/dive/${dive.id}/tour`);
  await expect(desk.getByRole("heading", { name: "Sistema Tour" })).toBeVisible();
  await scrollToBlock(desk, "section.stop", 0);
  await expect(desk.locator(".arrow.current text")).toHaveText("T1");

  expect(errors).toEqual([]);
});
