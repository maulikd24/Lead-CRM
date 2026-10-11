import { chromium } from "playwright";
const [,, name, w, h, scheme, sel, off, pre] = process.argv;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, colorScheme: scheme });
const p = await ctx.newPage();
await p.goto("http://localhost:3540/", { waitUntil: "networkidle" });
if (pre) { await p.evaluate((s) => document.querySelector(s).scrollIntoView(), pre); await p.waitForTimeout(1800); }
await p.waitForSelector(sel, { timeout: 15000 });
await p.evaluate(([s,o]) => { const el=document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + (+o||0)); }, [sel, off]);
await p.waitForTimeout(1200);
await p.screenshot({ path: `/tmp/claude-502/shots/${name}.png` });
await b.close();
