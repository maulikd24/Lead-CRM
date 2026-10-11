import { describe, expect, it } from "vitest";

import {
  absorbSuperseded, assemble, consentItem, decodeCursor, encodeCursor, eventItem, goalItem, insightItem, milestoneItems, pageItems, referralItem, stageItem, suppressCoveredEvents, taskItems, ticketItem, type TimelineItem,
} from "./model";

const D = (s: string) => new Date(s);
const item = (over: Partial<TimelineItem> = {}): TimelineItem => ({ id: "x:1", kind: "note", channel: "note", at: "2027-02-01T10:00:00.000Z", title: "t", source: "activity", sourceRef: { table: "Activity", id: "1" }, asOf: "2027-02-01T10:00:00.000Z", ...over });

describe("domain adapters carry a source ref and an as-of time", () => {
  it("stage change", () => {
    const i = stageItem({ id: "s1", fromStage: "Lead", toStage: "KYC", changedAt: D("2027-02-01T09:00:00Z"), byName: "Asha", reason: null, slaMet: false });
    expect(i).toMatchObject({ id: "stage:s1", kind: "stage", source: "stage", sourceRef: { table: "StageHistory", id: "s1" }, title: "Stage: Lead to KYC", actor: "Asha", tone: "warning" });
    expect(i.asOf).toBe("2027-02-01T09:00:00.000Z");
  });
  it("support ticket supersedes the activity created on first sighting", () => {
    const i = ticketItem({ id: "t1", status: "open", subject: "Cannot log in", ticketCreatedAt: D("2027-02-01T08:00:00Z"), createdAt: D("2027-02-01T08:05:00Z"), updatedAt: D("2027-02-02T00:00:00Z"), activityId: "a9", isComplaint: false });
    expect(i).toMatchObject({ id: "ticket:t1", kind: "ticket", sourceRef: { table: "SupportTicket", id: "t1" }, supersedes: ["activity:a9"] });
    expect(i.at).toBe("2027-02-01T08:00:00.000Z");
    expect(i.asOf).toBe("2027-02-02T00:00:00.000Z");
  });
  it("a ticket with no external created time falls back to the row's", () => expect(ticketItem({ id: "t", status: null, subject: null, ticketCreatedAt: null, createdAt: D("2027-02-01T08:05:00Z"), updatedAt: D("2027-02-01T08:05:00Z"), activityId: null, isComplaint: false }).at).toBe("2027-02-01T08:05:00.000Z"));
  it("consent change shows purpose, channel and whether it was granted or withdrawn", () => {
    expect(consentItem({ id: "c1", purpose: "MARKETING_COMMS", channel: "WHATSAPP", status: "WITHDRAWN", capturedAt: D("2027-02-01T09:00:00Z"), source: "crm" })).toMatchObject({ kind: "consent", title: "Consent withdrawn: marketing comms (WhatsApp)", tone: "warning", sourceRef: { table: "ConsentRecord", id: "c1" } });
    expect(consentItem({ id: "c2", purpose: "SERVICE_COMMS", channel: null, status: "GRANTED", capturedAt: D("2027-02-01T09:00:00Z"), source: "crm" })).toMatchObject({ title: "Consent granted: service comms", tone: "positive" });
  });
  it("open task shows once; a done task is absorbed by its completed activity, else shown as completed", () => {
    const open = taskItems({ id: "k1", title: "Call back", status: "PENDING", dueAt: D("2027-02-05T00:00:00Z"), createdAt: D("2027-02-01T00:00:00Z"), updatedAt: D("2027-02-01T00:00:00Z") }, { completedActivities: [], now: D("2027-02-02T00:00:00Z") });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: "task", title: "Task: Call back", sourceRef: { table: "Task", id: "k1" } });
    const doneWith = taskItems({ id: "k2", title: "Send form", status: "DONE", dueAt: D("2027-02-05T00:00:00Z"), createdAt: D("2027-02-01T00:00:00Z"), updatedAt: D("2027-02-03T00:00:00Z") }, { completedActivities: [{ id: "a1", message: "Completed task: Send form", at: D("2027-02-03T00:00:10Z") }], now: D("2027-02-04T00:00:00Z") });
    expect(doneWith).toEqual([]);
    const doneWithout = taskItems({ id: "k3", title: "Send form", status: "DONE", dueAt: D("2027-02-05T00:00:00Z"), createdAt: D("2027-02-01T00:00:00Z"), updatedAt: D("2027-02-03T00:00:00Z") }, { completedActivities: [], now: D("2027-02-04T00:00:00Z") });
    expect(doneWithout[0]).toMatchObject({ title: "Task completed: Send form", tone: "positive" });
  });
  it("an overdue open task is a warning", () => {
    expect(taskItems({ id: "k4", title: "Late", status: "PENDING", dueAt: D("2027-02-01T00:00:00Z"), createdAt: D("2027-01-30T00:00:00Z"), updatedAt: D("2027-01-30T00:00:00Z") }, { completedActivities: [], now: D("2027-02-03T00:00:00Z") })[0].tone).toBe("warning");
  });
  it("complaints and commitments from conversation insights", () => {
    expect(insightItem({ id: "i1", kind: "COMPLAINT", status: "OPEN", text: "x", severity: "high", dueAt: null, occurredAt: D("2027-02-01T09:00:00Z"), resolvedAt: null, createdAt: D("2027-02-01T09:00:00Z") })).toMatchObject({ kind: "complaint", title: "Complaint raised (high)", tone: "negative", sourceRef: { table: "ConversationInsight", id: "i1" } });
    expect(insightItem({ id: "i2", kind: "COMMITMENT", status: "OPEN", text: "send factsheet", severity: null, dueAt: D("2027-02-10T00:00:00Z"), occurredAt: D("2027-02-01T09:00:00Z"), resolvedAt: null, createdAt: D("2027-02-01T09:00:00Z") })).toMatchObject({ kind: "commitment", title: "Commitment made", detail: "Due 10 Feb 2027" });
    expect(insightItem({ id: "i3", kind: "INTEREST", status: "OPEN", text: "x", severity: null, dueAt: null, occurredAt: D("2027-02-01T09:00:00Z"), resolvedAt: null, createdAt: D("2027-02-01T09:00:00Z") })).toBeNull();
  });
  it("a resolved complaint is not shown as negative", () => {
    expect(insightItem({ id: "i4", kind: "COMPLAINT", status: "RESOLVED", text: "x", severity: "low", dueAt: null, occurredAt: D("2027-02-01T09:00:00Z"), resolvedAt: D("2027-02-02T09:00:00Z"), createdAt: D("2027-02-01T09:00:00Z") })?.tone).toBe("positive");
  });
  it("KYC and funding milestones", () => {
    const items = milestoneItems({ id: "k", status: "APPROVED", submissionDate: D("2027-02-01T00:00:00Z"), completionDate: D("2027-02-03T00:00:00Z"), updatedAt: D("2027-02-03T00:00:00Z") }, { id: "f", status: "FULLY_FUNDED", fundingDate: D("2027-02-05T00:00:00Z"), updatedAt: D("2027-02-05T00:00:00Z") });
    expect(items.map((i) => i.title)).toEqual(["KYC submitted", "KYC approved", "Account funded"]);
    expect(items.every((i) => i.kind === "milestone")).toBe(true);
    expect(items[1].sourceRef).toEqual({ table: "KycRecord", id: "k" });
    expect(milestoneItems(null, { id: "f", status: "PENDING", fundingDate: null, updatedAt: D("2027-02-05T00:00:00Z") })).toEqual([]);
  });
  it("goals and referrals", () => {
    expect(goalItem({ id: "g", name: "Retirement", createdAt: D("2027-02-01T00:00:00Z"), updatedAt: D("2027-02-01T00:00:00Z") })).toMatchObject({ kind: "goal", title: "Goal set: Retirement" });
    expect(referralItem({ id: "r", outcome: "ATTRIBUTED", attributedAt: D("2027-02-01T00:00:00Z") })).toMatchObject({ kind: "referral", title: "Referral attributed" });
  });
});

describe("events", () => {
  const ev = (over: Record<string, unknown> = {}) => ({ id: "row1", eventType: "lead.assigned", occurredAt: D("2027-02-01T09:00:00Z"), receivedAt: D("2027-02-01T09:00:05Z"), actorType: "user", metadata: { ref: { table: "Client", id: "c1" } }, late: false, schemaVersion: 1, ...over });
  it("a fact is shown with a human title, its source ref and the time it was received as as-of", () => {
    expect(eventItem(ev())).toMatchObject({ id: "event:row1", kind: "fact", source: "event", title: "Lead assigned", sourceRef: { table: "Client", id: "c1" }, asOf: "2027-02-01T09:00:05.000Z" });
  });
  it("uses occurred_at for the position, so a late event sorts where it happened", () => {
    expect(eventItem(ev({ occurredAt: D("2027-01-01T00:00:00Z") }))!.at).toBe("2027-01-01T00:00:00.000Z");
    expect(eventItem(ev({ late: true }))).toMatchObject({ detail: "Reported late" });
  });
  it("an event of an erased customer (metadata gone) still reads", () => expect(eventItem(ev({ metadata: null }))).toMatchObject({ title: "Lead assigned", sourceRef: null }));
  it("an unknown event type is shown by its name, never throws", () => expect(eventItem(ev({ eventType: "lead.future_thing" }))).toMatchObject({ title: "Lead future thing" }));
  it("a fact whose domain record is already on the timeline is not shown twice (the domain table is authoritative)", () => {
    const domain = [item({ id: "message:m1", source: "message", sourceRef: { table: "Message", id: "m1" } })];
    const covered = eventItem(ev({ eventType: "whatsapp.message.received", metadata: { ref: { table: "Message", id: "m1" } } }))!;
    const other = eventItem(ev({ id: "row2", metadata: { ref: { table: "Client", id: "c1" } } }))!;
    expect(suppressCoveredEvents([covered, other], domain).map((i) => i.id)).toEqual(["event:row2"]);
  });
  it("noisy delivery receipts are not shown", () => {
    expect(eventItem(ev({ eventType: "whatsapp.message.delivered" }))).toBeNull();
    expect(eventItem(ev({ eventType: "whatsapp.message.read" }))).toBeNull();
  });
});

describe("absorbSuperseded", () => {
  it("drops the legacy items an item says it supersedes", () => {
    const items = [item({ id: "activity:a9" }), item({ id: "ticket:t1", supersedes: ["activity:a9"] }), item({ id: "activity:a1" })];
    expect(absorbSuperseded(items).map((i) => i.id)).toEqual(["ticket:t1", "activity:a1"]);
  });
  it("a stage item absorbs the STAGE_CHANGE activity of the same move (same stages, within a minute), and only that one", () => {
    const activities = [
      item({ id: "activity:a1", kind: "stage", at: "2027-02-01T09:00:03.000Z", title: "Stage: Lead to KYC" }),
      item({ id: "activity:a2", kind: "stage", at: "2027-02-01T09:30:00.000Z", title: "Stage: Lead to KYC" }),
    ];
    const stage = stageItem({ id: "s1", fromStage: "Lead", toStage: "KYC", changedAt: D("2027-02-01T09:00:00Z"), byName: null, reason: null, slaMet: null });
    const out = absorbSuperseded([...activities, stage]);
    expect(out.map((i) => i.id).sort()).toEqual(["activity:a2", "stage:s1"]);
    expect(out.find((i) => i.id === "stage:s1")!.supersedes).toEqual(["activity:a1"]); // recorded, so equivalence with the old timeline is provable
  });
});

describe("pagination", () => {
  const items = ["10:05", "10:04", "10:04", "10:03", "10:02", "10:01"].map((t, i) => item({ id: `x:${i}`, at: `2027-02-01T${t}:00.000Z` }));
  it("orders newest first, ties by id, and returns a cursor while there is more", () => {
    const page = pageItems([...items].reverse(), { limit: 2 });
    expect(page.items.map((i) => i.id)).toEqual(["x:0", "x:1"]);
    expect(page.nextCursor).toBeTruthy();
  });
  it("the next page starts after the cursor with no gap and no repeat, including items with the same time", () => {
    const first = pageItems(items, { limit: 2 });
    const second = pageItems(items, { limit: 2, before: first.nextCursor! });
    expect(second.items.map((i) => i.id)).toEqual(["x:2", "x:3"]);
    const third = pageItems(items, { limit: 2, before: second.nextCursor! });
    expect(third.items.map((i) => i.id)).toEqual(["x:4", "x:5"]);
    expect(third.nextCursor).toBeNull();
  });
  it("cursors round-trip and a malformed cursor is ignored, never thrown", () => {
    expect(decodeCursor(encodeCursor("2027-02-01T10:00:00.000Z", "x:1"))).toEqual({ at: "2027-02-01T10:00:00.000Z", id: "x:1" });
    expect(decodeCursor("garbage")).toBeNull();
    expect(pageItems(items, { limit: 2, before: "garbage" }).items).toHaveLength(2);
  });
  it("clamps the limit", () => {
    expect(pageItems(items, { limit: 0 }).items.length).toBeGreaterThanOrEqual(1);
    expect(pageItems(items, { limit: 10_000 }).items.length).toBe(items.length);
  });
});

describe("assemble", () => {
  const now = D("2027-02-10T00:00:00Z");
  const at = (n: number) => `2027-02-01T10:0${n}:00.000Z`;
  const make = (id: string, n: number, over: Partial<TimelineItem> = {}) => item({ id, at: at(n), asOf: at(n), ...over });

  it("merges sources newest first and reports freshness per source", () => {
    const out = assemble([{ source: "activity", items: [make("activity:1", 1), make("activity:3", 3)], capped: false }, { source: "message", items: [make("message:2", 2, { source: "message" })], capped: false }], { now });
    expect(out.items.map((i) => i.id)).toEqual(["activity:3", "message:2", "activity:1"]);
    expect(out.olderNotShown).toBe(false);
    expect(out.freshness.sources.message).toEqual({ count: 1, newestAsOf: at(2), capped: false });
    expect(out.freshness.generatedAt).toBe(now.toISOString());
  });
  it("a capped source cuts everything older than its oldest item, and says older activity exists", () => {
    const out = assemble([{ source: "activity", items: [make("activity:5", 5), make("activity:4", 4)], capped: true }, { source: "message", items: [make("message:1", 1, { source: "message" }), make("message:6", 6, { source: "message" })], capped: false }], { now });
    expect(out.items.map((i) => i.id)).toEqual(["message:6", "activity:5", "activity:4"]);
    expect(out.olderNotShown).toBe(true);
    expect(out.nextCursor).toBeTruthy();
  });
  it("a fact that only repeats a domain record is dropped, a fact with no domain record stays", () => {
    const out = assemble([
      { source: "message", items: [make("message:m1", 2, { source: "message", sourceRef: { table: "Message", id: "m1" } })], capped: false },
      { source: "event", items: [make("event:e1", 2, { source: "event", sourceRef: { table: "Message", id: "m1" } }), make("event:e2", 3, { source: "event", sourceRef: { table: "Client", id: "c1" } })], capped: false },
    ], { now });
    expect(out.items.map((i) => i.id)).toEqual(["event:e2", "message:m1"]);
  });
  it("absorbs superseded items and de-duplicates by id", () => {
    const out = assemble([{ source: "activity", items: [make("activity:a9", 1), make("activity:a9", 1)], capped: false }, { source: "ticket", items: [make("ticket:t1", 1, { source: "ticket", supersedes: ["activity:a9"] })], capped: false }], { now });
    expect(out.items.map((i) => i.id)).toEqual(["ticket:t1"]);
  });
  it("pages with a cursor and reports more when the page is full", () => {
    const items = [1, 2, 3, 4].map((n) => make(`activity:${n}`, n));
    const first = assemble([{ source: "activity", items, capped: false }], { now, limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(["activity:4", "activity:3"]);
    const second = assemble([{ source: "activity", items, capped: false }], { now, limit: 2, before: first.nextCursor });
    expect(second.items.map((i) => i.id)).toEqual(["activity:2", "activity:1"]);
    expect(second.nextCursor).toBeNull();
  });
});
