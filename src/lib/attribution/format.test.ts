import { describe, expect, it } from "vitest";

import { CONFIDENCE_TEXT, formatInr, formatWhen, kindLabel } from "./format";

describe("attribution formatting", () => {
  it("dates read in India time, short", () => {
    expect(formatWhen(new Date("2027-03-02T05:00:00Z"))).toBe("2 Mar 2027, 10:30 am");
    expect(formatWhen(null)).toBe("Not yet");
  });
  it("money is whole rupees with Indian grouping, and a dash when unknown", () => {
    expect(formatInr(750000)).toBe("₹7,50,000");
    expect(formatInr(18250.4)).toBe("₹18,250");
    expect(formatInr(null)).toBe("–");
  });
  it("every confidence level and touch kind has plain words", () => {
    expect(CONFIDENCE_TEXT.high).toMatch(/high/i);
    expect(CONFIDENCE_TEXT.low).toMatch(/channel/i);
    expect(kindLabel("meta_ad")).toBe("Meta ad");
    expect(kindLabel("partner_code")).toBe("Partner code");
    expect(kindLabel("organic")).toBe("Organic sign-up");
  });
});
