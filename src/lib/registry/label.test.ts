import { describe, expect, it } from "vitest";

import { labelOf } from "./model";

describe("labelOf", () => {
  it("reads a code as words and keeps acronyms in capitals", () => {
    expect(labelOf("MUTUAL_FUND")).toBe("Mutual fund");
    expect(labelOf("AIF")).toBe("AIF");
    expect(labelOf("PMS")).toBe("PMS");
    expect(labelOf("kyc_complete")).toBe("KYC complete");
    expect(labelOf("MODERATELY_HIGH")).toBe("Moderately high");
    expect(labelOf("BY_REQUEST")).toBe("By request");
  });
});
