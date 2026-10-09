import { describe, expect, it } from "vitest";
import { buildTimelineMessage, isHandoffPayload, normalizeHandoff, scrubForLog, scrubStored, LIMITS } from "./normalize";

const base = {
  ticket_id: 4321,
  requester_email: "Riya@Example.com ",
  requester_phone: "+91 98765-43210",
  requester_name: "Riya Sharma",
  subject: "Cannot see my KYC status",
  priority: 3,
  status: 2,
  channel: "Live Chat",
  tags: "ai_handoff, kyc",
  ai_summary: "Customer asked about KYC status twice. Verified by OTP. Wants a person to call.",
  ai_intent: "KYC status",
  ai_sentiment: "neutral",
  updated_at: "2026-10-09T10:00:00Z",
};

describe("isHandoffPayload", () => {
  it("accepts the ai_handoff tag in a string or array, any case", () => {
    expect(isHandoffPayload(base)).toBe(true);
    expect(isHandoffPayload({ ...base, tags: ["AI_Handoff"] })).toBe(true);
    expect(isHandoffPayload({ event: "ai_handoff", ticket_id: 1 })).toBe(true);
  });
  it("rejects ordinary ticket events and junk", () => {
    expect(isHandoffPayload({ ticket_id: 1, tags: "vip" })).toBe(false);
    expect(isHandoffPayload(null)).toBe(false);
    expect(isHandoffPayload("ai_handoff")).toBe(false);
    expect(isHandoffPayload([base])).toBe(false);
  });
});

describe("normalizeHandoff", () => {
  it("normalises a well-formed payload", () => {
    const r = normalizeHandoff(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.handoff).toMatchObject({
      ticketId: "4321",
      contact: { email: "riya@example.com", phone: "+91 98765-43210", name: "Riya Sharma" },
      priority: "high",
      effectivePriority: "high",
      status: "open",
      channel: "Live Chat",
      intent: "KYC status",
      sentiment: "neutral",
      escalation: { negativeSentiment: false, handoverReason: null },
    });
    expect(r.handoff.tags).toEqual(["ai_handoff", "kyc"]);
    expect(r.handoff.updatedAt?.toISOString()).toBe("2026-10-09T10:00:00.000Z");
  });
  it("skips with no contact", () => {
    expect(normalizeHandoff({ ...base, requester_email: undefined, requester_phone: "12" })).toEqual({ ok: false, reason: "no_contact" });
  });
  it("skips without a ticket id and for non hand-offs", () => {
    expect(normalizeHandoff({ ...base, ticket_id: undefined })).toEqual({ ok: false, reason: "no_ticket_id" });
    expect(normalizeHandoff({ ...base, tags: "vip" })).toEqual({ ok: false, reason: "not_handoff" });
    expect(normalizeHandoff(42)).toEqual({ ok: false, reason: "invalid" });
  });
  it("tolerates wrong types and unknown fields without throwing", () => {
    const r = normalizeHandoff({ ...base, subject: { x: 1 }, priority: "weird", status: ["a"], tags: 5, event: "ai_handoff", extra: { deep: [1] }, ai_sentiment: 9 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.handoff).toMatchObject({ priority: "medium", status: "open", sentiment: "neutral", subject: "" });
  });
  it("caps oversized fields and the transcript excerpt", () => {
    const big = "x".repeat(50_000);
    const r = normalizeHandoff({ ...base, ai_summary: big, subject: big, ai_intent: big, transcript: big, tags: ["ai_handoff", ...Array(500).fill("t")] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.handoff.summary.length).toBeLessThanOrEqual(LIMITS.summary);
    expect(r.handoff.subject.length).toBeLessThanOrEqual(LIMITS.subject);
    expect(r.handoff.intent.length).toBeLessThanOrEqual(LIMITS.intent);
    expect(r.handoff.excerpt.length).toBeLessThanOrEqual(LIMITS.excerpt);
    expect(r.handoff.tags.length).toBeLessThanOrEqual(LIMITS.tags);
  });
  it("accepts a transcript array and keeps only a capped excerpt", () => {
    const r = normalizeHandoff({ ...base, transcript: [{ role: "customer", text: "hello" }, { role: "bot", text: "hi" }, "free text line"] });
    expect(r.ok && r.handoff.excerpt).toContain("customer: hello");
  });
  it("redacts PAN, long digit runs and html in stored text", () => {
    const r = normalizeHandoff({ ...base, ai_summary: "<b>PAN ABCDE1234F</b> acct 123456789012 <script>alert(1)</script>ok", transcript: "my pan is abcde1234f" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.handoff.summary).not.toMatch(/ABCDE1234F|123456789012|<|script/i);
    expect(r.handoff.summary).toContain("[redacted]");
    expect(r.handoff.excerpt).not.toMatch(/abcde1234f/i);
  });
  it("only keeps https ticket links", () => {
    const ok = normalizeHandoff({ ...base, ticket_url: "https://acme.freshdesk.com/a/tickets/4321" });
    const bad = normalizeHandoff({ ...base, ticket_url: "javascript:alert(1)" });
    expect(ok.ok && ok.handoff.ticketUrl).toBe("https://acme.freshdesk.com/a/tickets/4321");
    expect(bad.ok && bad.handoff.ticketUrl).toBeUndefined();
  });
  it("negative sentiment raises priority to high and flags escalation", () => {
    const r = normalizeHandoff({ ...base, priority: "low", ai_sentiment: "Very Negative" });
    expect(r.ok && r.handoff).toMatchObject({ priority: "low", effectivePriority: "high", sentiment: "negative", escalation: { negativeSentiment: true } });
  });
  it("compliance words raise priority to high with a reason, urgent stays urgent", () => {
    const r = normalizeHandoff({ ...base, priority: "low", ai_summary: "Customer threatens to complain to SEBI" });
    expect(r.ok && r.handoff.effectivePriority).toBe("high");
    expect(r.ok && r.handoff.escalation.handoverReason).toContain("complain");
    const u = normalizeHandoff({ ...base, priority: 4, ai_sentiment: "negative" });
    expect(u.ok && u.handoff.effectivePriority).toBe("urgent");
  });
});

describe("text helpers", () => {
  it("builds the human timeline message", () => {
    const r = normalizeHandoff(base);
    if (!r.ok) throw new Error("x");
    const m = buildTimelineMessage(r.handoff);
    expect(m.startsWith("Support hand-off: KYC status")).toBe(true);
    expect(m).toContain("Wants a person to call");
    expect(m.length).toBeLessThan(400);
  });
  it("scrubForLog masks contact details and truncates", () => {
    const s = scrubForLog("mail riya@example.com phone +91 98765 43210 PAN ABCDE1234F " + "z".repeat(500));
    expect(s).not.toMatch(/riya@|98765|ABCDE/);
    expect(s.length).toBeLessThanOrEqual(160);
  });
  it("scrubStored strips control characters", () => expect(scrubStored("a\u0000b‮c")).toBe("abc"));
});
