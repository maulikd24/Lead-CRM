import { describe, expect, it } from "vitest";

import { buildMemoryView, buildDecisionMemory, describeValue, excludeWithdrawn, sourceLabel, type MemoryRow } from "./view";

const NOW = new Date("2027-06-30T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

let seq = 0;
const row = (over: Partial<MemoryRow> = {}): MemoryRow => ({
  id: `m${++seq}`,
  class: "PREFERENCE",
  key: `preference:k${seq}`,
  value: { text: "Prefers WhatsApp" },
  sourceType: "conversation_ai",
  sourceRef: "insight:i1",
  evidence: [{ sourceRef: "insight:i1", summary: "prefers WhatsApp", observedAt: daysAgo(3).toISOString() }],
  confidence: "LOW",
  observedAt: daysAgo(3),
  freshUntil: daysAhead(100),
  lastReconfirmedAt: null,
  confirmation: "UNCONFIRMED",
  confirmedAt: null,
  disputedReason: null,
  conflictsWithId: null,
  dataClass: "PERSONAL",
  consentBasis: null,
  createdAt: daysAgo(3),
  ...over,
});

const caps = { canManage: true, canSeeCalls: true };

describe("buildMemoryView", () => {
  it("is honestly empty with no rows, and says so", () => {
    const v = buildMemoryView([], caps, NOW);
    expect(v.empty).toBe(true);
    expect(v.groups).toEqual([]);
    expect(v.needsConfirmation).toEqual([]);
  });

  it("groups by class in the spec order and pins do-not-do at the top, outside the groups", () => {
    const v = buildMemoryView(
      [
        row({ class: "INTEREST", key: "interest:PMS", value: { assetClass: "PMS" } }),
        row({ class: "DO_NOT_DO", key: "do_not_do:calls", value: { text: "No calls before 11" }, sourceType: "rm_entry", confirmation: "CONFIRMED" }),
        row({ class: "FACT", key: "fact:employer", value: { text: "Acme" }, sourceType: "rm_entry", confirmation: "CONFIRMED" }),
      ],
      caps,
      NOW,
    );
    expect(v.doNotDo.map((i) => i.key)).toEqual(["do_not_do:calls"]);
    expect(v.groups.map((g) => g.class)).toEqual(["FACT", "INTEREST"]);
  });

  it("caps 'needs your confirmation' at 5 and lists only unconfirmed, fresh, AI-derived items, newest first", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ key: `preference:p${i}`, createdAt: daysAgo(i + 1) }));
    rows.push(row({ key: "preference:human", sourceType: "rm_entry", confirmation: "CONFIRMED" }));
    rows.push(row({ key: "preference:stale", freshUntil: daysAgo(1) }));
    const v = buildMemoryView(rows, caps, NOW);
    expect(v.needsConfirmation).toHaveLength(5);
    expect(v.needsConfirmation.map((i) => i.key)).toEqual(["preference:p0", "preference:p1", "preference:p2", "preference:p3", "preference:p4"]);
    expect(v.counts.unconfirmed).toBe(8);
  });

  it("shows a past-due item as EXPIRED with a stale flag and an honest age line, never as current", () => {
    const v = buildMemoryView([row({ key: "interest:PMS", class: "INTEREST", freshUntil: daysAgo(5), confirmation: "CONFIRMED", sourceType: "rm_entry", observedAt: daysAgo(70), lastReconfirmedAt: daysAgo(70) })], caps, NOW);
    const item = v.groups[0].items[0];
    expect(item.state).toBe("EXPIRED");
    expect(item.stale).toBe(true);
    expect(item.ageLine).toBe("Last confirmed 2 months ago");
    expect(v.counts.expired).toBe(1);
    expect(v.counts.stale).toBe(1);
  });

  it("an AI item that was never confirmed says 'Suggested', not 'Last confirmed'", () => {
    const item = buildMemoryView([row()], caps, NOW).groups[0].items[0];
    expect(item.ageLine).toBe("Suggested 3 days ago, not yet confirmed");
    expect(item.stateLabel).toBe("Needs confirmation");
  });

  it("a disputed item says what it conflicts with and offers confirm as the way to settle it", () => {
    const item = buildMemoryView([row({ confirmation: "DISPUTED", disputedReason: "Conflicts with another item", conflictsWithId: "m0" })], caps, NOW).groups[0].items[0];
    expect(item.state).toBe("DISPUTED");
    expect(item.stateLabel).toBe("Disputed");
    expect(item.conflictNote).toContain("Conflicts");
    expect(item.actions.canConfirm).toBe(true);
  });

  it("actions follow the state and the viewer: nobody who cannot manage gets any, sentiment cannot be confirmed, an expired item cannot be acted on", () => {
    const ai = buildMemoryView([row()], { canManage: false, canSeeCalls: false }, NOW).groups[0].items[0];
    expect(ai.actions).toEqual({ canConfirm: false, canReject: false, canDispute: false, canEdit: false });
    const sentiment = buildMemoryView([row({ class: "SENTIMENT", key: "sentiment:recent", value: { text: "annoyed" } })], caps, NOW).groups[0].items[0];
    expect(sentiment.actions.canConfirm).toBe(false);
    expect(sentiment.actions.canReject).toBe(true);
    const expired = buildMemoryView([row({ freshUntil: daysAgo(1) })], caps, NOW).groups[0].items[0];
    expect(expired.actions).toEqual({ canConfirm: false, canReject: false, canDispute: false, canEdit: false });
    const confirmed = buildMemoryView([row({ confirmation: "CONFIRMED", sourceType: "rm_entry" })], caps, NOW).groups[0].items[0];
    expect(confirmed.actions).toEqual({ canConfirm: false, canReject: true, canDispute: true, canEdit: true });
  });

  it("hides rejected and superseded items from the panel", () => {
    const v = buildMemoryView([row({ confirmation: "REJECTED" }), row({ confirmation: "SUPERSEDED" })], caps, NOW);
    expect(v.empty).toBe(true);
  });

  it("evidence shows redacted summaries only, and the call link only to a viewer who may open calls", () => {
    const r = row({ evidence: [{ sourceRef: "review:r9", summary: "asked to be called", observedAt: daysAgo(1).toISOString() }] });
    const a = buildMemoryView([r], caps, NOW).groups[0].items[0].evidence[0];
    expect(a).toMatchObject({ summary: "asked to be called", href: "/calls/r9" });
    const b = buildMemoryView([r], { canManage: true, canSeeCalls: false }, NOW).groups[0].items[0].evidence[0];
    expect(b.href).toBeNull();
  });

  it("as-of is the newest observation, and the view never claims freshness it does not have", () => {
    const v = buildMemoryView([row({ observedAt: daysAgo(40) }), row({ observedAt: daysAgo(3) })], caps, NOW);
    expect(v.asOf?.toISOString()).toBe(daysAgo(3).toISOString());
    expect(buildMemoryView([], caps, NOW).asOf).toBeNull();
  });
});

describe("helpers", () => {
  it("describeValue prefers text, then a readable summary of the fields", () => {
    expect(describeValue("FACT", { text: "Works at Acme" })).toBe("Works at Acme");
    expect(describeValue("INTEREST", { assetClass: "PMS" })).toBe("PMS");
    expect(describeValue("PRODUCT_STANCE", { assetClass: "PMS", stance: "declined" })).toBe("PMS: declined");
    expect(describeValue("PREFERENCE", "just a string")).toBe("just a string");
  });
  it("sourceLabel", () => {
    expect(sourceLabel("call_ai")).toBe("Read from a call by AI");
    expect(sourceLabel("conversation_ai")).toBe("Read from a conversation by AI");
    expect(sourceLabel("rm_entry")).toBe("Entered by an RM");
    expect(sourceLabel("ledger")).toBe("Consent or do-not-contact ledger");
  });
});

describe("buildDecisionMemory: the read API other modules (decision engine, agents, attention) consume", () => {
  it("separates what may block or drive from what may only downrank or prompt a question, and drops everything else", () => {
    const d = buildDecisionMemory(
      [
        row({ key: "preference:a", confirmation: "CONFIRMED", sourceType: "rm_entry" }),
        row({ key: "preference:b", confirmation: "UNCONFIRMED" }),
        row({ key: "preference:c", confirmation: "DISPUTED" }),
        row({ key: "do_not_do:d", class: "DO_NOT_DO", confirmation: "DISPUTED" }),
        row({ key: "preference:e", confirmation: "REJECTED" }),
        row({ key: "preference:f", confirmation: "CONFIRMED", freshUntil: daysAgo(1) }),
      ],
      NOW,
    );
    expect(d.authoritative.map((i) => i.key).sort()).toEqual(["do_not_do:d", "preference:a"]);
    expect(d.advisory.map((i) => i.key)).toEqual(["preference:b"]);
    expect(d.contested.map((i) => i.key)).toEqual(["preference:c"]);
    expect(d.doNotDo.map((i) => i.key)).toEqual(["do_not_do:d"]);
    expect(d.asOf.toISOString()).toBe(NOW.toISOString());
  });
  it("carries no evidence text and no source text", () => {
    const d = buildDecisionMemory([row()], NOW);
    expect(JSON.stringify(d)).not.toContain("prefers WhatsApp");
  });
});

describe("excludeWithdrawn: a withdrawn consent drops what was derived under it, even before the sweep has run", () => {
  const derived = (over: Partial<MemoryRow> = {}) => row({ consentBasis: "AI_PROCESSING_OF_CHATS", ...over });
  it("drops unconfirmed items derived under a withdrawn purpose, keeps other purposes and human items", () => {
    const kept = excludeWithdrawn([derived({ key: "preference:a" }), row({ key: "preference:b", sourceType: "rm_entry", confirmation: "CONFIRMED" }), derived({ key: "preference:c", consentBasis: "CALL_RECORDING" })], new Set(["AI_PROCESSING_OF_CHATS"]));
    expect(kept.map((r) => r.key)).toEqual(["preference:b", "preference:c"]);
  });
  it("keeps a confirmed item only when a person's own evidence stands behind it", () => {
    const own = derived({ key: "preference:own", confirmation: "CONFIRMED", evidence: [{ sourceRef: "insight:i1", summary: "x", observedAt: "2027-06-01T00:00:00Z" }, { sourceRef: "user:u1", summary: "Confirmed by the RM: said so", observedAt: "2027-06-02T00:00:00Z" }] });
    const click = derived({ key: "preference:click", confirmation: "CONFIRMED" });
    expect(excludeWithdrawn([own, click], new Set(["AI_PROCESSING_OF_CHATS"])).map((r) => r.key)).toEqual(["preference:own"]);
  });
  it("changes nothing when nothing is withdrawn", () => {
    const rows = [derived(), row()];
    expect(excludeWithdrawn(rows, new Set())).toEqual(rows);
  });
});
