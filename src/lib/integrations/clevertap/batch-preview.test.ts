import { describe, expect, it } from "vitest";

import { batchPreview } from "./batch-preview";

const ids = Array.from({ length: 25 }, (_, i) => `client-${String(i + 1).padStart(2, "0")}`);

describe("the approval queue shows the whole batch to the approver", () => {
  it("lists every id of a full 25-customer batch, not the first five", () => {
    const b = batchPreview({ region: "in1", count: 25, clientIds: ids, state: "ready" }, "a".repeat(64));
    expect(b?.ids).toEqual(ids);
    expect(b?.count).toBe(25);
    expect(b?.region).toBe("in1");
  });

  it("shows the batch hash the push will check, so the approver can match it", () => {
    const hash = "b".repeat(64);
    expect(batchPreview({ region: "in1", count: 2, clientIds: ["c1", "c2"], state: "ready" }, hash)?.hash).toBe(hash);
    expect(batchPreview({ region: "in1", count: 2, clientIds: ["c1", "c2"], state: "ready" })?.hash).toBeNull();
  });

  it("carries ids only: names, emails, phone numbers and signals in the payload never reach the preview", () => {
    const b = batchPreview({ region: "in1", count: 1, clientIds: ["c1"], state: "ready", name: "Asha Rao", email: "asha@example.com", phone: "+91000", signals: { x: 1 } }, "h");
    expect(JSON.stringify(b)).not.toMatch(/Asha|example\.com|\+91|signals/);
    expect(Object.keys(b ?? {}).sort()).toEqual(["count", "hash", "ids", "region"]);
  });

  it("returns null for a payload that is not a batch", () => {
    expect(batchPreview(null)).toBeNull();
    expect(batchPreview({ region: "in1" })).toBeNull();
  });
});
