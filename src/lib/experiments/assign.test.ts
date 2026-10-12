import { describe, expect, it } from "vitest";

import { assign } from "./assign";
import { bucketPercent, fnv1a32 } from "./hash";
import { ExperimentError, validateArms } from "./model";

const ARMS = [
  { key: "control", weight: 50 },
  { key: "variant", weight: 30 },
  { key: "bold", weight: 20 },
];

describe("hash", () => {
  it("matches the published FNV-1a 32-bit test vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("gives the same position every time and keeps it in [0, 100)", () => {
    const first = bucketPercent("exp-1", "lead-42");
    for (let i = 0; i < 5; i++) expect(bucketPercent("exp-1", "lead-42")).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(100);
  });
});

describe("assign", () => {
  it("is stable across calls for the same key, subject and arms", () => {
    const picks = Array.from({ length: 20 }, () => assign("pricing-note", "cust-7", ARMS, { status: "running" }));
    expect(new Set(picks).size).toBe(1);
  });

  it("depends on the experiment key, so two experiments split the same subjects independently", () => {
    const a = Array.from({ length: 500 }, (_, i) => assign("exp-a", `cust-${i}`, ARMS, { status: "running" }));
    const b = Array.from({ length: 500 }, (_, i) => assign("exp-b", `cust-${i}`, ARMS, { status: "running" }));
    expect(a).not.toEqual(b);
  });

  it("respects the weights over 10,000 synthetic ids, within 2 points per arm", () => {
    const n = 10_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const arm = assign("weights-check", `cust-${String(i).padStart(5, "0")}`, ARMS, { status: "running" });
      counts.set(arm, (counts.get(arm) ?? 0) + 1);
    }
    for (const { key, weight } of ARMS) {
      const share = ((counts.get(key) ?? 0) / n) * 100;
      expect(Math.abs(share - weight)).toBeLessThanOrEqual(2);
    }
  });

  it("never picks a zero-weight arm", () => {
    const arms = [
      { key: "control", weight: 100 },
      { key: "off", weight: 0 },
    ];
    for (let i = 0; i < 2000; i++) expect(assign("zero", `s-${i}`, arms, { status: "running" })).toBe("control");
  });

  it("refuses a draft experiment", () => {
    try {
      assign("draft-exp", "cust-1", ARMS, { status: "draft" });
      expect.unreachable("a draft must not assign");
    } catch (err) {
      expect(err).toBeInstanceOf(ExperimentError);
      expect((err as ExperimentError).code).toBe("DRAFT_CANNOT_ASSIGN");
    }
  });

  it("returns only the control arm for a stopped experiment", () => {
    for (let i = 0; i < 500; i++) {
      expect(assign("stopped-exp", `cust-${i}`, ARMS, { status: "stopped" })).toBe("control");
    }
    expect(assign("stopped-exp", "cust-1", ARMS, { status: "stopped", control: "bold" })).toBe("bold");
  });

  it("throws a typed error when the weights do not sum to 100", () => {
    const bad = [
      { key: "control", weight: 60 },
      { key: "variant", weight: 30 },
    ];
    try {
      assign("bad", "cust-1", bad, { status: "running" });
      expect.unreachable("bad weights must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ExperimentError);
      expect((err as ExperimentError).code).toBe("WEIGHTS_NOT_100");
    }
  });

  it("rejects fewer than two arms, duplicate keys and an unknown control", () => {
    expect(() => validateArms([{ key: "only", weight: 100 }])).toThrow(ExperimentError);
    expect(() =>
      validateArms([
        { key: "a", weight: 50 },
        { key: "a", weight: 50 },
      ]),
    ).toThrow(ExperimentError);
    expect(() => validateArms(ARMS, "missing")).toThrow(ExperimentError);
  });
});
