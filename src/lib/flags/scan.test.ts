import { describe, expect, it } from "vitest";

import { checkNames, extractNames, parseAllowList, scanSource, unreferenced } from "./scan";

describe("extractNames", () => {
  it("finds every way an env name is read", () => {
    const text = `
      const a = process.env.ALPHA_ENABLED;
      const b = env.BETA_MODE;
      const c = process.env["GAMMA_URL"];
      const d = env['DELTA_KEY'];
      const e = process.env[\`EPSILON_SECRET\`];
      if (flag === "NEXT_PUBLIC_ZETA") {}
      const f = { x: "THETA_ENABLED" };
      const g = "IOTA_DB_TEST";
    `;
    expect(extractNames(text).sort()).toEqual(["ALPHA_ENABLED", "BETA_MODE", "DELTA_KEY", "EPSILON_SECRET", "GAMMA_URL", "IOTA_DB_TEST", "NEXT_PUBLIC_ZETA", "THETA_ENABLED"]);
  });
  it("reads worker schema keys", () => {
    expect(extractNames("const schema = z.object({\n  SESSION_DATA_DIR: z.string(),\n  LOG_LEVEL: z.enum([])\n});")).toEqual(expect.arrayContaining(["SESSION_DATA_DIR", "LOG_LEVEL"]));
  });
  it("ignores lower-case, member access on other objects and plain constants", () => {
    expect(extractNames("const x = options.env.FOO_BAR; const y = someEnv.BAZ; const NAME_ONLY = 1; process.env.lowercase;")).toEqual([]);
    expect(extractNames('const m = "DUPLICATE_KEY"; const r = "RECORD_ONLY";')).toEqual([]);
  });
  it("does not confuse a longer name with a shorter one", () => {
    expect(extractNames("process.env.PARTNER_PERF_DB_TEST")).toEqual(["PARTNER_PERF_DB_TEST"]);
  });
});

describe("scanSource", () => {
  const files = [
    { path: "src/a.ts", text: "process.env.SEEN_BOTH; process.env.ONLY_APP" },
    { path: "src/a.test.ts", text: "process.env.SEEN_BOTH; process.env.ONLY_TEST" },
  ];
  it("records where a name is read and whether tests are the only readers", () => {
    const found = scanSource(files);
    expect(found.find((f) => f.name === "SEEN_BOTH")?.files).toEqual(["src/a.test.ts", "src/a.ts"]);
    expect(found.find((f) => f.name === "ONLY_TEST")?.inTestsOnly).toBe(true);
    expect(found.find((f) => f.name === "ONLY_APP")?.inTestsOnly).toBe(false);
  });
});

describe("checkNames (FR-01)", () => {
  const opts = { isRegistered: (n: string) => n === "KNOWN", allowList: parseAllowList("# comment\nALLOWED  # why\n\n") };
  it("fails a seeded unregistered name", () => {
    const findings = checkNames(scanSource([{ path: "src/x.ts", text: "const v = process.env.NEW_FLAG;" }]), opts);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: "FR-01", severity: "error", name: "NEW_FLAG" });
    expect(findings[0].files).toEqual(["src/x.ts"]);
  });
  it("passes a registered name and an allow-listed name", () => {
    expect(checkNames(scanSource([{ path: "src/x.ts", text: "process.env.KNOWN; process.env.ALLOWED;" }]), opts)).toEqual([]);
  });
  it("also fails an unregistered name that only a test reads (a flag in a test is still a flag)", () => {
    expect(checkNames(scanSource([{ path: "src/x.test.ts", text: "process.env.TEST_ONLY_SWITCH_ENABLED" }]), opts)).toHaveLength(1);
  });
});

describe("parseAllowList", () => {
  it("ignores comments and blank lines", () => {
    expect([...parseAllowList("# top\nA\nB # why\n\n  C  \n")]).toEqual(["A", "B", "C"]);
  });
});

describe("unreferenced (FR-31)", () => {
  const registered = [{ name: "USED_ENABLED" }, { name: "UNUSED_ENABLED" }, { name: "LATER_ENABLED", inFlight: "branch" }, { name: "TEST_ONLY_ENABLED" }];
  const files = [
    { path: "src/a.ts", text: "process.env.USED_ENABLED; const x = USED_ENABLED_EXTRA;" },
    { path: "src/a.test.ts", text: "process.env.TEST_ONLY_ENABLED" },
    { path: "src/lib/flags/registry.ts", text: "UNUSED_ENABLED" },
  ];
  it("warns for a registered name nothing reads, ignores in-flight names, and does not count tests or the registry itself", () => {
    expect(unreferenced(registered, files).map((f) => f.name)).toEqual(["UNUSED_ENABLED", "TEST_ONLY_ENABLED"]);
  });
  it("lets a test file reference a test or tooling switch", () => {
    const files2 = [{ path: "src/a.test.ts", text: "process.env.ACCESS_DB_TEST" }];
    expect(unreferenced([{ name: "ACCESS_DB_TEST", kind: "test" }], files2)).toEqual([]);
    expect(unreferenced([{ name: "ACCESS_DB_TEST", kind: "feature" }], files2)).toHaveLength(1);
  });
  it("matches whole names only", () => {
    expect(unreferenced([{ name: "USED_ENABLED" }], [{ path: "src/a.ts", text: "process.env.USED_ENABLED_EXTRA" }])).toHaveLength(1);
  });
});
