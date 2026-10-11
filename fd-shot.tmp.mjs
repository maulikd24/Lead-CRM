import { chromium } from "playwright";
const [,, name, w, h, scheme, scrollY, path] = process.argv;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, colorScheme: scheme, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto("http://localhost:3540" + (path || "/"), { waitUntil: "networkidle" });
await p.waitForTimeout(1800);
if (scrollY) { await p.evaluate((y) => window.scrollTo(0, y), +scrollY); await p.waitForTimeout(900); }
await p.screenshot({ path: `/tmp/claude-502/shots/${name}.png` });
await b.close();
