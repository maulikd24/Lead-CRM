import { describe, expect, it } from "vitest";
import { draftNudge, scrub, safeFirstName, type NudgerDeps, type NewProposal } from "./nudger";
import { FakeProvider, type LlmRequest } from "@/lib/ai/provider";

type Briefing = NonNullable<Awaited<ReturnType<NudgerDeps["briefing"]>>>;

function briefing(over: Partial<{ programme: string; openIssues: unknown[]; language: string | null; name: string; reason: string; points: string[]; mustNot: string[] }> = {}): Briefing {
  return {
    customer: { name: over.name ?? "Riya Sharma", preferredLanguage: over.language ?? "en", id: "c1", code: "CL-1", category: null, lifecycleStage: "KYC", region: null, relationshipManager: "Asha" },
    whyContactingNow: { programme: over.programme ?? "Complete KYC", action: "WhatsApp", topic: null, reason: over.reason ?? "KYC pending for 5 days", priority: "High", timing: "Today", owner: "AI Bot" },
    currentSituations: [],
    suggestedTalkingPoints: over.points ?? ["Offer help with documents"],
    openIssues: over.openIssues ?? [],
    mustNotDiscuss: over.mustNot ?? [],
  } as unknown as Briefing;
}

const isJudge = (req: LlmRequest) => req.system.includes("compliance reviewer");
const GOOD = "Hi Riya, your KYC is almost done. Can I help you finish the last step?";
const fake = (draft: string | Error = GOOD, judge: string | Error = "SAFE") =>
  new FakeProvider((req) => (isJudge(req) ? judge : draft));
const judgeCalls = (p: FakeProvider) => p.calls.filter(isJudge).length;

function deps(over: Partial<NudgerDeps> & { saved?: NewProposal[] } = {}): NudgerDeps {
  const saved = over.saved ?? [];
  return {
    briefing: async () => briefing(),
    provider: fake(),
    isEnabled: async () => true,
    recentProposals: async () => [],
    save: async (p) => { saved.push(p); return { id: `p${saved.length}` }; },
    now: () => new Date("2026-10-09T10:00:00Z"),
    ...over,
  };
}

describe("draftNudge", () => {
  it("drafts a message for a KYC nudge", async () => {
    const saved: NewProposal[] = [];
    const res = await draftNudge("c1", deps({ saved }));
    expect(res).toMatchObject({ status: "drafted" });
    expect(saved[0]).toMatchObject({ status: "DRAFT", programme: "Complete KYC", agentKey: "wa_nudger" });
    expect(saved[0].expiresAt.getTime()).toBe(new Date("2026-10-11T10:00:00Z").getTime());
  });

  it("time-boxes the vendor draft call with a 20 s timeout", async () => {
    const provider = fake();
    await draftNudge("c1", deps({ provider }));
    expect(provider.calls.find((c) => !isJudge(c))?.timeoutMs).toBe(20_000);
  });

  it("skips (and reports it) when save finds an existing draft: no duplicate", async () => {
    const res = await draftNudge("c1", deps({ save: async () => ({ duplicate: true }) }));
    expect(res).toEqual({ status: "skipped", reason: "already has a draft" });
    const blockedRes = await draftNudge("c1", deps({ provider: fake("Guaranteed returns"), save: async () => ({ duplicate: true }) }));
    expect(blockedRes).toEqual({ status: "skipped", reason: "already has a draft" });
  });

  it("skips when the agent is switched off", async () => {
    const res = await draftNudge("c1", deps({ isEnabled: async () => false }));
    expect(res).toMatchObject({ status: "skipped", reason: expect.stringMatching(/disabled/i) });
  });

  it("skips programmes it does not handle", async () => {
    const res = await draftNudge("c1", deps({ briefing: async () => briefing({ programme: "PMS / AIF opportunity" }) }));
    expect(res.status).toBe("skipped");
  });

  it("never nudges a customer with an open complaint", async () => {
    const res = await draftNudge("c1", deps({ briefing: async () => briefing({ openIssues: [{ kind: "complaint" }] }) }));
    expect(res).toMatchObject({ status: "skipped", reason: expect.stringMatching(/open issue/i) });
  });

  it("skips with 'cooling down' when the customer has a blocking recent proposal", async () => {
    const now = new Date("2026-10-09T10:00:00Z");
    const recent = [{ status: "SENT" as const, createdAt: new Date(now.getTime() - 3600_000), decidedAt: new Date(now.getTime() - 3600_000), expiresAt: new Date(now.getTime() + 3600_000) }];
    const saved: NewProposal[] = [];
    const res = await draftNudge("c1", deps({ saved, recentProposals: async () => recent }));
    expect(res).toEqual({ status: "skipped", reason: "cooling down" });
    expect(saved).toHaveLength(0);
  });

  it("asks only for the lookback window of proposals and drafts when none block", async () => {
    let since: Date | undefined;
    const res = await draftNudge("c1", deps({ recentProposals: async (_id, s) => { since = s; return []; } }));
    expect(res.status).toBe("drafted");
    expect(since?.toISOString()).toBe("2026-09-25T10:00:00.000Z");
  });

  it("does not call the model when cooling down", async () => {
    const provider = fake();
    await draftNudge("c1", deps({ provider, recentProposals: async () => [{ status: "APPROVED", createdAt: new Date(), decidedAt: new Date(), expiresAt: new Date() }] }));
    expect(provider.calls).toHaveLength(0);
  });

  it("saves a BLOCKED proposal when the regex layer catches the draft, and never calls the judge", async () => {
    const saved: NewProposal[] = [];
    const provider = fake("Invest now for guaranteed returns");
    const res = await draftNudge("c1", deps({ saved, provider }));
    expect(res.status).toBe("blocked");
    expect(saved[0].status).toBe("BLOCKED");
    expect(judgeCalls(provider)).toBe(0);
  });

  it("blocks an empty draft with code EMPTY and never calls the judge", async () => {
    const saved: NewProposal[] = [];
    const provider = fake("");
    const res = await draftNudge("c1", deps({ saved, provider }));
    expect(res.status).toBe("blocked");
    expect(saved[0].status).toBe("BLOCKED");
    expect(saved[0].blockedReason).toMatch(/^EMPTY/);
    expect(judgeCalls(provider)).toBe(0);
  });

  it("blocks when the judge says UNSAFE", async () => {
    const saved: NewProposal[] = [];
    const res = await draftNudge("c1", deps({ saved, provider: fake(GOOD, "UNSAFE: implies returns") }));
    expect(res.status).toBe("blocked");
    expect(saved[0]).toMatchObject({ status: "BLOCKED" });
    expect(saved[0].blockedReason).toMatch(/^JUDGE: .*implies returns/);
  });

  it("fails closed when the judge call throws or returns nothing", async () => {
    for (const judge of [new Error("timeout"), ""]) {
      const saved: NewProposal[] = [];
      const res = await draftNudge("c1", deps({ saved, provider: fake(GOOD, judge) }));
      expect(res.status).toBe("blocked");
      expect(saved[0].status).toBe("BLOCKED");
      expect(saved[0].blockedReason).toMatch(/^JUDGE:/);
    }
  });

  it("does nothing and does not throw when the draft call fails", async () => {
    const saved: NewProposal[] = [];
    const res = await draftNudge("c1", deps({ saved, provider: fake(new Error("503")) }));
    expect(res).toMatchObject({ status: "skipped", reason: expect.stringMatching(/provider/i) });
    expect(saved).toHaveLength(0);
  });

  it("sends the model nothing personal beyond the first name, in any call (draft or judge)", async () => {
    const provider = fake("Hi Riya, your KYC is almost done.");
    await draftNudge("c1", deps({
      provider,
      briefing: async () => briefing({
        reason: "KYC pending; call 9876543210 or riya.sharma@example.com, PAN ABCDE1234F",
        points: ["Ref account 123456789 is ready", "Mention Sharma family office", "Offer help with documents"],
      }),
    }));
    expect(provider.calls.length).toBe(2);
    const sent = provider.calls.map((c) => c.system + c.user).join("\n");
    for (const leak of ["9876543210", "example.com", "@", "ABCDE1234F", "123456789"]) expect(sent).not.toContain(leak);
    expect(sent).toContain("Riya");
  });

  it("uses 'there' when the profile name is a phone number or a fallback lead label", async () => {
    for (const name of ["919876543210", "WhatsApp Lead — 919876543210", "+91 98765 43210", ""]) {
      const provider = fake();
      await draftNudge("c1", deps({ provider, briefing: async () => briefing({ name }) }));
      const user = JSON.parse(provider.calls[0].user);
      expect(user.firstName).toBe("there");
      expect(provider.calls.map((c) => c.system + c.user).join("")).not.toMatch(/9876|98765/);
    }
  });

  it("maps preferredLanguage hi to Hindi", async () => {
    const provider = fake();
    await draftNudge("c1", deps({ provider, briefing: async () => briefing({ language: "hi" }) }));
    expect(JSON.parse(provider.calls[0].user).language).toBe("Hindi");
  });

  it("skips when mustNotDiscuss is non-empty", async () => {
    const res = await draftNudge("c1", deps({ briefing: async () => briefing({ mustNot: ["pricing dispute"] }) }));
    expect(res).toMatchObject({ status: "skipped", reason: expect.stringMatching(/open issue/i) });
  });

  it("sends the vendor only firstName, language, programme and a reason category, never free text", async () => {
    const provider = fake();
    await draftNudge("c1", deps({
      provider,
      briefing: async () => briefing({ reason: "UNIQUE-REASON-TEXT dob 01-01-1990", points: ["UNIQUE-TALKING-POINT"] }),
    }));
    const user = JSON.parse(provider.calls[0].user);
    expect(Object.keys(user).sort()).toEqual(["firstName", "language", "programme", "reasonCategory"]);
    expect(user.reasonCategory).toBe("kyc_pending");
    const sent = provider.calls.map((c) => c.system + c.user).join("\n");
    for (const leak of ["UNIQUE-REASON-TEXT", "UNIQUE-TALKING-POINT", "01-01-1990", "Offer help with documents", "KYC pending for 5 days"]) expect(sent).not.toContain(leak);
  });

  it("still stores the human-readable reason on the proposal for the RM", async () => {
    const saved: NewProposal[] = [];
    await draftNudge("c1", deps({ saved, briefing: async () => briefing({ reason: "KYC pending for 5 days" }) }));
    expect(saved[0].reason).toBe("KYC pending for 5 days");
  });

  it("maps the programme to the category sent to the model", async () => {
    const provider = fake();
    await draftNudge("c1", deps({ provider, briefing: async () => briefing({ programme: "Fund account" }) }));
    expect(JSON.parse(provider.calls[0].user).reasonCategory).toBe("signed_up_not_funded");
  });
});

describe("scrub", () => {
  it("removes emails, PAN, phone numbers and any 6+ digit run", () => {
    expect(scrub("mail a.b@x.io now")).not.toContain("@");
    expect(scrub("PAN abcde1234f ok")).not.toMatch(/abcde1234f/i);
    expect(scrub("call +91 98765 43210")).not.toMatch(/\d{5}/);
    expect(scrub("acct 123456 and 1234567890123")).not.toMatch(/\d{6}/);
    expect(scrub("pending for 5 days, 48 hours")).toBe("pending for 5 days, 48 hours");
  });
});

describe("safeFirstName", () => {
  it("accepts plain names and rejects labels, numbers and empties", () => {
    expect(safeFirstName("Riya Sharma")).toBe("Riya");
    expect(safeFirstName("  Anne-Marie  Lee")).toBe("Anne-Marie");
    expect(safeFirstName("राहुल कुमार")).toBe("राहुल");
    for (const bad of ["", "   ", "9876543210", "WhatsApp Lead — 91987", "whatsapp", "R2D2", "a@b.com"]) expect(safeFirstName(bad)).toBe("there");
  });
});
