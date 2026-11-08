import { test, expect, FIX, newPage, signIn, ownerApi, uniq, shareToken } from "./helpers.js";

test("#T1 references link to markers on the dive page, the editor and the tour", async ({ page, browser }) => {
  const api = await ownerApi();
  const trip = uniq("Refs trip");
  const nav = [
    "#T1 left onto the upstream line, cookie placed",
    "Jump at #2 to the side passage (4 m gap)",
    "Turn at #3 or thirds, whichever first",
    "Exit via the second sheet, checkpoint #b1",
    "Note the old line at #X, don't follow it. Dive #99 of the year.",
  ].join("\n");
  const dive = await api.post("/api/collections/dives/records", { date: "2026-11-03", trip, site: "Sistema Refs", navigation: nav, log: "Turned at **#3** on gas." });
  const markers = [
    { id: "m1", x: 0.25, y: 0.45, label: "T1", note: "T-junction, cookie placed." },
    { id: "m2", x: 0.45, y: 0.5, label: "2", note: "Jump to the side passage." },
    { id: "m3", x: 0.62, y: 0.42, label: "3", note: "Restriction. Turned here." },
    { id: "m4", x: 0.1, y: 0.9, label: "X", note: "Old line, don't follow." },
  ];
  const route = [[{ x: 0.06, y: 0.5 }, { x: 0.25, y: 0.45 }, { x: 0.45, y: 0.5 }, { x: 0.62, y: 0.42 }]];
  const mapA = await api.upload("maps", { dive: dive.id, caption: "Main line", sort: 0, width: 2400, height: 1600, markers, route }, `${FIX}/map.png`);
  const mapB = await api.upload(
    "maps",
    { dive: dive.id, caption: "Second sheet", sort: 1, width: 2400, height: 1600, markers: [{ id: "n1", x: 0.8, y: 0.3, label: "B1", note: "Checkpoint on sheet two." }], route: [] },
    `${FIX}/map.png`,
  );
  const token = shareToken();
  await api.post("/api/collections/shares/records", { token, trip, label: "Refs family" });

  // dive page links
  await signIn(page);
  await page.getByRole("link", { name: /Sistema Refs/ }).click();
  const navSec = page.locator("section", { has: page.getByRole("heading", { name: "Navigation" }) });
  const links = navSec.locator("a.mref");
  await expect(links).toHaveText(["T1", "2", "3", "B1", "X"]); // not #99
  await expect(navSec).toContainText("Dive #99 of the year");
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Log" }) }).locator("a.mref")).toHaveCount(1);

  // #3 opens the first map on marker 3
  await links.nth(2).click();
  await expect(page.getByText("Restriction. Turned here.")).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toMatch(new RegExp(`/map/${mapA.id}\\?m=m3$`));
  await expect(page.locator(".line-arrow.selected")).toHaveText("3");

  // #b1 (lower case) opens the second map
  await page.goBack();
  await navSec.locator("a.mref", { hasText: "B1" }).click();
  await expect(page.getByText("Checkpoint on sheet two.")).toBeVisible();
  await expect(page.getByText("Second sheet", { exact: true })).toBeVisible(); // the map caption (the plan panel mentions it too)
  await expect(page.locator(".line-arrow.selected")).toHaveText("B1");

  // editing after arriving from a link doesn't re-center the map
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Note").fill("Checkpoint on sheet two, edited.");
  await page.waitForTimeout(600);
  const pane = () => page.evaluate(() => document.querySelector(".leaflet-map-pane").style.transform);
  const before = await pane();
  await page.getByLabel("Note").fill("Checkpoint on sheet two, edited again.");
  await page.waitForTimeout(600);
  expect(await pane()).toBe(before);
  await page.getByRole("button", { name: "Done" }).click();

  // editor chips insert references at the cursor
  await page.goto(`/#/dive/${dive.id}/edit`);
  const ta = page.getByLabel("Log and comments");
  await expect(page.locator(".chips")).toHaveCount(0);
  await ta.click();
  await ta.press("End");
  await expect(page.locator(".chips .chip")).toHaveCount(5);
  await ta.pressSequentially(" Then back to");
  await page.locator(".chips .chip", { hasText: "T1" }).click();
  expect(await page.evaluate(() => document.activeElement.tagName)).toBe("TEXTAREA");
  await ta.pressSequentially("and out.");
  await expect(ta).toHaveValue("Turned at **#3** on gas. Then back to #T1 and out.");
  await page.getByRole("button", { name: "Done" }).first().click();
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Log" }) }).locator("a.mref")).toHaveCount(2);

  // family: links stay read-only and inside the share
  const fam = await newPage(browser);
  await fam.goto(`/#/s/${token}/dive/${dive.id}`);
  const first = fam.locator("a.mref").first();
  await expect(first).toHaveAttribute("href", `#/s/${token}/dive/${dive.id}/map/${mapA.id}?m=m1`);
  await first.click();
  await expect(fam.getByText("T-junction, cookie placed.")).toBeVisible();
  await expect(fam.getByRole("radio", { name: "Markers" })).toHaveCount(0);

  // in the tour, a waypoint reference scrolls; an off-route one opens the map
  await fam.goto(`/#/s/${token}/dive/${dive.id}/tour`);
  await expect(fam.getByRole("heading", { name: "The plan" })).toBeVisible();
  await fam.waitForTimeout(800);
  const plan = fam.locator(".plan");
  await plan.locator("a.mref", { hasText: /^3$/ }).click();
  await expect(fam.locator(".arrow.current text")).toHaveText("3", { timeout: 5000 });
  expect(await fam.evaluate(() => location.hash)).toMatch(/\/tour$/);
  await fam.evaluate(() => window.scrollTo(0, 0));
  await fam.waitForTimeout(800);
  await plan.locator("a.mref", { hasText: "X" }).click();
  await expect(fam.getByText("Old line, don't follow.")).toBeVisible();
  expect(await fam.evaluate(() => location.hash)).toContain(`/map/${mapA.id}`);
  void mapB;
});
