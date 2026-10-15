import { describe, expect, it } from "vitest";

import { confidenceText, formatWhen, groupChain } from "./format";
import { PHASES, type LedgerEntry } from "./types";

describe("ledger display helpers", () => {
  it("formats times in India time, the same on the server and in the browser", () => {
    expect(formatWhen("2027-05-10T04:00:00Z")).toBe("10 May 2027, 9:30 am");
    expect(formatWhen("not a date")).toBe("");
    expect(formatWhen(null)).toBe("");
  });
  it("never calls an inferred link certain, and says the score is a rank", () => {
    expect(confidenceText("certain", 1)).toMatch(/^Certain/);
    expect(confidenceText("inferred", 0.4)).toMatch(/^Inferred, low confidence/);
    expect(confidenceText("inferred", 0.7)).toMatch(/medium/);
    expect(confidenceText("inferred", 0.4)).toMatch(/not a probability/);
  });
  it("groups a chain by phase in the fixed order and drops empty phases", () => {
    const step = (phase: LedgerEntry["chain"][number]["phase"]) => ({ id: phase, phase, at: "", title: phase, source: { table: "x", id: "1", label: "x", href: null }, confidence: "certain" as const, score: 1 });
    const groups = groupChain({ chain: [step("result"), step("trigger"), step("execution")] }, PHASES);
    expect(groups.map((g) => g.phase)).toEqual(["trigger", "execution", "result"]);
  });
});
