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

// Standard seed users, plus the synthetic partner-programme users from the layout-budget seed.
const EMAIL = { admin: "admin@supportify.local", manager: "manager@supportify.local", rm: "rm@supportify.local", finance: "finance@supportify.local", teammanager: "ui-tm@example.test", distributor: "ui-dist@example.test" };

async function login(ctx, role) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(EMAIL[role] ?? `${role}@supportify.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 });
  return page;
}

async function resolveIds(browser) {
  const ctx = await browser.newContext({ viewport: LAPTOPS[0] });
  const page = await login(ctx, "admin");
  const first = async (url, sel) => { await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 300_000 }); return page.locator(sel).first().getAttribute("href").catch(() => null); };
  const idOf = (href) => (href ? href.split("/").filter(Boolean).pop() : null);
  const BUSY = idOf(await first("/clients?q=LB-001", 'a[href^="/clients/c"]'));
  const CALL = idOf(await first("/calls", 'a[href^="/calls/c"]'));
  const AFFILIATE = idOf(await first("/partners/affiliates", 'a[href^="/partners/affiliates/"]'));
  const STMT = await first("/partners/statements", 'a[href^="/partners/statements/"]:not([href*="/export"])');
  await ctx.close();
  if (!BUSY) throw new Error("Seeded busy customer not found: run `npm run layout-budget:seed` first.");
  const now = new Date();
  const fyStart = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { BUSY, CALL, AFFILIATE, STMT, STMT_BASE: STMT ? STMT.split("?")[0] : null, FY: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`, MONTH: `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}` };
}

const browser = await chromium.launch();
const ids = await resolveIds(browser);
const results = [];
const behaviour = [];

for (const vp of viewports) {
  for (const role of ["admin", "manager", "rm", "finance", "teammanager", "distributor"]) {
    const items = ROUTES.filter((r) => r.role === role && (!only || only.split(",").some((o) => r.id.includes(o))));
    if (!items.length) continue;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: "dark" });
    await ctx.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
    const page = await login(ctx, role);
    for (const r of items) {
      const path = r.path.replace("{BUSY}", ids.BUSY).replace("{CALL}", ids.CALL ?? "none").replace("{AFFILIATE}", ids.AFFILIATE ?? "none").replace("{STMT_BASE}", ids.STMT_BASE ?? "/partners/statements/none").replace("{STMT}", ids.STMT ?? "/partners/statements/none").replace("{FY}", ids.FY).replace("{MONTH}", ids.MONTH);
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
// Behaviour of the sheet and master-detail primitives, on the busy customer (skipped with --only or --viewport).
if (!only && !viewportFilter) {
  const check = (name, ok, detail = "") => behaviour.push({ name, ok, detail });
  const phoneCtx = await browser.newContext({ viewport: { width: PHONE.width, height: PHONE.height }, isMobile: true, hasTouch: true });
  const phone = await login(phoneCtx, "admin");
  await phone.goto(`${BASE}/clients/${ids.BUSY}?tab=tasks`, { waitUntil: "networkidle", timeout: 300_000 });
  await phone.keyboard.press("Escape");
  await phone.getByRole("button", { name: /View all \d+ tasks/ }).click();
  const dialog = phone.locator("dialog[open]");
  check("View all opens a dialog", (await dialog.count()) === 1);
  check("the sheet is in the URL", phone.url().includes("sheet=tasks"));
  check("focus moves into the sheet", await phone.evaluate(() => !!document.activeElement?.closest("dialog[open]")));
  await phone.keyboard.press("Tab"); await phone.keyboard.press("Tab"); await phone.keyboard.press("Tab");
  check("focus stays trapped in the sheet", await phone.evaluate(() => !!document.activeElement?.closest("dialog[open]")));
  await phone.keyboard.press("Escape");
  check("Esc closes it and clears the URL", (await phone.locator("dialog[open]").count()) === 0 && !phone.url().includes("sheet="));
  await phone.getByRole("button", { name: /View all \d+ tasks/ }).click();
  await phone.goBack();
  await phone.waitForTimeout(400);
  check("browser Back closes it", (await phone.locator("dialog[open]").count()) === 0);
  await phone.goto(`${BASE}/clients/${ids.BUSY}?tab=tasks&sheet=tasks`, { waitUntil: "networkidle", timeout: 300_000 });
  check("a deep link opens the sheet", (await phone.locator("dialog[open]").count()) === 1);
  await phone.keyboard.press("Escape");
  await phone.waitForTimeout(300);
  check("Esc closes a deep-linked sheet", (await phone.locator("dialog[open]").count()) === 0 && !phone.url().includes("sheet="));
  await phoneCtx.close();

  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await login(deskCtx, "admin");
  await desk.goto(`${BASE}/clients/${ids.BUSY}/360?tab=outcomes`, { waitUntil: "networkidle", timeout: 300_000 });
  await desk.keyboard.press("Escape");
  const first = desk.locator('[role="option"][aria-selected="true"]');
  await first.focus();
  const before = await first.getAttribute("data-item-id");
  await desk.keyboard.press("ArrowDown");
  await desk.waitForTimeout(300);
  const after = await desk.locator('[role="option"][aria-selected="true"]').getAttribute("data-item-id");
  check("master-detail: Down moves the selection", before !== after, `${before} -> ${after}`);
  check("master-detail: the selection is in the URL", desk.url().includes("item="));
  check("master-detail: the detail follows", (await desk.locator('section[aria-label$="details"]').innerText()).length > 20);
  await deskCtx.close();
  for (const b of behaviour) console.log(`${b.ok ? "ok  " : "FAIL"} ${b.name}${b.detail ? ` (${b.detail})` : ""}`);
}
await browser.close();

const failed = [...results.filter((r) => r.problems.length), ...behaviour.filter((b) => !b.ok)];
for (const r of results) if (r.problems.length) console.log(`FAIL ${r.viewport} ${r.id}: ${r.problems.join("; ")}`);
const phone = results.filter((r) => r.viewport === "phone");
if (phone.length) console.log(`phone: ${phone.length} screens, tallest ${Math.max(...phone.map((r) => r.height))}px, ${phone.filter((r) => r.problems.length).length} over budget`);
console.log(`${results.length + behaviour.length} checks, ${failed.length} failed`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
