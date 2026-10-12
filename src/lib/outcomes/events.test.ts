import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OUTCOME_EVENT_NAMES, sanitizeEventProps } from "./events";

describe("sanitizeEventProps", () => {
  it("keeps short ids and numbers", () => {
    expect(sanitizeEventProps({ ruleKey: "idle_cash", count: 3, band: "high" })).toEqual({ ruleKey: "idle_cash", count: 3, band: "high" });
  });
  it("drops free text, long strings, objects and anything not on the allowed list, so no personal data can be recorded", () => {
    const out = sanitizeEventProps({ ruleKey: "x".repeat(60), name: "Asha Rao", note: "call me", nested: { a: 1 }, list: [1], status: "ACTIVE" });
    expect(out).toEqual({ status: "ACTIVE" });
  });
  it("returns null when nothing is left", () => {
    expect(sanitizeEventProps({ name: "x" })).toBeNull();
    expect(sanitizeEventProps(undefined)).toBeNull();
  });
});

describe("the event names are a closed list", () => {
  it("covers the actions the feature records", () => {
    expect([...OUTCOME_EVENT_NAMES].sort()).toEqual(["draft_requested", "goal_archived", "goal_created", "goal_updated", "review_marked", "suggestion_dismissed", "task_created"].sort());
  });
});

describe("analytics stay internal", () => {
  it("nothing in the outcomes feature imports the CleverTap integration or calls out over the network", () => {
    const dir = __dirname;
    const files = ["events.ts", "service.ts", "loaders.ts", "drafts.ts"];
    for (const f of files) {
      let text = "";
      try { text = readFileSync(join(dir, f), "utf8"); } catch { continue; }
      expect(text, f).not.toMatch(/clevertap|fetch\(|axios|XMLHttpRequest/i);
    }
  });
});
