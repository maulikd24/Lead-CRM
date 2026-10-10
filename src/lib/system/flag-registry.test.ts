import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FLAGS, SETTINGS, flagIsOn } from "./flag-registry";

const docs = readFileSync(path.resolve(__dirname, "../../../docs/feature-flags.md"), "utf8");
const documented = [...docs.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((m) => m[1]);

describe("flag registry", () => {
  it("lists every on/off flag the flag table documents, so the status page cannot drift from the docs", () => {
    const isFlag = (n: string) => /^(NEXT_PUBLIC_[A-Z0-9_]+|[A-Z0-9_]+_(ENABLED|ENFORCEMENT|LINKING|ONLY)|WA_ASSIST_AUTO|WA_META_WINDOW|PARTNER_ALLOW_SAMPLE)$/.test(n);
    const names = new Set(FLAGS.map((f) => f.name));
    const missing = [...new Set(documented.filter(isFlag))].filter((n) => !names.has(n) && !["ERASURE_DB_TEST", "REFERRAL_DB_TEST", "PARTNER_NATIVE_DB_TEST", "PARTNER_PERF_DB_TEST"].includes(n));
    expect(missing).toEqual([]);
  });

  it("has unique names and no secret-looking variable", () => {
    const names = [...FLAGS.map((f) => f.name), ...SETTINGS.map((s) => s.name)];
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).not.toMatch(/SECRET|TOKEN|PASSWORD|KEY$|_URL$|CREDENTIAL/);
  });

  it("a flag is on only for the exact value 1", () => {
    expect(flagIsOn({ A: "1" }, "A")).toBe(true);
    for (const v of ["true", "TRUE", "yes", "0", "", " 1", "1 ", undefined]) expect(flagIsOn({ A: v }, "A")).toBe(false);
  });

  it("marks the build-time flags (they need a redeploy to change)", () => {
    for (const f of FLAGS) expect(f.buildTime).toBe(f.name.startsWith("NEXT_PUBLIC_"));
  });
});
