import { chromium } from "playwright";
import zlib from "node:zlib";
const url = "http://localhost:3540" + (process.argv[2] || "/");
const b = await chromium.launch();
async function run(throttle) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (throttle) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const sizes = [];
  p.on("response", async (r) => { try { const buf = await r.body(); const t = r.request().resourceType(); sizes.push({ url: r.url(), t, raw: buf.length, gz: zlib.gzipSync(buf).length }); } catch {} });
  await p.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  });
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(2500);
  const first = sizes.slice();
  const m = await p.evaluate(() => ({ lcp: window.__lcp, cls: window.__cls, ttfb: performance.getEntriesByType("navigation")[0].responseStart, dcl: performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd, load: performance.getEntriesByType("navigation")[0].loadEventEnd }));
  // scroll through the whole page, then measure total + CLS
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(120); }
  await p.waitForTimeout(1200);
  const m2 = await p.evaluate(() => ({ cls: window.__cls, height: document.documentElement.scrollHeight }));
  const sum = (arr, t) => arr.filter((s) => !t || s.t === t).reduce((a, s) => ({ raw: a.raw + s.raw, gz: a.gz + s.gz }), { raw: 0, gz: 0 });
  await ctx.close();
  return { throttle, ...m, clsAfterScroll: m2.cls, pageHeight: m2.height, initial: { js: sum(first, "script"), css: sum(first, "stylesheet"), font: sum(first, "font"), doc: sum(first, "document"), all: sum(first), requests: first.length }, afterScroll: { js: sum(sizes, "script"), all: sum(sizes), requests: sizes.length } };
}
console.log(JSON.stringify(await run(false), null, 1));
console.log(JSON.stringify(await run(true), null, 1));
await b.close();
