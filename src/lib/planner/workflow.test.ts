import { describe, expect, it } from "vitest";

import { buildChecklist, decideTransition, type ChecklistContext, type PlanForFlow } from "./workflow";

const TODAY = "2026-10-11";
const plan = (o: Partial<PlanForFlow> = {}): PlanForFlow => ({ status: "DRAFT", createdById: "maker", ownerId: "owner", startDate: "2026-11-01", endDate: "2026-11-30", linksTestedAt: null, approvedById: null, channel: "search_ad", ...o });
const ctx = (o: Partial<ChecklistContext> = {}): ChecklistContext => ({
  promiseOk: true,
  destination: { status: "LIVE", patternOk: true },
  linksTested: true,
  routing: { via: "rule", ownerId: "rm-1" },
  consentPurpose: "MARKETING_COMMS",
  copies: [{ status: "APPROVED" }],
  creator: null,
  channel: "search_ad",
  ...o,
});
const failedIds = (c: ChecklistContext) => buildChecklist(c).filter((i) => i.status === "fail").map((i) => i.id);

describe("checklist before Approved", () => {
  it("has the six owner items and passes when everything is in place", () => {
    const items = buildChecklist(ctx());
    expect(items.map((i) => i.id)).toEqual(["promise_compliant", "destination_live", "links_tested", "routing_owner", "consent_purpose", "copy_approved"]);
    expect(items.every((i) => i.status === "pass")).toBe(true);
  });
  it("fails a planned destination and says it is not live yet", () => {
    const item = buildChecklist(ctx({ destination: { status: "PLANNED", patternOk: true } })).find((i) => i.id === "destination_live");
    expect(item?.status).toBe("fail");
    expect(item?.detail).toMatch(/not live yet/i);
  });
  it("fails a live destination whose URL pattern is invalid", () => {
    expect(failedIds(ctx({ destination: { status: "LIVE", patternOk: false } }))).toEqual(["destination_live"]);
  });
  it("fails each missing piece on its own", () => {
    expect(failedIds(ctx({ promiseOk: false }))).toEqual(["promise_compliant"]);
    expect(failedIds(ctx({ linksTested: false }))).toEqual(["links_tested"]);
    expect(failedIds(ctx({ routing: { via: "none", ownerId: null } }))).toEqual(["routing_owner"]);
    expect(failedIds(ctx({ consentPurpose: null }))).toEqual(["consent_purpose"]);
    expect(failedIds(ctx({ consentPurpose: "CALL_RECORDING" }))).toEqual(["consent_purpose"]);
    expect(failedIds(ctx({ copies: [{ status: "DRAFT" }] }))).toEqual(["copy_approved"]);
    expect(failedIds(ctx({ copies: [] }))).toEqual(["copy_approved"]);
  });
  it("accepts the fallback rule as a routing owner", () => {
    expect(failedIds(ctx({ routing: { via: "fallback", ownerId: "rm-2" } }))).toEqual([]);
  });
  it("adds a creator item for short video: no creator or an unregistered creator blocks", () => {
    expect(buildChecklist(ctx({ channel: "short_video", creator: { sebiRegistration: "INH000012345" } })).map((i) => i.id)).toContain("creator_registered");
    expect(failedIds(ctx({ channel: "short_video", creator: null }))).toEqual(["creator_registered"]);
    expect(failedIds(ctx({ channel: "short_video", creator: { sebiRegistration: null } }))).toEqual(["creator_registered"]);
    expect(failedIds(ctx({ channel: "short_video", creator: { sebiRegistration: "pending" } }))).toEqual(["creator_registered"]);
    expect(failedIds(ctx({ channel: "short_video", creator: { sebiRegistration: "INH000012345" } }))).toEqual([]);
  });
});

describe("status workflow", () => {
  const ok = (r: ReturnType<typeof decideTransition>) => (r.ok ? r : (() => { throw new Error(r.error); })());
  const base = { checklist: buildChecklist(ctx()), today: TODAY };

  it("submits a draft for review", () => {
    expect(ok(decideTransition({ plan: plan(), action: "submit", actor: "maker", ...base })).to).toBe("NEEDS_REVIEW");
  });
  it("will not submit a plan whose promise or creator fails", () => {
    const r = decideTransition({ plan: plan(), action: "submit", actor: "maker", checklist: buildChecklist(ctx({ promiseOk: false })), today: TODAY });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/promise/i) });
    const v = decideTransition({ plan: plan({ channel: "short_video" }), action: "submit", actor: "maker", checklist: buildChecklist(ctx({ channel: "short_video", creator: null })), today: TODAY });
    expect(v).toMatchObject({ ok: false, error: expect.stringMatching(/creator/i) });
  });
  it("approves only when every checklist item passes, a different person decides and the box is ticked", () => {
    const inReview = plan({ status: "NEEDS_REVIEW" });
    expect(ok(decideTransition({ plan: inReview, action: "approve", actor: "checker", confirmed: true, ...base })).to).toBe("APPROVED");
    expect(decideTransition({ plan: inReview, action: "approve", actor: "maker", confirmed: true, ...base })).toMatchObject({ ok: false, error: expect.stringMatching(/different person/i) });
    expect(decideTransition({ plan: inReview, action: "approve", actor: "checker", confirmed: false, ...base })).toMatchObject({ ok: false, error: expect.stringMatching(/confirm/i) });
    const bad = decideTransition({ plan: inReview, action: "approve", actor: "checker", confirmed: true, checklist: buildChecklist(ctx({ linksTested: false })), today: TODAY });
    expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/tracking links tested/i) });
  });
  it("sends a plan back with a note, and a note is required", () => {
    expect(ok(decideTransition({ plan: plan({ status: "NEEDS_REVIEW" }), action: "request_changes", actor: "checker", note: "fix the hook", ...base })).to).toBe("DRAFT");
    expect(decideTransition({ plan: plan({ status: "NEEDS_REVIEW" }), action: "request_changes", actor: "checker", ...base }).ok).toBe(false);
  });
  it("schedules an approved plan that has a start date today or later, as intent only", () => {
    const r = ok(decideTransition({ plan: plan({ status: "APPROVED" }), action: "schedule", actor: "maker", ...base }));
    expect(r.to).toBe("SCHEDULED");
    expect(decideTransition({ plan: plan({ status: "APPROVED", startDate: null }), action: "schedule", actor: "maker", ...base }).ok).toBe(false);
    expect(decideTransition({ plan: plan({ status: "APPROVED", startDate: "2026-10-01" }), action: "schedule", actor: "maker", ...base }).ok).toBe(false);
  });
  it("unschedules back to approved", () => {
    expect(ok(decideTransition({ plan: plan({ status: "SCHEDULED" }), action: "unschedule", actor: "maker", ...base })).to).toBe("APPROVED");
  });
  it("refuses steps out of order", () => {
    expect(decideTransition({ plan: plan({ status: "DRAFT" }), action: "approve", actor: "checker", confirmed: true, ...base }).ok).toBe(false);
    expect(decideTransition({ plan: plan({ status: "DRAFT" }), action: "schedule", actor: "maker", ...base }).ok).toBe(false);
    expect(decideTransition({ plan: plan({ status: "SCHEDULED" }), action: "submit", actor: "maker", ...base }).ok).toBe(false);
  });
  it("an edit sends the plan back to Draft and clears the approval and the tested links", () => {
    const r = ok(decideTransition({ plan: plan({ status: "SCHEDULED", approvedById: "checker" }), action: "edit", actor: "maker", ...base }));
    expect(r.to).toBe("DRAFT");
    expect(r.patch).toMatchObject({ status: "DRAFT", approvedById: null, approvedAt: null, linksTestedAt: null });
  });
  it("an edit of a draft stays a draft", () => {
    expect(ok(decideTransition({ plan: plan(), action: "edit", actor: "maker", ...base })).to).toBe("DRAFT");
  });
});
