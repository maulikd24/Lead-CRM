import { describe, expect, it } from "vitest";

import { DEFAULT_AUDIENCES, DEFAULT_PROMISES } from "./defaults";
import { checkPromise } from "./guardrails";
import { isChannelKey } from "./channels";

describe("seeded defaults", () => {
  it("seeds exactly the three audience profiles with every profile field filled", () => {
    expect(DEFAULT_AUDIENCES.map((a) => a.key)).toEqual(["salaried", "affluent_hni", "nri"]);
    for (const a of DEFAULT_AUDIENCES) {
      expect(a.name.length).toBeGreaterThan(3);
      for (const f of ["description", "tone", "productFit", "objections", "complianceNote"] as const) expect(a[f].length, `${a.key}.${f}`).toBeGreaterThan(20);
      expect(a.languages.length).toBeGreaterThan(0);
      expect(a.cities.length).toBeGreaterThan(0);
      expect(a.channels.length).toBeGreaterThan(0);
      expect(a.channels.every(isChannelKey)).toBe(true);
    }
  });
  it("describes the owner's three audiences", () => {
    const by = Object.fromEntries(DEFAULT_AUDIENCES.map((a) => [a.key, a]));
    expect(by.salaried.description).toMatch(/25.*40/);
    expect(by.affluent_hni.description).toMatch(/50 lakh/i);
    expect(by.nri.name).toMatch(/NRI/);
  });
  it("seeds promises that all pass every guardrail, including the owner's four examples", () => {
    const hooks = DEFAULT_PROMISES.map((p) => p.hook);
    for (const h of ["See if you are on track for retirement", "Check your mutual fund portfolio in a minute", "Tax-saving options before March", "Invest from India as an NRI: what to know"]) expect(hooks).toContain(h);
    for (const p of DEFAULT_PROMISES) {
      const r = checkPromise(p);
      expect(r.ok, `${p.hook}: ${r.items.filter((i) => i.status === "fail").map((i) => i.detail).join("; ")}`).toBe(true);
    }
  });
  it("keeps the seed free of internal names and real hosts", () => {
    const text = JSON.stringify([DEFAULT_AUDIENCES, DEFAULT_PROMISES]);
    expect(text).not.toMatch(/allvest|supportify/i);
  });
});
