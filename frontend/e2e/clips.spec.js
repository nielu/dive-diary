import { test, expect, FIX, newPage, signIn, ownerApi, chooseFiles, triggerSync, uniq, shareToken } from "./helpers.js";

const has = (buf, text) => buf.includes(Buffer.from(text, "latin1"));

test("clips are added next to photos with no connection, made playable everywhere, synced and played back", async ({ page, context }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ranged = [];
  page.on("response", (r) => r.url().includes(".mp4") && ranged.push(r.status()));
  const api = await ownerApi();
  const dive = await api.post("/api/collections/dives/records", { date: "2026-11-10", trip: uniq("Clip trip"), site: uniq("Cenote Clips") });

  await signIn(page);
  await page.getByRole("link", { name: new RegExp(dive.site) }).click();
  await expect(page.getByRole("heading", { name: "Photos" })).toBeVisible();

  // at the dive site: no connection; the video tools come from the offline cache
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await chooseFiles(page, "Add photos or clips", [`${FIX}/clip-h264.mp4`, `${FIX}/photo0.jpg`, `${FIX}/clip-vp9.webm`, `${FIX}/clip-portrait.mp4`]);
  await expect(page.locator(".grid button")).toHaveCount(4, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Photos and clips" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clip, 0:03" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clip, 0:02" })).toHaveCount(2);
  await expect(page.locator(".clip-badge")).toHaveCount(3);

  // a clip plays from this device before it has synced
  await page.getByRole("button", { name: "Clip, 0:03" }).click();
  const video = page.getByRole("dialog", { name: "Clip" }).locator("video");
  await expect(video).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => video.evaluate((v) => v.readyState)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close" }).click();

  await context.setOffline(false);
  await triggerSync(page);
  await expect(page.locator("button.sync")).toHaveText(/Synced/, { timeout: 30_000 });
  const { items } = await api.get(`/api/collections/photos/records?sort=sort&filter=${encodeURIComponent(`dive="${dive.id}"`)}`);
  expect(items.map((r) => [!!r.video, r.width, r.height, r.duration])).toEqual([
    [true, 1280, 720, 3], // H.264: copied
    [false, 0, 0, 0], // the photo
    [true, 1920, 1080, 2], // 2560×1440 VP9: converted
    [true, 720, 1280, 2], // stored sideways with a rotation flag: portrait
  ]);

  // the copied clip: same video, index moved to the front, no location left
  const token = await api.fileToken();
  const get = async (r) => Buffer.from(await (await api.raw.get(`/api/files/photos/${r.id}/${r.video}?token=${token}`)).body());
  const copied = await get(items[0]);
  expect(copied.indexOf("moov")).toBeLessThan(copied.indexOf("mdat"));
  expect(has(copied, "ISO6709") || has(copied, "\xa9xyz")).toBe(false);
  expect(has(copied, "avc1") && has(copied, "mp4a")).toBe(true); // video and sound kept
  const converted = await get(items[2]);
  expect(has(converted, "avc1")).toBe(true);
  expect(converted.indexOf("moov")).toBeLessThan(converted.indexOf("mdat"));

  // after syncing, the clip streams from the server and can be scrubbed
  await page.getByRole("button", { name: "Clip, 0:03" }).click();
  await expect(video).toHaveAttribute("src", /\/api\/files\/photos\/.+\.mp4\?token=/);
  await expect(video).toHaveAttribute("poster", /\/api\/files\/photos\/.+\.(jpg|png)/);
  await video.evaluate((v) => {
    v.muted = true;
    return v.play();
  });
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.3);
  await video.evaluate((v) => new Promise((res) => {
    v.addEventListener("seeked", res, { once: true });
    v.currentTime = 2.5;
  }));
  expect(ranged).toContain(206);
  // no swiping on a clip (that would fight the scrubber); arrows still step
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Photo" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  expect(errors).toEqual([]);
});

test("family sees a waypoint's clip play in the tour while it's on screen; turning the link off stops it", async ({ page, browser }) => {
  const api = await ownerApi();
  const trip = uniq("Clip tour");
  const dive = await api.post("/api/collections/dives/records", { date: "2026-11-10", trip, site: uniq("Sistema Clips"), navigation: "Main line to #T1." });
  const clip = await api.upload("photos", { dive: dive.id, sort: 0, caption: "Halocline at T1", duration: 3, width: 1280, height: 720 }, `${FIX}/photo0.jpg`, `${FIX}/clip-h264.mp4`);
  const spare = await api.upload("photos", { dive: dive.id, sort: 1, duration: 2, width: 720, height: 1280 }, `${FIX}/photo1.jpg`, `${FIX}/clip-portrait.mp4`);
  const markers = [{ id: "m1", x: 0.3, y: 0.45, label: "T1", note: "T-junction, left.", photos: [clip.id] }];
  const route = [[{ x: 0.05, y: 0.5 }, { x: 0.3, y: 0.45 }, { x: 0.6, y: 0.4 }]];
  await api.upload("maps", { dive: dive.id, caption: "Main line", sort: 0, width: 2400, height: 1600, markers, route }, `${FIX}/map.png`);
  const token = shareToken();
  const share = await api.post("/api/collections/shares/records", { token, trip, label: "Clip family" });

  // the owner sees the clip, with its length, among the marker's attachments
  await signIn(page);
  await page.getByRole("link", { name: new RegExp(dive.site) }).click();
  await page.getByRole("link", { name: /Open map/ }).click();
  await page.getByRole("radio", { name: "Markers" }).click();
  await page.locator(".line-arrow", { hasText: /^T1$/ }).click();
  await expect(page.getByRole("button", { name: "Remove clip: Halocline at T1" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".strip .len")).toHaveText(["0:03", "0:02"]);

  const fam = await newPage(browser);
  const errors = [];
  fam.on("pageerror", (e) => errors.push(e.message));
  await fam.goto(`/#/s/${token}/dive/${dive.id}/tour`);
  await expect(fam.getByRole("heading", { name: dive.site })).toBeVisible();
  const card = fam.locator(".stop-card").first();
  const video = card.locator("video");
  await expect(video).toHaveAttribute("src", new RegExp(`/api/share/${token}/file/photos/${clip.id}/.+\\.mp4$`));
  await expect(card.locator("figcaption")).toHaveText("Halocline at T1");

  // plays muted while the card is in view, pauses when scrolled away
  await fam.evaluate(() => {
    const el = document.querySelector(".stop-card video");
    el.scrollIntoView({ block: "center" });
  });
  await expect.poll(() => video.evaluate((v) => !v.paused && v.muted && v.currentTime > 0), { timeout: 10_000 }).toBe(true);
  await fam.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => video.evaluate((v) => v.paused)).toBe(true);
  await expect(fam.getByRole("heading", { name: "More clips from this dive" })).toBeVisible();
  await expect(fam.getByRole("button", { name: "Clip, 0:02" })).toBeVisible();

  // turning the link off stops the clips too
  const src = await video.getAttribute("src");
  expect((await fam.request.get(src, { headers: { Range: "bytes=0-99" } })).status()).toBe(206);
  await api.del(`/api/collections/shares/records/${share.id}`);
  expect((await fam.request.get(src)).status()).toBe(404);
  void spare;
  expect(errors).toEqual([]);
});

test("a file that isn't a usable video gets a clear message; offline, a clip says it needs a connection", async ({ page, context }) => {
  const api = await ownerApi();
  const dive = await api.post("/api/collections/dives/records", { date: "2026-11-10", trip: uniq("Clip errors"), site: uniq("Cenote Offline") });
  await api.upload("photos", { dive: dive.id, sort: 0, duration: 3, width: 1280, height: 720 }, `${FIX}/photo0.jpg`, `${FIX}/clip-h264.mp4`);

  await signIn(page);
  await page.getByRole("link", { name: new RegExp(dive.site) }).click();
  await chooseFiles(page, "Add photos or clips", `${FIX}/clip-sound-only.mp4`);
  await expect(page.getByRole("alert")).toHaveText("clip-sound-only.mp4 has no video in it.");
  await expect(page.locator(".grid button")).toHaveCount(1);

  await page.waitForTimeout(1500); // let the offline cache take the poster thumbnail
  await context.setOffline(true);
  await page.getByRole("button", { name: "Clip, 0:03" }).click();
  const dialog = page.getByRole("dialog", { name: "Clip" });
  await expect(dialog.getByText("This clip can't play right now; clips need a connection.")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => dialog.locator("img").evaluate((i) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  await context.setOffline(false);
});
