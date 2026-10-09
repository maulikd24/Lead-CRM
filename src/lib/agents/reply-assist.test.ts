import { describe, expect, it } from "vitest";
import { FakeProvider, type LlmRequest } from "@/lib/ai/provider";
import {
  REPLY_COOLDOWN_MS, detectLanguage, minimiseExcerpt, scrubForVendor, suggestReply, unansweredInbound,
  EXCERPT_MAX_MESSAGES, EXCERPT_MAX_TOTAL_CHARS, EXCERPT_MAX_MESSAGE_CHARS,
  type ConvMessage, type OpenProposal, type ReplyAssistDeps, type NewReplyProposal,
} from "./reply-assist";

const T0 = new Date("2026-10-09T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const msg = (direction: "INBOUND" | "OUTBOUND", body: string, min: number): ConvMessage => ({ direction, body, at: at(min) });

describe("scrubForVendor", () => {
  it("removes emails, PAN, phone numbers and long digit runs", () => {
    const out = scrubForVendor("mail me at riya.s@example.com, PAN ABCDE1234F, call +91 98765 43210 or 9876543210, acct 1234567");
    expect(out).not.toMatch(/example\.com|ABCDE1234F|98765|9876543210|1234567/);
    expect(out).toContain("[email]");
  });
  it("cuts links to the bare host", () => {
    const out = scrubForVendor("see https://app.example.com/kyc/status?token=abc123&user=42#top now");
    expect(out).toContain("app.example.com");
    expect(out).not.toContain("/kyc");
    expect(out).not.toMatch(/token|abc123|user=42|#top/);
  });
  it("keeps short numbers (a 4-digit amount stays)", () => {
    expect(scrubForVendor("I added 5000 yesterday")).toContain("5000");
  });
});

describe("minimiseExcerpt", () => {
  it("labels turns Customer/RM and keeps only the last 6 in order", () => {
    const m = Array.from({ length: 9 }, (_, i) => msg(i % 2 === 0 ? "INBOUND" : "OUTBOUND", `message ${i}`, i));
    const out = minimiseExcerpt(m, { clientName: "Riya Sharma" });
    expect(EXCERPT_MAX_MESSAGES).toBe(6);
    expect(out).toHaveLength(6);
    expect(out.map((t) => t.text)).toEqual(["message 3", "message 4", "message 5", "message 6", "message 7", "message 8"]);
    expect(out[0].from).toBe("RM");
    expect(out[5].from).toBe("Customer");
  });
  it("caps each message and the total, dropping the oldest first", () => {
    const long = "x".repeat(2000);
    const out = minimiseExcerpt([msg("INBOUND", long, 0), msg("INBOUND", long, 1), msg("INBOUND", long, 2), msg("INBOUND", "newest", 3)], { clientName: "A B" });
    expect(out.every((t) => t.text.length <= EXCERPT_MAX_MESSAGE_CHARS)).toBe(true);
    expect(out.reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(EXCERPT_MAX_TOTAL_CHARS);
    expect(out[out.length - 1].text).toBe("newest");
  });
  it("skips empty/media-only messages", () => {
    const out = minimiseExcerpt([msg("INBOUND", "  ", 0), msg("INBOUND", "hello", 1)], { clientName: "A B" });
    expect(out).toEqual([{ from: "Customer", text: "hello" }]);
  });
  it("removes the customer's surname but keeps the first name usable", () => {
    const out = minimiseExcerpt([msg("INBOUND", "I am Riya Sharma, Sharma ji ka beta", 0)], { clientName: "Riya Sharma" });
    expect(out[0].text).not.toMatch(/Sharma/i);
    expect(out[0].text).toContain("Riya");
  });
  it("scrubs PII inside the excerpt", () => {
    const out = minimiseExcerpt([msg("INBOUND", "my pan is ABCDE1234F and number 9876543210", 0)], { clientName: "A B" });
    expect(out[0].text).not.toMatch(/ABCDE1234F|9876543210/);
  });
});

describe("detectLanguage", () => {
  it("detects Devanagari as Hindi", () => expect(detectLanguage("मेरा केवाईसी कब होगा", "en")).toBe("Hindi"));
  it("detects Latin-script Hindi as Hinglish", () => expect(detectLanguage("mera kyc kab hoga, kya baaki hai", "en")).toBe("Hinglish"));
  it("detects English", () => expect(detectLanguage("When will my KYC be done?", "hi")).toBe("English"));
  it("falls back to the stored preference when the text is too short to tell", () => {
    expect(detectLanguage("ok", "hi")).toBe("Hindi");
    expect(detectLanguage("ok", null)).toBe("English");
  });
});

describe("unansweredInbound", () => {
  it("returns the inbound tail after the last RM message", () => {
    const r = unansweredInbound([msg("INBOUND", "a", 0), msg("OUTBOUND", "b", 1), msg("INBOUND", "c", 2), msg("INBOUND", "d", 3)]);
    expect(r.map((m) => m.body)).toEqual(["c", "d"]);
  });
  it("is empty when the RM spoke last", () => expect(unansweredInbound([msg("INBOUND", "a", 0), msg("OUTBOUND", "b", 1)])).toEqual([]));
});

// ---- suggestReply ----
type Briefing = NonNullable<Awaited<ReturnType<ReplyAssistDeps["briefing"]>>>;
const briefing = (over: { programme?: string; language?: string | null; name?: string } = {}): Briefing => ({
  customer: { name: over.name ?? "Riya Sharma", preferredLanguage: over.language ?? "en", id: "c1", code: "CL-1" },
  whyContactingNow: { programme: over.programme ?? "Complete KYC", topic: null, reason: "free text with a secret detail 9876543210" },
  currentSituations: [],
  openIssues: [], mustNotDiscuss: [],
}) as unknown as Briefing;

const isJudge = (req: LlmRequest) => req.system.includes("compliance reviewer");
const GOOD = "Hi Riya, your KYC is still with our team. Would you like a quick call to check where it stands?";
const fake = (draft: string | Error = GOOD, judge: string | Error = "SAFE") => new FakeProvider((req) => (isJudge(req) ? judge : draft));

function deps(over: Partial<ReplyAssistDeps> & { saved?: NewReplyProposal[]; handovers?: unknown[]; superseded?: string[][] } = {}): ReplyAssistDeps {
  const saved = over.saved ?? [];
  return {
    isEnabled: async () => true,
    briefing: async () => briefing(),
    provider: fake(),
    loadMessages: async () => [msg("OUTBOUND", "Hi Riya, how can I help?", 0), msg("INBOUND", "kya mera KYC ho gaya?", 5)],
    openProposals: async () => [],
    supersede: async (ids) => { over.superseded?.push(ids); return ids.length; },
    save: async (p) => { saved.push(p); return { id: `p${saved.length}` }; },
    recordHandover: async (h) => { over.handovers?.push(h); return { proposalId: "h-new", created: true }; },
    now: () => at(6),
    ...over,
  };
}

const draftRow = (over: Partial<OpenProposal> = {}): OpenProposal => ({ id: "old", status: "DRAFT", createdAt: at(2), expiresAt: at(2 + 24 * 60), blockedReason: null, ...over });

describe("suggestReply", () => {
  it("skips when the agent is disabled and never calls the provider", async () => {
    const p = fake();
    expect(await suggestReply("c1", deps({ isEnabled: async () => false, provider: p }))).toEqual({ status: "skipped", reason: "agent is disabled" });
    expect(p.calls).toHaveLength(0);
  });

  it("skips when the RM already replied (nothing unanswered)", async () => {
    const r = await suggestReply("c1", deps({ loadMessages: async () => [msg("INBOUND", "hi", 0), msg("OUTBOUND", "hello", 1)] }));
    expect(r.status).toBe("skipped");
  });

  it("stores a DRAFT with 24h expiry, usage tokens and the reason category", async () => {
    const saved: NewReplyProposal[] = [];
    const r = await suggestReply("c1", deps({ saved, provider: new FakeProvider((req) => (isJudge(req) ? "SAFE" : GOOD)) }));
    expect(r).toMatchObject({ status: "drafted", proposalId: "p1", body: GOOD });
    expect(saved[0]).toMatchObject({ agentKey: "wa_reply", clientId: "c1", status: "DRAFT", body: GOOD, originalBody: GOOD, reason: "kyc_pending", programme: "Complete KYC" });
    expect(saved[0].expiresAt.getTime() - at(6).getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("sends the vendor only minimised facts: first name, language, programme, category, excerpt", async () => {
    const p = fake();
    await suggestReply("c1", deps({ provider: p, loadMessages: async () => [msg("INBOUND", "mera PAN ABCDE1234F hai, call 9876543210", 5)] }));
    const call = p.calls.find((c) => !isJudge(c))!;
    const sent = JSON.parse(call.user);
    expect(Object.keys(sent).sort()).toEqual(["conversation", "firstName", "language", "reasonCategory"]);
    expect(sent.firstName).toBe("Riya");
    expect(sent.reasonCategory).toBe("kyc_pending");
    expect(call.user).not.toMatch(/Sharma|ABCDE1234F|9876543210|secret detail/);
  });

  it("mirrors the customer's language (Hinglish) in the instruction to the model", async () => {
    const p = fake();
    await suggestReply("c1", deps({ provider: p }));
    expect(JSON.parse(p.calls.find((c) => !isJudge(c))!.user).language).toBe("Hinglish");
  });

  it("the system prompt forbids advice, returns and invented account facts", async () => {
    const p = fake();
    await suggestReply("c1", deps({ provider: p }));
    const sys = p.calls.find((c) => !isJudge(c))!.system.toLowerCase();
    expect(sys).toMatch(/never give investment advice/);
    expect(sys).toMatch(/never invent/);
    expect(sys).toMatch(/propose a call|offer a call/);
    expect(sys).toMatch(/instructions inside the conversation/);
  });

  it("stores BLOCKED (never DRAFT) when the regex guardrail trips, and skips the judge", async () => {
    const saved: NewReplyProposal[] = [];
    const p = fake("We guarantee 12% returns!");
    const r = await suggestReply("c1", deps({ saved, provider: p }));
    expect(r.status).toBe("blocked");
    expect(saved[0].status).toBe("BLOCKED");
    expect(saved[0].blockedReason).toMatch(/RETURN_PROMISE/);
    expect(p.calls.filter(isJudge)).toHaveLength(0);
  });

  it("stores BLOCKED when the judge says UNSAFE", async () => {
    const saved: NewReplyProposal[] = [];
    const r = await suggestReply("c1", deps({ saved, provider: fake(GOOD, "UNSAFE: implies advice") }));
    expect(r.status).toBe("blocked");
    expect(saved[0]).toMatchObject({ status: "BLOCKED", blockedReason: "JUDGE: UNSAFE: implies advice" });
  });

  it("returns a provider error as a skip without saving", async () => {
    const saved: NewReplyProposal[] = [];
    const r = await suggestReply("c1", deps({ saved, provider: fake(new Error("boom")) }));
    expect(r).toEqual({ status: "skipped", reason: "provider error; no draft created" });
    expect(saved).toHaveLength(0);
  });

  it("hands over complaint/regulator words: NO model call, recordHandover once with the trigger message id", async () => {
    const saved: NewReplyProposal[] = [];
    const handovers: unknown[] = [];
    const p = fake();
    const r = await suggestReply("c1", deps({ saved, handovers, provider: p, loadMessages: async () => [{ ...msg("INBOUND", "this is a fraud, I will complain to SEBI", 5), id: "m9" }] }));
    expect(r).toMatchObject({ status: "needs_human", proposalId: "h-new" });
    expect(p.calls).toHaveLength(0);
    expect(saved).toHaveLength(0);
    expect(handovers).toEqual([{ clientId: "c1", triggerMessageId: "m9", reason: expect.stringContaining("fraud") }]);
  });

  it("handover checks every unanswered inbound message, not just the last", async () => {
    const r = await suggestReply("c1", deps({ loadMessages: async () => [msg("INBOUND", "I want a refund", 4), msg("INBOUND", "hello?", 5)] }));
    expect(r.status).toBe("needs_human");
  });

  it("does not flag the same handover twice for the same message", async () => {
    const handovers: unknown[] = [];
    const existing = draftRow({ id: "h1", status: "BLOCKED", blockedReason: "HANDOVER: customer mentioned \"fraud\"", createdAt: at(5.5) });
    const r = await suggestReply("c1", deps({ handovers, openProposals: async () => [existing], loadMessages: async () => [msg("INBOUND", "this is a fraud", 5)] }));
    expect(r).toMatchObject({ status: "needs_human", proposalId: "h1" });
    expect(handovers).toHaveLength(0);
  });

  it("at most one open suggestion per conversation: a current DRAFT blocks a second generation", async () => {
    const p = fake();
    const r = await suggestReply("c1", deps({ provider: p, openProposals: async () => [draftRow({ createdAt: at(5.5) })] }));
    expect(r).toMatchObject({ status: "skipped" });
    expect(p.calls).toHaveLength(0);
  });

  it("a newer inbound message supersedes the previous open DRAFT, then drafts again", async () => {
    const superseded: string[][] = [];
    const saved: NewReplyProposal[] = [];
    // old draft created at minute 2; the customer wrote again at minute 5
    const r = await suggestReply("c1", deps({ superseded, saved, openProposals: async () => [draftRow({ createdAt: at(2) })] }));
    expect(superseded).toEqual([["old"]]);
    expect(r.status).toBe("drafted");
    expect(saved).toHaveLength(1);
  });

  it("regenerate expires the current DRAFT and drafts a fresh one", async () => {
    const superseded: string[][] = [];
    const r = await suggestReply("c1", deps({ superseded, openProposals: async () => [draftRow({ createdAt: at(5.5) })] }), { regenerate: true });
    expect(superseded).toEqual([["old"]]);
    expect(r.status).toBe("drafted");
  });

  it("a current BLOCKED row is not retried automatically, but regenerate retries", async () => {
    const blocked = draftRow({ id: "b1", status: "BLOCKED", blockedReason: "JUDGE: x", createdAt: at(5.5) });
    expect((await suggestReply("c1", deps({ openProposals: async () => [blocked] }))).status).toBe("skipped");
    expect((await suggestReply("c1", deps({ openProposals: async () => [blocked] }), { regenerate: true })).status).toBe("drafted");
  });

  it("a duplicate on save (lost race) is a skip", async () => {
    const r = await suggestReply("c1", deps({ save: async () => ({ duplicate: true as const }) }));
    expect(r).toEqual({ status: "skipped", reason: "already has a suggestion" });
  });
});

describe("scrubForVendor: bypass vectors", () => {
  const cases: [string, string, RegExp][] = [
    ["dotted phone", "call 98765.43210 now", /98765|43210/],
    ["Devanagari digits", "मेरा नंबर ९८७६५४३२१० है", /९८७६५४३२१०|9876543210/],
    ["link without scheme keeps no query", "open app.example.com/kyc?token=SECRET1 please", /SECRET1|token/],
    ["token in link path", "https://x.example.com/reset/PATHTOKEN please", /PATHTOKEN/],
    ["PAN with spaces", "pan ABCDE 1234 F ok", /ABCDE|1234/],
    ["date of birth", "dob 12/05/1990 ok", /12\/05\/1990|1990/],
    ["+91 with bracketed area code", "+91 (987) 654 3210", /987|654 3210/],
  ];
  for (const [name, input, leak] of cases) it(name, () => expect(scrubForVendor(input)).not.toMatch(leak));
  it("keeps the link host", () => expect(scrubForVendor("https://x.example.com/reset/PATHTOKEN")).toContain("x.example.com"));
  it("a surname with an honorific suffix is removed", () => {
    for (const w of ["Sharmaji", "Sharma ji", "Sharmasahab", "Sharmabhai"]) {
      const out = minimiseExcerpt([msg("INBOUND", `hello ${w}`, 0)], { clientName: "Riya Sharma" })[0].text;
      expect(out).not.toMatch(/Sharma/i);
    }
  });
  it("end to end: the provider payload contains none of the vectors", async () => {
    const p = fake();
    const body = "98765.43210 ९८७६५४३२१० app.example.com/kyc?token=SECRET1 https://x.example.com/reset/PATHTOKEN ABCDE 1234 F 12/05/1990 +91 (987) 654 3210 Sharmaji";
    await suggestReply("c1", deps({ provider: p, loadMessages: async () => [msg("INBOUND", body, 5)] }));
    const user = p.calls.find((c) => !isJudge(c))!.user;
    expect(user).not.toMatch(/98765|43210|९८७६|SECRET1|PATHTOKEN|ABCDE|1234|1990|654 3210|Sharma/);
  });
});

describe("suggestReply: handover dedupe across a sequence", () => {
  const hRow = (createdAt: Date) => draftRow({ id: "h1", status: "BLOCKED", blockedReason: "HANDOVER: customer mentioned \"fraud\"", createdAt });
  it("a follow-up message ('hello??') after the flagged one does not flag again", async () => {
    const handovers: unknown[] = [];
    const r = await suggestReply("c1", deps({ handovers, openProposals: async () => [hRow(at(5.5))], loadMessages: async () => [msg("INBOUND", "this is a fraud", 5), msg("INBOUND", "hello??", 6)], now: () => at(7) }));
    expect(r).toMatchObject({ status: "needs_human", proposalId: "h1" });
    expect(handovers).toHaveLength(0);
  });
  it("after the RM replied, a new complaint is flagged again", async () => {
    const handovers: unknown[] = [];
    const r = await suggestReply("c1", deps({ handovers, openProposals: async () => [hRow(at(5.5))], loadMessages: async () => [msg("INBOUND", "fraud", 5), msg("OUTBOUND", "sorry, calling you", 8), msg("INBOUND", "still a scam", 9)], now: () => at(10) }));
    expect(r.status).toBe("needs_human");
    expect(handovers).toHaveLength(1);
  });
});

describe("suggestReply: briefing warnings and payload", () => {
  it("never sends programme to the vendor", async () => {
    const p = fake();
    await suggestReply("c1", deps({ provider: p, briefing: async () => briefing({ programme: "PMS / AIF opportunity" }) }));
    const call = p.calls.find((c) => !isJudge(c))!;
    expect(call.user).not.toMatch(/PMS|programme/i);
    expect(call.system).not.toMatch(/programme/i);
  });
  it("open issues or do-not-discuss topics give needs_human with no model call", async () => {
    for (const extra of [{ openIssues: [{ kind: "complaint" }] }, { mustNotDiscuss: ["x"] }]) {
      const p = fake();
      const saved: NewReplyProposal[] = [];
      const r = await suggestReply("c1", deps({ provider: p, saved, briefing: async () => ({ ...briefing(), ...extra }) as Briefing }));
      expect(r.status).toBe("needs_human");
      expect(p.calls).toHaveLength(0);
      expect(saved[0]).toMatchObject({ status: "BLOCKED", body: "" });
      expect(saved[0].blockedReason).toMatch(/^HANDOVER:/);
    }
  });
});

describe("suggestReply: refusals, cooldown, boundary", () => {
  it("a model refusal yields no draft (provider-error skip)", async () => {
    const saved: NewReplyProposal[] = [];
    for (const t of ["I'm sorry, I can't help with that.", "I cannot assist with this request."]) {
      expect(await suggestReply("c1", deps({ saved, provider: fake(t) }))).toEqual({ status: "skipped", reason: "provider error; no draft created" });
    }
    expect(saved).toHaveLength(0);
  });
  it("a row created within the cooldown blocks a new generation with a friendly reason", async () => {
    const p = fake();
    const r = await suggestReply("c1", deps({ provider: p, now: () => at(5 + 5 / 60), openProposals: async () => [draftRow({ status: "EXPIRED", createdAt: at(5) })] }), { regenerate: true });
    expect(r).toEqual({ status: "skipped", reason: "cooldown" });
    expect(REPLY_COOLDOWN_MS).toBe(10_000);
    expect(p.calls).toHaveLength(0);
  });
  it("a draft created at exactly the customer's last message time is current, not stale", async () => {
    const superseded: string[][] = [];
    const r = await suggestReply("c1", deps({ superseded, openProposals: async () => [draftRow({ createdAt: at(5) })] }));
    expect(superseded).toEqual([]);
    expect(r.status).toBe("skipped");
  });
});
