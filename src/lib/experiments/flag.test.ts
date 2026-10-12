import { describe, expect, it } from "vitest";

import { experimentsEnabled } from "./flag";

describe("experimentsEnabled", () => {
  it("is off unless EXPERIMENTS_ENABLED is exactly 1", () => {
    expect(experimentsEnabled({})).toBe(false);
    expect(experimentsEnabled({ EXPERIMENTS_ENABLED: "0" })).toBe(false);
    expect(experimentsEnabled({ EXPERIMENTS_ENABLED: "true" })).toBe(false);
    expect(experimentsEnabled({ EXPERIMENTS_ENABLED: "1" })).toBe(true);
  });
});
