import { describe, expect, it } from "vitest";

import { PRIORITY_VARIANT } from "./status-badge-config";

describe("priority colours", () => {
  it("reserves red for High and never colours Medium as a warning (amber means a real warning)", () => {
    expect(PRIORITY_VARIANT.HIGH).toBe("destructive");
    expect(PRIORITY_VARIANT.MEDIUM).toBe("secondary");
    expect(PRIORITY_VARIANT.LOW).toBe("outline");
  });
});
