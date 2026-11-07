import { test as base, expect, devices, request } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export { expect, devices };
export const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
export const BASE = process.env.BASE_URL || "http://127.0.0.1:8090";
export const OWNER = {
  email: process.env.OWNER_EMAIL || "me@example.com",
  password: process.env.OWNER_PASSWORD || "testpass123",
};

// The server rate-limits by X-Real-IP (Railway's client address header).
// Every context pretends to be a different visitor so logins don't collide.
let n = Math.floor(Math.random() * 1000);
export function fakeIp() {
  n++;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export const test = base.extend({
  extraHTTPHeaders: async ({}, use) => use({ "X-Real-IP": fakeIp() }),
});

/** A fresh browser context (another person or device). */
export async function newPage(browser, options = {}) {
  const ctx = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: BASE,
    ...options,
    extraHTTPHeaders: { "X-Real-IP": fakeIp(), ...options.extraHTTPHeaders },
  });
  return ctx.newPage();
}

export async function signIn(page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "All dives" })).toBeVisible();
}

/** Owner API client for seeding data. */
export async function ownerApi() {
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { "X-Real-IP": fakeIp() } });
  const res = await ctx.post("/api/collections/users/auth-with-password", {
    data: { identity: OWNER.email, password: OWNER.password },
  });
  const { token } = await res.json();
  const headers = { Authorization: token };
  const ok = async (r) => {
    if (!r.ok()) throw new Error(`${r.status()} ${await r.text()}`);
    return r.status() === 204 ? null : r.json();
  };
  return {
    get: (p) => ctx.get(p, { headers }).then(ok),
    post: (p, data) => ctx.post(p, { headers, data }).then(ok),
    patch: (p, data) => ctx.patch(p, { headers, data }).then(ok),
    del: (p) => ctx.delete(p, { headers }).then(ok),
    upload: (collection, fields, file) =>
      ctx
        .post(`/api/collections/${collection}/records`, {
          headers,
          multipart: {
            ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])),
            image: { name: path.basename(file), mimeType: file.endsWith(".png") ? "image/png" : "image/jpeg", buffer: fs.readFileSync(file) },
          },
        })
        .then(ok),
    raw: ctx,
  };
}

/** Pick files through the app's own file buttons. */
export async function chooseFiles(page, buttonText, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByText(buttonText, { exact: true }).click()]);
  await chooser.setFiles(files);
}

/** Wake the app's sync the way returning to the app does. */
export async function triggerSync(page) {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

export function uniq(prefix) {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

export function shareToken() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
