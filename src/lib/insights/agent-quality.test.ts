import { describe, expect, it } from "vitest";
import { agentQuality, classifyBlock, editBucket, editDistance, median, type ProposalRow } from "./agent-quality";

const NOW = new Date("2026-10-09T12:00:00Z");
const min = (m: number) => new Date(NOW.getTime() - 3 * 86_400_000 + m * 60_000);

function row(over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    agentKey: "wa_nudger", status: "DRAFT", blockedReason: null, model: "claude-sonnet-5-5", inputTokens: 1000, outputTokens: 100,
    body: "Hi, please complete your KYC.", originalBody: "Hi, please complete your KYC.", programme: "Complete KYC",
    createdAt: min(0), decidedAt: null, decidedById: null, expiresAt: new Date(NOW.getTime() + 86_400_000), messageId: null, ...over,
  };
}

describe("editDistance / editBucket", () => {
  it("computes Levenshtein distance", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("same", "same")).toBe(0);
  });
  it("buckets by share of the longer text", () => {
    expect(editBucket("hello world", "hello world")).toBe("none");
    expect(editBucket("x".repeat(100), "x".repeat(95) + "yyyyy")).toBe("light"); // 5%
    expect(editBucket("x".repeat(100), "x".repeat(80) + "y".repeat(20))).toBe("moderate"); // 20%
    expect(editBucket("x".repeat(100), "y".repeat(100))).toBe("heavy");
  });
  it("treats whitespace-only differences as no edit", () => {
    expect(editBucket("a b", "a b  ")).toBe("none");
  });
  it("does not blow up on very long text", () => {
    expect(editBucket("a".repeat(5000), "b".repeat(5000))).toBe("heavy");
  });
});

describe("classifyBlock", () => {
  it("separates regex, judge and human re-check", () => {
    expect(classifyBlock("RETURN_PROMISE: promises or guarantees returns", null)).toEqual({ layer: "regex", reason: "RETURN_PROMISE" });
    expect(classifyBlock("JUDGE: mentions returns", null)).toEqual({ layer: "judge", reason: "JUDGE" });
    expect(classifyBlock("ADVICE: gives investment advice", "user1")).toEqual({ layer: "approval_recheck", reason: "ADVICE" });
  });
  it("handles odd values", () => {
    expect(classifyBlock(null, null)).toEqual({ layer: "regex", reason: "UNKNOWN" });
    expect(classifyBlock("weird", null).reason).toBe("UNKNOWN");
  });
});

describe("median", () => {
  it("handles empty, odd, even", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("agentQuality", () => {
  it("returns nothing for no rows", () => {
    expect(agentQuality([], NOW)).toEqual([]);
  });

  it("computes funnel counts and rates per agent", () => {
    const rows: ProposalRow[] = [
      row({ status: "BLOCKED", blockedReason: "ADVICE: gives investment advice" }),
      row({ status: "BLOCKED", blockedReason: "JUDGE: sounds pushy" }),
      row({ status: "SENT", messageId: "m1", decidedAt: min(10), decidedById: "u1" }),
      row({ status: "SENT", messageId: "m2", decidedAt: min(30), decidedById: "u1", body: "Totally different message text here", originalBody: "Hi, please complete your KYC." }),
      row({ status: "REJECTED", decidedAt: min(5), decidedById: "u1" }),
      row({ status: "EXPIRED" }),
      row({ status: "DRAFT", expiresAt: new Date(NOW.getTime() - 1000) }), // overdue draft counts as expired
      row({ status: "DRAFT" }), // genuinely pending
    ];
    const [q] = agentQuality(rows, NOW);
    expect(q.agentKey).toBe("wa_nudger");
    expect(q.generated).toBe(8);
    expect(q.blocked).toMatchObject({ total: 2, regex: 1, judge: 1, rate: 2 / 8 });
    expect(q.blocked.byReason).toEqual({ ADVICE: 1, JUDGE: 1 });
    expect(q.offered).toBe(6);
    expect(q.approved).toBe(2);
    expect(q.rejected).toBe(1);
    expect(q.expired).toBe(2);
    expect(q.pending).toBe(1);
    expect(q.sent).toBe(2);
    expect(q.approvalRate).toBeCloseTo(2 / 6);
    expect(q.rejectionRate).toBeCloseTo(1 / 6);
    expect(q.expiryRate).toBeCloseTo(2 / 6);
    expect(q.edited).toBe(1);
    expect(q.editRate).toBeCloseTo(0.5);
    expect(q.editBuckets).toMatchObject({ none: 1, heavy: 1 });
    expect(q.medianApproveMinutes).toBe(20);
  });

  it("a draft blocked when the human edited it counts as offered, not generation-blocked", () => {
    const [q] = agentQuality([row({ status: "BLOCKED", blockedReason: "ADVICE: x", decidedById: "u1", decidedAt: min(3) })], NOW);
    expect(q.blocked.total).toBe(0);
    expect(q.blockedAfterEdit).toBe(1);
    expect(q.offered).toBe(1);
  });

  it("returns null rates on zero denominators", () => {
    const [q] = agentQuality([row({ status: "BLOCKED", blockedReason: "JUDGE: x" })], NOW);
    expect(q.offered).toBe(0);
    expect(q.approvalRate).toBeNull();
    expect(q.editRate).toBeNull();
    expect(q.medianApproveMinutes).toBeNull();
    expect(q.cost.perApprovedUsd).toBeNull();
  });

  it("keeps agents separate and ordered by volume", () => {
    const out = agentQuality([row({ agentKey: "other" }), row(), row()], NOW);
    expect(out.map((o) => o.agentKey)).toEqual(["wa_nudger", "other"]);
  });

  it("estimates cost per approved message including spend on blocked drafts", () => {
    const [q] = agentQuality(
      [row({ status: "SENT", messageId: "m", decidedAt: min(1), decidedById: "u" }), row({ status: "BLOCKED", blockedReason: "JUDGE: x" })],
      NOW,
    );
    expect(q.tokens).toEqual({ input: 2000, output: 200 });
    expect(q.cost.usd).toBeGreaterThan(0);
    expect(q.cost.perApprovedUsd).toBeCloseTo(q.cost.usd!, 10); // one approved, whole spend attributed to it
  });

  it("unknown model gives n/a cost", () => {
    const [q] = agentQuality([row({ model: "mystery", status: "SENT", messageId: "m", decidedAt: min(1), decidedById: "u" })], NOW);
    expect(q.cost.usd).toBeNull();
    expect(q.cost.perApprovedUsd).toBeNull();
  });

  it("breaks edit rate down by programme", () => {
    const sent = (programme: string, edited: boolean) =>
      row({ status: "SENT", messageId: "m", programme, decidedAt: min(1), decidedById: "u", body: edited ? "zzzzzzzzzzzzzzzzzzzzzzzzzzzz" : "Hi, please complete your KYC." });
    const [q] = agentQuality([sent("Complete KYC", true), sent("Complete KYC", true), sent("Fund account", false)], NOW);
    const kyc = q.byProgramme.find((p) => p.programme === "Complete KYC")!;
    expect(kyc).toMatchObject({ approved: 2, edited: 2, editRate: 1 });
    expect(q.byProgramme.find((p) => p.programme === "Fund account")!.editRate).toBe(0);
  });
});
