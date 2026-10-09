import { describe, expect, it } from "vitest";
import { isPartnerWorkspaceEnabled } from "./flag";

describe("isPartnerWorkspaceEnabled", () => {
  it("is off by default", () => {
    expect(isPartnerWorkspaceEnabled({})).toBe(false);
  });
  it("is on only for the exact value 1", () => {
    expect(isPartnerWorkspaceEnabled({ PARTNER_WORKSPACE_ENABLED: "1" })).toBe(true);
    for (const v of ["0", "true", "yes", "", " 1"]) expect(isPartnerWorkspaceEnabled({ PARTNER_WORKSPACE_ENABLED: v })).toBe(false);
  });
});

describe("enabledNavFlags", () => {
  it("lists the partner workspace flag only when enabled", async () => {
    const { enabledNavFlags } = await import("./flag");
    expect(enabledNavFlags({})).toEqual([]);
    expect(enabledNavFlags({ PARTNER_WORKSPACE_ENABLED: "1" })).toEqual(["partner-workspace"]);
  });
});
