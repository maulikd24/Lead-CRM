import { chromium } from "playwright";
const [,, name, w, h, scheme, sel, extra] = process.argv;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, colorScheme: scheme });
const p = await ctx.newPage();
await p.goto("http://localhost:3540/", { waitUntil: "networkidle" });
await p.evaluate((s) => document.querySelector(s).scrollIntoView(), sel);
await p.waitForTimeout(1500);
if (extra === "marketing") { await p.getByRole("tab", { name: "Marketing" }).click(); await p.waitForTimeout(500); }
if (extra === "ask") { await p.getByRole("button", { name: /Why was Rahul/ }).click(); await p.waitForTimeout(3500); }
await p.screenshot({ path: `/tmp/claude-502/shots/${name}.png` });
await b.close();
