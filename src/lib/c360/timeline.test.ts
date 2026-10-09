import { describe, expect, it } from "vitest";

import {
  FILTERS,
  filterTimeline,
  fromActivity,
  fromMessage,
  fromOutcome,
  fromProposal,
  fromJourneyRun,
  fromTransaction,
  groupByDay,
  mergeTimeline,
  isFresh,
  type TimelineEvent,
} from "./timeline";

const at = (iso: string) => new Date(iso);
const ev = (over: Partial<TimelineEvent> & Pick<TimelineEvent, "id" | "at">): TimelineEvent => ({ kind: "note", channel: "note", title: "t", ...over });

describe("source adapters", () => {
  it("maps a note activity", () => {
    expect(fromActivity({ id: "a1", type: "NOTE", payload: { message: "Spoke about SIP" }, createdAt: at("2026-10-08T10:00:00Z"), userName: "RM Raj" })).toMatchObject({
      id: "activity:a1", kind: "note", channel: "note", title: "Note", detail: "Spoke about SIP", actor: "RM Raj", at: "2026-10-08T10:00:00.000Z",
    });
  });
  it("maps call activities with direction and duration", () => {
    const e = fromActivity({ id: "a2", type: "CALL", payload: {}, createdAt: at("2026-10-08T10:00:00Z"), userName: null, call: { direction: "OUTGOING", durationSeconds: 185 } });
    expect(e).toMatchObject({ kind: "call", channel: "call", title: "Outgoing call", detail: "3m 5s" });
    expect(fromActivity({ id: "a3", type: "CALL", payload: {}, createdAt: at("2026-10-08T10:00:00Z"), userName: null, call: { direction: "MISSED", durationSeconds: 0 } })).toMatchObject({ title: "Missed call", tone: "warning" });
  });
  it("maps stage changes, tickets, journey and meeting activities", () => {
    expect(fromActivity({ id: "s", type: "STAGE_CHANGE", payload: { fromStage: "Lead", toStage: "KYC" }, createdAt: at("2026-10-08T10:00:00Z"), userName: null })).toMatchObject({ kind: "stage", title: "Stage: Lead to KYC" });
    expect(fromActivity({ id: "t", type: "TICKET", payload: { ticketId: "42", status: "OPEN" }, createdAt: at("2026-10-08T10:00:00Z"), userName: null })).toMatchObject({ kind: "ticket", channel: "system", title: "Support ticket OPEN" });
    expect(fromActivity({ id: "j", type: "JOURNEY_EVENT", payload: { message: "Welcome journey started" }, createdAt: at("2026-10-08T10:00:00Z"), userName: null })).toMatchObject({ kind: "journey", detail: "Welcome journey started" });
    expect(fromActivity({ id: "m", type: "MEETING", payload: { message: "Portfolio review" }, createdAt: at("2026-10-08T10:00:00Z"), userName: null })).toMatchObject({ kind: "meeting", channel: "meeting" });
  });
  it("tolerates a null or odd payload", () => {
    expect(fromActivity({ id: "x", type: "NOTE", payload: null, createdAt: at("2026-10-08T10:00:00Z"), userName: null }).detail).toBeUndefined();
    expect(fromActivity({ id: "y", type: "NOTE", payload: "text", createdAt: at("2026-10-08T10:00:00Z"), userName: null }).detail).toBeUndefined();
  });
  it("truncates long details", () => {
    const e = fromActivity({ id: "z", type: "NOTE", payload: { message: "x".repeat(900) }, createdAt: at("2026-10-08T10:00:00Z"), userName: null });
    expect(e.detail!.length).toBeLessThanOrEqual(281);
  });
  it("maps messages by channel and direction", () => {
    expect(fromMessage({ id: "m1", channel: "whatsapp", direction: "INBOUND", body: "Please share the statement", status: "READ", createdAt: at("2026-10-08T10:00:00Z") })).toMatchObject({ kind: "message", channel: "whatsapp", title: "WhatsApp received", detail: "Please share the statement" });
    expect(fromMessage({ id: "m2", channel: "sms", direction: "OUTBOUND", body: "Hi", status: "FAILED", createdAt: at("2026-10-08T10:00:00Z") })).toMatchObject({ channel: "sms", title: "SMS sent", tone: "warning" });
    expect(fromMessage({ id: "m3", channel: "weird", direction: "OUTBOUND", body: "Hi", status: "SENT", createdAt: at("2026-10-08T10:00:00Z") }).channel).toBe("message");
  });
  it("maps outcomes", () => {
    expect(fromOutcome({ id: "o1", outcome: "INTERESTED", channel: "CALL", assetClass: "PMS", note: "Wants a deck", summary: null, createdAt: at("2026-10-08T10:00:00Z") })).toMatchObject({ kind: "outcome", channel: "call", title: "Outcome: Interested (PMS)", tone: "positive" });
    expect(fromOutcome({ id: "o2", outcome: "NOT_INTERESTED", channel: "AI_BOT", assetClass: null, note: null, summary: "Declined", createdAt: at("2026-10-08T10:00:00Z") })).toMatchObject({ channel: "ai", title: "Outcome: Not interested", detail: "Declined" });
  });
  it("maps agent drafts and never shows a draft as sent", () => {
    expect(fromProposal({ id: "p1", status: "DRAFT", channel: "whatsapp", body: "Hello", reason: "KYC pending", createdAt: at("2026-10-08T10:00:00Z") })).toMatchObject({ kind: "agent", channel: "ai", title: "AI draft awaiting approval", detail: "Hello" });
    expect(fromProposal({ id: "p2", status: "REJECTED", channel: "whatsapp", body: "Hello", reason: "r", createdAt: at("2026-10-08T10:00:00Z") }).title).toBe("AI draft rejected");
  });
  it("maps journey runs and transactions", () => {
    expect(fromJourneyRun({ id: "r1", journeyName: "Welcome", status: "COMPLETED", startedAt: at("2026-10-08T10:00:00Z") })).toMatchObject({ kind: "journey", title: "Journey Welcome completed" });
    expect(fromTransaction({ id: "x1", type: "SIP", productName: "Synthetic Fund", amount: 25000, date: at("2026-10-08T10:00:00Z") })).toMatchObject({ kind: "transaction", channel: "money", title: "SIP: Synthetic Fund", detail: "INR 25,000" });
  });
});

describe("mergeTimeline", () => {
  it("sorts newest first, dedupes by id and caps", () => {
    const merged = mergeTimeline([[ev({ id: "a", at: "2026-10-01T00:00:00.000Z" }), ev({ id: "b", at: "2026-10-03T00:00:00.000Z" })], [ev({ id: "a", at: "2026-10-01T00:00:00.000Z" }), ev({ id: "c", at: "2026-10-02T00:00:00.000Z" })]], 10);
    expect(merged.map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect(mergeTimeline([[ev({ id: "a", at: "2026-10-01T00:00:00.000Z" }), ev({ id: "b", at: "2026-10-03T00:00:00.000Z" })]], 1).map((e) => e.id)).toEqual(["b"]);
  });
  it("is stable for equal timestamps and drops invalid dates", () => {
    const merged = mergeTimeline([[ev({ id: "a", at: "2026-10-01T00:00:00.000Z" }), ev({ id: "b", at: "2026-10-01T00:00:00.000Z" }), ev({ id: "bad", at: "not a date" })]], 10);
    expect(merged.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("filterTimeline", () => {
  const events = [ev({ id: "1", at: "2026-10-01T00:00:00.000Z", kind: "call" }), ev({ id: "2", at: "2026-10-01T00:00:00.000Z", kind: "note" }), ev({ id: "3", at: "2026-10-01T00:00:00.000Z", kind: "transaction" }), ev({ id: "4", at: "2026-10-01T00:00:00.000Z", kind: "agent" })];
  it("returns everything for 'all'", () => expect(filterTimeline(events, "all")).toHaveLength(4));
  it("filters by group", () => {
    expect(filterTimeline(events, "conversations").map((e) => e.id)).toEqual(["1"]);
    expect(filterTimeline(events, "money").map((e) => e.id)).toEqual(["3"]);
    expect(filterTimeline(events, "ai").map((e) => e.id)).toEqual(["4"]);
  });
  it("exposes the filter list with 'all' first", () => expect(FILTERS[0].key).toBe("all"));
});

describe("groupByDay", () => {
  const now = new Date("2026-10-09T12:00:00Z"); // 17:30 IST on the 9th
  it("groups by IST calendar day with relative labels", () => {
    const groups = groupByDay(
      [
        ev({ id: "1", at: "2026-10-09T11:00:00.000Z" }),
        ev({ id: "2", at: "2026-10-08T19:00:00.000Z" }), // 00:30 IST on the 9th: still today
        ev({ id: "3", at: "2026-10-08T05:00:00.000Z" }),
        ev({ id: "4", at: "2026-10-01T05:00:00.000Z" }),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.events.map((e) => e.id)])).toEqual([
      ["Today", ["1", "2"]],
      ["Yesterday", ["3"]],
      ["Thu, 1 Oct 2026", ["4"]],
    ]);
  });
  it("returns nothing for no events", () => expect(groupByDay([], now)).toEqual([]));
});

describe("isFresh", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("is true within the window only", () => {
    expect(isFresh("2026-10-09T11:50:00.000Z", now)).toBe(true);
    expect(isFresh("2026-10-09T10:00:00.000Z", now)).toBe(false);
    expect(isFresh("2026-10-09T12:30:00.000Z", now)).toBe(true);
  });
});

import { formatClock } from "./timeline";

describe("formatClock", () => {
  it("renders India time as 24h HH:MM", () => {
    expect(formatClock("2026-10-09T11:00:00.000Z")).toBe("16:30");
    expect(formatClock("2026-10-08T19:00:00.000Z")).toBe("00:30");
    expect(formatClock("bad")).toBe("");
  });
});

import { dropMirroredMessageActivities, mergeCapped } from "./timeline";

describe("dropMirroredMessageActivities", () => {
  const msg = (id: string, direction: string, body: string, iso: string, channel = "whatsapp") => ({ id, channel, direction, body, status: "SENT", createdAt: at(iso) });
  const act = (id: string, payload: unknown, iso: string, type = "MESSAGE") => ({ id, type, payload, createdAt: at(iso), userName: null });

  it("drops the MESSAGE activity that mirrors a Message row (WhatsApp send, inbound, SMS) and keeps the row", () => {
    const messages = [msg("m1", "OUTBOUND", "Statement attached", "2026-10-08T10:00:00Z"), msg("m2", "INBOUND", "Thanks", "2026-10-08T10:05:00Z"), msg("m3", "OUTBOUND", "SIP due", "2026-10-07T09:00:00Z", "sms")];
    const activities = [
      act("a1", { direction: "OUTBOUND", channel: "whatsapp", body: "Statement attached" }, "2026-10-08T10:00:01Z"),
      act("a2", { direction: "INBOUND", channel: "whatsapp", body: "Thanks" }, "2026-10-08T10:05:02Z"),
      act("a3", { direction: "OUTBOUND", channel: "sms", body: "SIP due", status: "SENT" }, "2026-10-07T09:00:00Z"),
    ];
    expect(dropMirroredMessageActivities(activities, messages)).toEqual([]);
  });
  it("keeps a CleverTap campaign MESSAGE activity (no Message row, source/eventType payload)", () => {
    const a = act("c1", { source: "clevertap", eventType: "campaign_event", channel: "WhatsApp", campaign: "SIP nudge" }, "2026-10-08T10:00:00Z");
    expect(dropMirroredMessageActivities([a], [msg("m1", "OUTBOUND", "other", "2026-10-08T10:00:00Z")])).toEqual([a]);
  });
  it("keeps a MESSAGE activity whose body only differs, or that is far from any message, or has no body", () => {
    const messages = [msg("m1", "OUTBOUND", "Hello", "2026-10-08T10:00:00Z")];
    const different = act("a1", { direction: "OUTBOUND", channel: "whatsapp", body: "Goodbye" }, "2026-10-08T10:00:00Z");
    const far = act("a2", { direction: "OUTBOUND", channel: "whatsapp", body: "Hello" }, "2026-10-08T12:00:00Z");
    const noBody = act("a3", { direction: "OUTBOUND", channel: "whatsapp" }, "2026-10-08T10:00:00Z");
    expect(dropMirroredMessageActivities([different, far, noBody], messages)).toHaveLength(3);
  });
  it("never touches other activity types", () => {
    const note = act("n1", { message: "Hello" }, "2026-10-08T10:00:00Z", "NOTE");
    expect(dropMirroredMessageActivities([note], [msg("m1", "OUTBOUND", "Hello", "2026-10-08T10:00:00Z")])).toEqual([note]);
  });
  it("matches one message to at most one activity", () => {
    const messages = [msg("m1", "OUTBOUND", "Hi", "2026-10-08T10:00:00Z")];
    const twins = [act("a1", { direction: "OUTBOUND", channel: "whatsapp", body: "Hi" }, "2026-10-08T10:00:00Z"), act("a2", { direction: "OUTBOUND", channel: "whatsapp", body: "Hi" }, "2026-10-08T10:00:30Z")];
    expect(dropMirroredMessageActivities(twins, messages).map((x) => x.id)).toEqual(["a2"]);
  });
  it("a message appears exactly once after fromActivity/fromMessage + merge", () => {
    const messages = [msg("m1", "OUTBOUND", "Hi", "2026-10-08T10:00:00Z")];
    const activities = dropMirroredMessageActivities([act("a1", { direction: "OUTBOUND", channel: "whatsapp", body: "Hi" }, "2026-10-08T10:00:00Z")], messages);
    const merged = mergeTimeline([activities.map(fromActivity), messages.map(fromMessage)]);
    expect(merged).toHaveLength(1);
  });
});

describe("mergeCapped", () => {
  const e = (id: string, iso: string) => ev({ id, at: iso });
  it("marks nothing when no source hit its cap", () => {
    const r = mergeCapped([{ events: [e("a", "2026-10-03T00:00:00.000Z")], capped: false }, { events: [e("b", "2026-10-01T00:00:00.000Z")], capped: false }], 10);
    expect(r).toEqual({ events: [e("a", "2026-10-03T00:00:00.000Z"), e("b", "2026-10-01T00:00:00.000Z")], olderNotShown: false });
  });
  it("cuts at the newest of the oldest timestamps of capped sources and flags it", () => {
    const r = mergeCapped(
      [
        { events: [e("a1", "2026-10-09T00:00:00.000Z"), e("a2", "2026-10-07T00:00:00.000Z")], capped: true }, // complete back to 07
        { events: [e("b1", "2026-10-08T00:00:00.000Z"), e("b2", "2026-10-05T00:00:00.000Z")], capped: true }, // complete back to 05
        { events: [e("c1", "2026-10-01T00:00:00.000Z")], capped: false },
      ],
      10,
    );
    expect(r.events.map((x) => x.id)).toEqual(["a1", "b1", "a2"]);
    expect(r.olderNotShown).toBe(true);
  });
  it("flags when the overall cap trims", () => {
    const r = mergeCapped([{ events: [e("a", "2026-10-03T00:00:00.000Z"), e("b", "2026-10-02T00:00:00.000Z")], capped: false }], 1);
    expect(r).toMatchObject({ olderNotShown: true });
    expect(r.events).toHaveLength(1);
  });
});
