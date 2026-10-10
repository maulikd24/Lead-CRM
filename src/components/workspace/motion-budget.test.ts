import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Owner rule, enforced over the whole app: nothing loops and nothing animates for longer than 300 ms. A source scan, so a stray
 * `infinite`, `animate-spin` or a 500 ms transition added anywhere in src fails here instead of reaching a screen.
 */
const SRC = path.resolve(__dirname, "../..");
const MAX_MS = 300;

function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(css|tsx|ts)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const toMs = (v: string, unit: string) => (unit === "ms" ? Number(v) : Number(v) * 1000);

function findings(): string[] {
  const out: string[] = [];
  for (const file of files(SRC)) {
    const rel = path.relative(SRC, file);
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      const t = line.trim();
      const at = `${rel}:${i + 1}`;
      const comment = /^(\/\/|\*|\/\*)/.test(t);
      if (!comment && /\binfinite\b/.test(line)) out.push(`${at} loops (infinite)`);
      if (/repeat:\s*Infinity/.test(line)) out.push(`${at} loops (repeat Infinity)`);
      if (/animate-(pulse|spin|ping|bounce)/.test(line) && !/animation:\\s*none|animation: none/.test(line)) out.push(`${at} loops (Tailwind animate class)`);
      if (/\.css$/.test(file) && /(animation|transition)(-duration)?\s*:/.test(line))
        for (const m of line.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) if (toMs(m[1], m[2]) > MAX_MS) out.push(`${at} ${toMs(m[1], m[2])} ms`);
      for (const m of line.matchAll(/\bduration-(\d+)\b/g)) if (Number(m[1]) > MAX_MS) out.push(`${at} duration-${m[1]}`);
      for (const m of line.matchAll(/\bduration:\s*(\d*\.?\d+)/g)) {
        const n = Number(m[1]);
        if ((n > 20 ? n : n * 1000) > MAX_MS) out.push(`${at} duration ${m[1]}`);
      }
      if (/transition(Duration)?\s*:\s*["'`]|animationDuration|transitionDuration/.test(line))
        for (const m of line.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) if (toMs(m[1], m[2]) > MAX_MS) out.push(`${at} inline ${toMs(m[1], m[2])} ms`);
    });
  }
  return out;
}

describe("motion budget across the app", () => {
  it("nothing loops and nothing runs longer than 300 ms", () => {
    expect(findings()).toEqual([]);
  });
});
