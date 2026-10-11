import { describe, expect, it } from "vitest";

import { bulkFollowUpAction, planBulkTasks, validateBulkParams, type BulkFollowUpParams } from "./bulk-tasks";
import type { SimResult } from "./engine";

const NOW = new Date("2027-05-10T05:30:00Z");
const params: BulkFollowUpParams = { title: "Follow up on documents", channel: "call", kind: "service", dueInDays: 2 };

describe("validateBulkParams", () => {
  it("accepts a sane request and refuses the rest", () => {
    expect(validateBulkParams(params)).toEqual({ ok: true, params });
    expect(validateBulkParams({ ...params, title: "  " })).toMatchObject({ ok: false });
    expect(validateBulkParams({ ...params, title: "x".repeat(200) })).toMatchObject({ ok: false });
    expect(validateBulkParams({ ...params, dueInDays: 0 })).toMatchObject({ ok: false });
    expect(validateBulkParams({ ...params, dueInDays: 400 })).toMatchObject({ ok: false });
    expect(validateBulkParams({ ...params, channel: "pigeon" as never })).toMatchObject({ ok: false });
    expect(validateBulkParams({ ...params, kind: "other" as never })).toMatchObject({ ok: false });
  });
});

describe("bulkFollowUpAction", () => {
  it("a 'call' request prefers the phone, 'any' tries every channel, and it is a service contact unless sales is asked for", () => {
    expect(bulkFollowUpAction(params).channels).toEqual(["call"]);
    expect(bulkFollowUpAction({ ...params, channel: "any" }).channels).toEqual(["call", "whatsapp", "email"]);
    expect(bulkFollowUpAction(params).purpose).toBe("SERVICE_COMMS");
    expect(bulkFollowUpAction({ ...params, kind: "sales" }).purpose).toBe("MARKETING_COMMS");
    expect(bulkFollowUpAction(params).aiCallsPerTarget).toBe(0);
  });
});

describe("planBulkTasks", () => {
  const sim = { eligible: [{ id: "c1", label: "A", channel: "call" }, { id: "c2", label: "B", channel: "whatsapp" }], suppressed: [{ id: "c3", label: "C", reasons: ["consent"] }] } as unknown as SimResult;
  const owners = new Map([["c1", "rm1"], ["c2", null], ["c3", "rm1"]]);

  it("creates one task per ELIGIBLE customer only, never for a suppressed one", () => {
    const plan = planBulkTasks(sim, owners, params, NOW, "me");
    expect(plan.map((p) => p.clientId)).toEqual(["c1", "c2"]);
  });
  it("assigns to the customer's own RM, falling back to the person creating the batch", () => {
    const plan = planBulkTasks(sim, owners, params, NOW, "me");
    expect(plan.map((p) => p.assignedToId)).toEqual(["rm1", "me"]);
  });
  it("sets the due date, category and source, and names the channel in the title", () => {
    const [first] = planBulkTasks(sim, owners, params, NOW, "me");
    expect(first.dueAt.getTime()).toBe(NOW.getTime() + 2 * 86_400_000);
    expect(first).toMatchObject({ category: "FOLLOW_UP", source: "bulk-follow-up" });
    expect(first.title).toBe("Follow up on documents (call)");
  });
  it("caps a batch at 200", () => {
    const big = { eligible: Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, label: "x", channel: "call" })), suppressed: [] } as unknown as SimResult;
    expect(planBulkTasks(big, new Map(), params, NOW, "me")).toHaveLength(200);
  });
});
