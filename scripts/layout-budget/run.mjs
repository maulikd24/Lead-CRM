// Layout budget. Loads every converted route and tab with the seeded synthetic data and checks:
//   - at 390x844 (phone): the page is at most PHONE_BUDGET (1.7) viewports tall, and nothing scrolls sideways;
//   - at 1440x900 and 1280x720 (laptops): the document itself does not scroll (long content scrolls inside its own panel).
// Usage: start the app with every feature flag on against a seeded local database (see docs/workspace-pattern.md), then
//   npm run layout-budget [-- --only client,calls --viewport phone --json out.json]
// Env: LB_BASE (default http://localhost:3440), LB_PASSWORD (default password123). Exit code 1 when any check fails.
import { chromium } from "@playwright/test";
import fs from "node:fs";

import { EXCEPTIONS, LAPTOPS, PHONE, PHONE_BUDGET, ROUTES } from "./routes.mjs";

const BASE = process.env.LB_BASE ?? "http://localhost:3440";
const PASSWORD = process.env.LB_PASSWORD ?? "password123";
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const only = arg("only");
const viewportFilter = arg("viewport");
const jsonOut = arg("json");

const viewports = [
  { key: "phone", ...PHONE, mobile: true },
  ...LAPTOPS.map((v) => ({ key: `${v.width}x${v.height}`, ...v, mobile: false })),
].filter((v) => !viewportFilter || v.key.startsWith(viewportFilter));

async function login(ctx, role) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(`${role}@supportify.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 });
  return page;
}

async function resolveIds(browser) {
  const ctx = await browser.newContext({ viewport: LAPTOPS[0] });
  const page = await login(ctx, "admin");
  const first = async (url, sel) => { await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 300_000 }); return page.locator(sel).first().getAttribute("href").catch(() => null); };
  const idOf = (href) => (href ? href.split("/").filter(Boolean)[1] : null);
  const BUSY = idOf(await first("/clients?q=LB-001", 'a[href^="/clients/c"]'));
  const CALL = idOf(await first("/calls", 'a[href^="/calls/c"]'));
  const AFFILIATE = idOf(await first("/partners/affiliates", 'a[href^="/partners/affiliates/"]'));
  await ctx.close();
  if (!BUSY) throw new Error("Seeded busy customer not found: run `npm run layout-budget:seed` first.");
  return { BUSY, CALL, AFFILIATE };
}

const browser = await chromium.launch();
const ids = await resolveIds(browser);
const results = [];

for (const vp of viewports) {
  for (const role of ["admin", "manager", "rm"]) {
    const items = ROUTES.filter((r) => r.role === role && (!only || only.split(",").some((o) => r.id.includes(o))));
    if (!items.length) continue;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: "dark" });
    await ctx.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
    const page = await login(ctx, role);
    for (const r of items) {
      const path = r.path.replace("{BUSY}", ids.BUSY).replace("{CALL}", ids.CALL ?? "none").replace("{AFFILIATE}", ids.AFFILIATE ?? "none");
      const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 300_000 }).catch((e) => ({ status: () => 0, err: e }));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(900);
      const status = res?.status?.() ?? 0;
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const main = document.querySelector("main");
        return { scrollH: Math.max(de.scrollHeight, document.body.scrollHeight), innerH: innerHeight, scrollW: de.scrollWidth, innerW: innerWidth, mainOverflow: main ? main.scrollHeight - main.clientHeight : 0 };
      });
      const rec = { id: r.id, group: r.group, role, viewport: vp.key, path, status, height: m.scrollH, viewportH: m.innerH, ratio: +(m.scrollH / m.innerH).toFixed(2), problems: [] };
      if (status !== 200) rec.problems.push(`HTTP ${status}`);
      if (vp.mobile) {
        if (m.scrollH / m.innerH > PHONE_BUDGET && !EXCEPTIONS[r.id]) rec.problems.push(`${m.scrollH}px is ${rec.ratio} viewports (budget ${PHONE_BUDGET})`);
        if (m.scrollW > m.innerW + 1) rec.problems.push(`sideways scroll (${m.scrollW}px wide)`);
      } else {
        if (m.scrollH > m.innerH + 1) rec.problems.push(`the page scrolls (${m.scrollH}px in a ${m.innerH}px window)`);
        if (m.mainOverflow > 1) rec.problems.push(`main scrolls by ${m.mainOverflow}px`);
      }
      if (EXCEPTIONS[r.id]) rec.exception = EXCEPTIONS[r.id];
      results.push(rec);
    }
    await ctx.close();
  }
}
await browser.close();

const failed = results.filter((r) => r.problems.length);
for (const r of results) if (r.problems.length) console.log(`FAIL ${r.viewport} ${r.id}: ${r.problems.join("; ")}`);
const phone = results.filter((r) => r.viewport === "phone");
if (phone.length) console.log(`phone: ${phone.length} screens, tallest ${Math.max(...phone.map((r) => r.height))}px, ${phone.filter((r) => r.problems.length).length} over budget`);
console.log(`${results.length} checks, ${failed.length} failed`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
