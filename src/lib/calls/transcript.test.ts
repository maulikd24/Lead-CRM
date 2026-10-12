import { describe, expect, it } from "vitest";
import { computeWindow, estimateTurnHeight, maskSensitive, parseTranscript, formatClock } from "./transcript";

describe("parseTranscript", () => {
  it("returns no turns for empty input", () => {
    expect(parseTranscript(null)).toEqual([]);
    expect(parseTranscript("   \n ")).toEqual([]);
  });

  it("parses bracketed timestamps with speaker labels", () => {
    const turns = parseTranscript("[00:05] RM: Good morning.\n[00:09] Customer: Hello, who is this?\n[01:02:03] RM: Closing.");
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({ speaker: "rm", startSec: 5, text: "Good morning." });
    expect(turns[1]).toMatchObject({ speaker: "customer", startSec: 9 });
    expect(turns[2].startSec).toBe(3723);
  });

  it("parses leading and trailing timestamp styles and maps agent/client synonyms", () => {
    const turns = parseTranscript("0:12 Agent: Hi\nCustomer (0:20): Yes\nClient: no time stamp");
    expect(turns.map((t) => t.speaker)).toEqual(["rm", "customer", "customer"]);
    expect(turns.map((t) => t.startSec)).toEqual([12, 20, null]);
  });

  it("folds continuation lines into the previous turn", () => {
    const turns = parseTranscript("RM: First line\nsecond line of same turn\nCustomer: ok");
    expect(turns).toHaveLength(2);
    expect(turns[0].text).toBe("First line second line of same turn");
  });

  it("treats unlabelled text as one unknown-speaker turn per paragraph", () => {
    const turns = parseTranscript("Para one line.\n\nPara two.");
    expect(turns.map((t) => t.speaker)).toEqual(["unknown", "unknown"]);
    expect(turns).toHaveLength(2);
  });

  it("keeps unrecognised speaker labels as unknown with the label retained", () => {
    const [turn] = parseTranscript("Speaker 2: hello");
    expect(turn.speaker).toBe("unknown");
    expect(turn.label).toBe("Speaker 2");
  });
});

describe("maskSensitive", () => {
  it("masks long digit runs, spaced phone numbers and emails", () => {
    expect(maskSensitive("call me on 98765 43210 today")).not.toMatch(/98765/);
    expect(maskSensitive("my number is +91-9876543210")).toContain("•••");
    expect(maskSensitive("write to riya.shah@example.com")).not.toContain("riya.shah");
    expect(maskSensitive("PAN ABCDE1234F please")).not.toContain("ABCDE1234F");
  });
  it("masks a whole e-mail address, including its domain suffix (the UPI rule alone would leave '.co.in' behind)", () => {
    expect(maskSensitive("write to riya.shah@example.co.in please")).toBe("write to •••@••• please");
  });
  it("leaves ordinary numbers alone", () => {
    expect(maskSensitive("invest 50000 for 3 years at 12 percent")).toBe("invest 50000 for 3 years at 12 percent");
  });
});

describe("formatClock", () => {
  it("formats seconds as m:ss or h:mm:ss", () => {
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3723)).toBe("1:02:03");
  });
});

describe("computeWindow", () => {
  const heights = Array.from({ length: 1000 }, () => 50);
  it("returns only the rows in view plus overscan", () => {
    const w = computeWindow({ heights, scrollTop: 5000, viewport: 500, overscan: 2 });
    expect(w.start).toBe(98);
    expect(w.end).toBe(112);
    expect(w.offsetTop).toBe(98 * 50);
    expect(w.totalHeight).toBe(50_000);
  });
  it("clamps at both ends", () => {
    expect(computeWindow({ heights, scrollTop: 0, viewport: 200, overscan: 3 }).start).toBe(0);
    const last = computeWindow({ heights, scrollTop: 999_999, viewport: 200, overscan: 3 });
    expect(last.end).toBe(1000);
  });
  it("handles empty input", () => {
    expect(computeWindow({ heights: [], scrollTop: 0, viewport: 100, overscan: 2 })).toEqual({ start: 0, end: 0, offsetTop: 0, totalHeight: 0 });
  });
  it("estimates taller rows for longer turns", () => {
    expect(estimateTurnHeight(400)).toBeGreaterThan(estimateTurnHeight(20));
  });
});

describe("maskSensitive Indian identifiers", () => {
  it.each([
    ["my pan is abcde1234f ok", "abcde1234f"],
    ["pan A B C D E 1 2 3 4 F ok", "A B C D E 1 2 3 4 F"],
    ["pay rahul.sharma@okaxis now", "rahul.sharma"],
    ["call (987) 654-3210 now", "654-3210"],
    ["call 98765.43210 now", "43210"],
    ["ifsc HDFC0001234 branch", "HDFC0001234"],
  ])("hides %s", (input, secret) => {
    expect(maskSensitive(input)).not.toContain(secret);
  });
  it("leaves ordinary dates and amounts alone", () => {
    expect(maskSensitive("meet on 12/10 at 5 for 20.5 percent")).toBe("meet on 12/10 at 5 for 20.5 percent");
  });
});
