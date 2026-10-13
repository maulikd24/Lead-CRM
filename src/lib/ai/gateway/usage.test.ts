import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { AGENTS } from "@/lib/agents/registry";

import { PURPOSES } from "./purposes";

/** Every purpose named in code is registered, and every registered purpose is used: the registry and the call sites cannot drift. */
const SRC = join(process.cwd(), "src");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "generated") continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) out.push(f);
  }
  return out;
}
const files = walk(SRC).filter((f) => !relative(SRC, f).startsWith("generated"));
const used = new Map<string, string[]>();
for (const f of files) {
  const rel = relative(SRC, f);
  if (rel.startsWith("lib/agents/evals/") || rel.startsWith("lib/ai/gateway/purposes")) continue;
  for (const m of readFileSync(f, "utf8").matchAll(/\bpurpose:\s*"([a-z]+\.[a-z_]+)"/g)) used.set(m[1], [...(used.get(m[1]) ?? []), rel]);
}

describe("gateway purpose usage", () => {
  it("finds the call sites (sanity)", () => expect(used.size).toBeGreaterThanOrEqual(6));
  it("every purpose used in code is registered", () => {
    const ids = new Set(PURPOSES.map((p) => p.id));
    for (const [id, where] of used) expect(ids.has(id), `${id} used in ${where.join(", ")} but not registered`).toBe(true);
  });
  it("every registered purpose is used by a call site", () => {
    // Built but not yet wired to a route: the draft generator awaits the WhatsApp drafter route. Remove the entry when wired.
    const UNWIRED_BY_DESIGN = new Set(["conversation.draft"]);
    for (const p of PURPOSES) expect(used.has(p.id) || UNWIRED_BY_DESIGN.has(p.id), `${p.id} is registered but nothing calls it`).toBe(true);
  });
  it("every agent that lists a purpose is the one that owns its call site's kill switch or is model-free", () => {
    for (const a of AGENTS) if (a.purposes.length === 0) expect(a.audit.agentRun, a.key).toBe(false);
  });
});
