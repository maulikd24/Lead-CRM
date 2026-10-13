import { describe, expect, it } from "vitest";

import { copilotEnabled, copilotPanelVisible } from "./flag";

describe("the co-pilot flag", () => {
  it("is off unless the value is exactly 1", () => {
    expect(copilotEnabled({})).toBe(false);
    expect(copilotEnabled({ FRESHDESK_COPILOT_ENABLED: "0" })).toBe(false);
    expect(copilotEnabled({ FRESHDESK_COPILOT_ENABLED: "true" })).toBe(false);
    expect(copilotEnabled({ FRESHDESK_COPILOT_ENABLED: "1" })).toBe(true);
  });

  it("flag off hides the panel, even on the Support SLA screen", () => {
    expect(copilotPanelVisible({ NEXT_PUBLIC_SUPPORT_SLA: "1" })).toBe(false);
    expect(copilotPanelVisible({ FRESHDESK_COPILOT_ENABLED: "1", NEXT_PUBLIC_SUPPORT_SLA: "1" })).toBe(true);
    expect(copilotPanelVisible({ FRESHDESK_COPILOT_ENABLED: "1" })).toBe(false);
  });
});
