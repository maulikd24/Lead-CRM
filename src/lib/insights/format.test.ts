import { describe, expect, it } from "vitest";
import { agentLabel, blockReasonLabel, fmtDuration, fmtPct, fmtRatio, trendLabel } from "./format";

describe("fmtPct", () => {
  it("rounds and shows an em dash for no data", () => {
    expect(fmtPct(0.4567)).toBe("46%");
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPct(1)).toBe("100%");
    expect(fmtPct(null)).toBe("—");
  });
});

describe("fmtDuration", () => {
  it("picks a readable unit", () => {
    expect(fmtDuration(null)).toBe("—");
    expect(fmtDuration(0.4)).toBe("under 1 min");
    expect(fmtDuration(12)).toBe("12 min");
    expect(fmtDuration(90)).toBe("1.5 h");
    expect(fmtDuration(60 * 49)).toBe("2.0 days");
  });
});

describe("fmtRatio", () => {
  it("shows x of y", () => {
    expect(fmtRatio(3, 10)).toBe("3 of 10");
  });
});

describe("blockReasonLabel", () => {
  it("labels codes and falls back", () => {
    expect(blockReasonLabel("RETURN_PROMISE")).toBe("Return promise");
    expect(blockReasonLabel("JUDGE")).toBe("LLM judge");
    expect(blockReasonLabel("???")).toBe("Other");
  });
});

describe("agentLabel / trendLabel", () => {
  it("names known agents and falls back to a readable key", () => {
    expect(agentLabel("wa_nudger")).toBe("WhatsApp nudger");
    expect(agentLabel("future_agent")).toBe("Future agent");
  });
  it("describes trends in words", () => {
    expect(trendLabel("up", 3, 1)).toBe("up from 1");
    expect(trendLabel("down", 1, 3)).toBe("down from 3");
    expect(trendLabel("flat", 2, 2)).toBe("unchanged");
    expect(trendLabel("new", 2, 0)).toBe("new this period");
  });
});
