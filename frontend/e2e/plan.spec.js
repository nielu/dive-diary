import { test, expect, FIX, newPage, signIn, ownerApi, uniq, shareToken } from "./helpers.js";

test("the map editor shows the navigation plan, jumps to referenced markers and places missing ones", async ({ page, browser }) => {
  const api = await ownerApi();
  const trip = uniq("Plan trip");
  const dive = await api.post("/api/collections/dives/records", {
    date: "2026-11-02", trip, site: "Sistema Plan",
    navigation: "#T1 left onto the upstream line\nJump at #J5 to the side passage\nTurn at #3 or thirds",
  });
  const markers = [
    { id: "m1", x: 0.25, y: 0.45, label: "T1", note: "T-junction" },
    { id: "m3", x: 0.62, y: 0.42, label: "3", note: "Restriction, turn here" },
  ];
  const map = await api.upload("maps", { dive: dive.id, caption: "Plan map", sort: 0, width: 2400, height: 1600, markers, route: [] }, `${FIX}/map.png`);

  await signIn(page);
  await page.goto(`/#/dive/${dive.id}/map/${map.id}`);
  const panel = page.getByRole("region", { name: "Navigation plan" });
  await expect(panel).toContainText("Jump at #J5 to the side passage"); // open by default for the owner
  await expect(page.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-expanded", "true");

  // a reference jumps to its marker on this map
  await panel.locator("a.mref", { hasText: /^3$/ }).click();
  await expect(page.locator(".line-arrow.selected")).toHaveText("3");
  await expect(page.getByText("Restriction, turn here")).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe(`#/dive/${dive.id}/map/${map.id}`);
  await page.getByRole("button", { name: "Close" }).click();

  // in Markers mode, labels the plan mentions but no map has can be placed
  await page.getByRole("radio", { name: "Markers" }).click();
  const chips = panel.locator(".unplaced .chip");
  await expect(chips).toHaveText(["J5"]);
  await chips.first().click();
  await expect(page.getByText("Tap the map to place J5.")).toBeVisible();
  const box = await page.locator(".leaflet-image-layer").boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.75);
  await expect(page.locator(".line-arrow", { hasText: /^J5$/ })).toHaveCount(1);
  await expect(page.getByLabel("Label")).toHaveValue("J5");
  await expect(panel.locator(".unplaced")).toHaveCount(0); // nothing left to place
  await expect(panel.locator("a.mref", { hasText: "J5" })).toBeVisible(); // and the plan now links it
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("radio", { name: "View" }).click();
  await expect.poll(async () => (await api.get(`/api/collections/maps/records/${map.id}`)).markers.map((m) => m.label).sort(), { timeout: 15_000 }).toEqual(["3", "J5", "T1"]);

  // closing the panel is remembered
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(panel).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".line-arrow")).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Navigation plan" })).toHaveCount(0);

  // family: the plan is there to read, closed until asked for, no editing
  const token = shareToken();
  await api.post("/api/collections/shares/records", { token, trip, label: "Plan family" });
  const fam = await newPage(browser);
  await fam.goto(`/#/s/${token}/dive/${dive.id}/map/${map.id}`);
  await expect(fam.locator(".line-arrow")).toHaveCount(3);
  await expect(fam.getByRole("region", { name: "Navigation plan" })).toHaveCount(0);
  await fam.getByRole("button", { name: "Plan" }).click();
  const famPanel = fam.getByRole("region", { name: "Navigation plan" });
  await expect(famPanel).toContainText("Turn at #3 or thirds".replace("#3", "3"));
  await expect(famPanel.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(famPanel.locator(".unplaced")).toHaveCount(0);
});
