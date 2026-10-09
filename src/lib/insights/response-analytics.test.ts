import { describe, expect, it } from "vitest";
import {
  attachDraftContext, channelGroup, classifyObjection, conversionWithin, objectionLeaderboard, outcomeMix, responseTimes, stageFunnel,
  type OutcomeRow,
} from "./response-analytics";

const H = 3_600_000;
const D = 24 * H;
const NOW = new Date("2026-10-09T12:00:00Z");
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * D);

function o(over: Partial<OutcomeRow> = {}): OutcomeRow {
  return { clientId: "c1", outcome: "INTERESTED", channel: "WHATSAPP", actorType: "RM", rmId: "u1", rmName: "RM One", assetClass: "Mutual Funds", programme: "Complete KYC", language: "English", createdAt: at(1), aiDraftSent: false, ...over };
}

describe("outcomeMix", () => {
  it("returns an empty list for no rows", () => {
    expect(outcomeMix([], (r) => r.assetClass)).toEqual([]);
  });
  it("counts every outcome type and computes rates", () => {
    const rows = [o({ outcome: "INTERESTED" }), o({ outcome: "CONVERTED" }), o({ outcome: "NOT_INTERESTED" }), o({ outcome: "FOLLOW_UP" })];
    const [g] = outcomeMix(rows, (r) => r.assetClass);
    expect(g.total).toBe(4);
    expect(g.counts).toMatchObject({ INTERESTED: 1, CONVERTED: 1, NOT_INTERESTED: 1, FOLLOW_UP: 1, NOT_RELEVANT: 0, RM_HANDOVER: 0, SERVICE_ISSUE: 0 });
    expect(g.positiveRate).toBe(0.5);
    expect(g.declineRate).toBe(0.25);
  });
  it("labels missing keys Unspecified and orders ties alphabetically after volume", () => {
    const rows = [o({ assetClass: "PMS" }), o({ assetClass: "AIF" }), o({ assetClass: null }), o({ assetClass: null }), o({ assetClass: "AIF" })];
    const keys = outcomeMix(rows, (r) => r.assetClass).map((g) => g.key);
    expect(keys).toEqual(["AIF", "Unspecified", "PMS"]); // AIF=2, Unspecified=2 (tie -> alpha), PMS=1
  });
  it("never shows a customer name or id in the group", () => {
    const [g] = outcomeMix([o()], (r) => r.assetClass);
    expect(JSON.stringify(g)).not.toContain("c1");
  });
});

describe("channelGroup + attachDraftContext", () => {
  it("groups AI agent, RM after AI draft, WhatsApp RM and other channels", () => {
    expect(channelGroup(o({ actorType: "AI_AGENT" }))).toBe("AI agent");
    expect(channelGroup(o({ aiDraftSent: true }))).toBe("RM after AI draft");
    expect(channelGroup(o())).toBe("WhatsApp (RM)");
    expect(channelGroup(o({ channel: "CALL" }))).toBe("Call");
    expect(channelGroup(o({ channel: "MEETING" }))).toBe("Meeting");
    expect(channelGroup(o({ channel: "EMAIL" }))).toBe("Email");
    expect(channelGroup(o({ channel: "OTHER" }))).toBe("Other");
  });
  it("marks outcomes that follow a sent draft within the window only", () => {
    const outcomes = [
      { ...o({ createdAt: at(1) }) }, // draft sent 2 days ago -> yes
      { ...o({ createdAt: at(1), clientId: "c2" }) }, // no draft for c2
      { ...o({ createdAt: at(10) }) }, // draft sent 12 days earlier -> no (and before the draft is also no)
      { ...o({ createdAt: at(3.5) }) }, // before the draft was sent -> no
    ];
    const marked = attachDraftContext(outcomes, [{ clientId: "c1", sentAt: at(3) }], 7);
    expect(marked.map((m) => m.aiDraftSent)).toEqual([true, false, false, false]);
  });
  it("boundary: exactly at the window edge counts", () => {
    const marked = attachDraftContext([o({ createdAt: new Date(at(3).getTime() + 7 * D) })], [{ clientId: "c1", sentAt: at(3) }], 7);
    expect(marked[0].aiDraftSent).toBe(true);
  });
});

describe("responseTimes", () => {
  const out = (id: string, clientId: string, sentAt: Date, group = "RM") => ({ id, clientId, sentAt, group, language: "English" });
  it("finds the first inbound after each outbound within the window", () => {
    const r = responseTimes(
      [out("a", "c1", at(5)), out("b", "c2", at(5)), out("c", "c3", at(5))],
      [{ clientId: "c1", at: new Date(at(5).getTime() + 2 * H) }, { clientId: "c1", at: new Date(at(5).getTime() + 9 * H) }, { clientId: "c2", at: new Date(at(5).getTime() - H) }],
      { windowHours: 72, now: NOW },
    );
    const g = r.byGroup.find((x) => x.key === "RM")!;
    expect(g.sent).toBe(3);
    expect(g.replied).toBe(1); // c2's inbound was BEFORE the outbound; c3 none
    expect(g.replyRate).toBeCloseTo(1 / 3);
    expect(g.medianHours).toBe(2);
  });
  it("ignores replies beyond the window and excludes immature sends from the denominator", () => {
    const r = responseTimes(
      [out("old", "c1", at(10)), out("fresh", "c2", new Date(NOW.getTime() - 5 * H))],
      [{ clientId: "c1", at: new Date(at(10).getTime() + 80 * H) }],
      { windowHours: 72, now: NOW },
    );
    const g = r.byGroup[0];
    expect(g.sent).toBe(1); // 'fresh' has not had its 72h yet
    expect(g.replied).toBe(0);
    expect(r.immature).toBe(1);
  });
  it("replyRate and median are null with no data", () => {
    const r = responseTimes([], [], { windowHours: 72, now: NOW });
    expect(r.byGroup).toEqual([]);
    expect(r.buckets.every((b) => b.count === 0)).toBe(true);
  });
  it("buckets reply delays and groups by language too", () => {
    const r = responseTimes(
      [out("a", "c1", at(5)), { ...out("b", "c2", at(5)), language: "Hindi" }],
      [{ clientId: "c1", at: new Date(at(5).getTime() + 0.5 * H) }, { clientId: "c2", at: new Date(at(5).getTime() + 30 * H) }],
      { windowHours: 72, now: NOW },
    );
    expect(r.buckets.find((b) => b.label === "Under 1 hour")!.count).toBe(1);
    expect(r.buckets.find((b) => b.label === "1 to 3 days")!.count).toBe(1);
    expect(r.byLanguage.map((l) => l.key).sort()).toEqual(["English", "Hindi"]);
  });
});

describe("conversionWithin", () => {
  const ev = (clientId: string, daysAgo: number, group = "A") => ({ clientId, at: at(daysAgo), group });
  it("counts KYC and funding within N days of the event", () => {
    const miles = new Map([
      ["c1", { kycAt: new Date(at(20).getTime() + 3 * D), fundedAt: new Date(at(20).getTime() + 12 * D) }],
      ["c2", { kycAt: new Date(at(20).getTime() + 8 * D), fundedAt: null }],
    ]);
    const r = conversionWithin([ev("c1", 20), ev("c2", 20), ev("c3", 20)], miles, 7, NOW);
    const g = r.groups[0];
    expect(g).toMatchObject({ n: 3, kyc: 1, funded: 0 });
    expect(g.kycRate).toBeCloseTo(1 / 3);
    expect(g.fundedRate).toBe(0);
  });
  it("boundary: milestone exactly N days later counts; before the event does not", () => {
    const miles = new Map([
      ["c1", { kycAt: new Date(at(20).getTime() + 7 * D), fundedAt: null }],
      ["c2", { kycAt: new Date(at(20).getTime() - H), fundedAt: null }],
    ]);
    const g = conversionWithin([ev("c1", 20), ev("c2", 20)], miles, 7, NOW).groups[0];
    expect(g.kyc).toBe(1);
  });
  it("leaves out events too recent to have had N days", () => {
    const r = conversionWithin([ev("c1", 2), ev("c2", 20)], new Map(), 7, NOW);
    expect(r.immature).toBe(1);
    expect(r.groups[0].n).toBe(1);
  });
  it("null rates on zero denominators", () => {
    const r = conversionWithin([], new Map(), 7, NOW);
    expect(r.groups).toEqual([]);
  });
});

describe("objections", () => {
  it("classifies free text into themes without keeping the text", () => {
    expect(classifyObjection("Worried about the 3 year lock-in period")).toBe("Lock-in / liquidity");
    expect(classifyObjection("fees are too high")).toBe("Fees and costs");
    expect(classifyObjection("minimum ticket size of 50 lakh is too large")).toBe("Ticket size");
    expect(classifyObjection("not sure about market risk and volatility")).toBe("Risk / volatility");
    expect(classifyObjection("returns lower than my FD")).toBe("Returns / performance");
    expect(classifyObjection("I already invest with another broker")).toBe("Already invested elsewhere");
    expect(classifyObjection("call me next month")).toBe("Timing");
    expect(classifyObjection("do not trust online platforms")).toBe("Trust / safety");
    expect(classifyObjection("zzz qqq")).toBe("Other");
    expect(classifyObjection("")).toBe("Other");
  });
  it("builds a per-asset-class leaderboard with trend vs the previous period", () => {
    const cur = [
      { assetClass: "PMS", text: "lock-in too long" }, { assetClass: "PMS", text: "lock in worry" }, { assetClass: "PMS", text: "fees too high" },
      { assetClass: "AIF", text: "minimum ticket too large" },
    ];
    const prev = [{ assetClass: "PMS", text: "lock-in" }, { assetClass: "PMS", text: "fees high" }, { assetClass: "PMS", text: "fees too much" }];
    const lb = objectionLeaderboard(cur, prev);
    const pms = lb.rows.find((r) => r.assetClass === "PMS")!;
    expect(pms.total).toBe(3);
    expect(pms.themes[0]).toMatchObject({ theme: "Lock-in / liquidity", count: 2, prevCount: 1, trend: "up" });
    expect(pms.themes[1]).toMatchObject({ theme: "Fees and costs", count: 1, prevCount: 2, trend: "down" });
    const aif = lb.rows.find((r) => r.assetClass === "AIF")!;
    expect(aif.themes[0]).toMatchObject({ theme: "Ticket size", trend: "new" });
    expect(lb.rows[0].assetClass).toBe("PMS"); // sorted by volume
    expect(lb.themes).toContain("Lock-in / liquidity");
    expect(JSON.stringify(lb)).not.toContain("too long");
  });
  it("is empty for no objections and treats a missing asset class as Unspecified", () => {
    expect(objectionLeaderboard([], []).rows).toEqual([]);
    expect(objectionLeaderboard([{ assetClass: null, text: "fees" }], []).rows[0].assetClass).toBe("Unspecified");
  });
  it("flat when equal counts", () => {
    const lb = objectionLeaderboard([{ assetClass: "PMS", text: "fees" }], [{ assetClass: "PMS", text: "fees" }]);
    expect(lb.rows[0].themes[0].trend).toBe("flat");
  });
});

describe("stageFunnel", () => {
  const stages = [{ id: "s1", name: "Lead", sequence: 1 }, { id: "s2", name: "KYC", sequence: 2 }, { id: "s3", name: "Funded", sequence: 3 }];
  const day = (n: number) => new Date(Date.UTC(2026, 8, n));
  it("counts reached/advanced and median time in stage", () => {
    const clients = [
      { id: "a", createdAt: day(1), currentStageId: "s3" },
      { id: "b", createdAt: day(1), currentStageId: "s2" },
      { id: "c", createdAt: day(1), currentStageId: "s1" },
    ];
    const history = [
      { clientId: "a", fromStageId: "s1", toStageId: "s2", changedAt: day(3) }, // 2d in s1
      { clientId: "a", fromStageId: "s2", toStageId: "s3", changedAt: day(7) }, // 4d in s2
      { clientId: "b", fromStageId: "s1", toStageId: "s2", changedAt: day(5) }, // 4d in s1
    ];
    const rows = stageFunnel(stages, clients, history);
    expect(rows.map((r) => r.reached)).toEqual([3, 2, 1]);
    expect(rows[0]).toMatchObject({ name: "Lead", advanced: 2, stillHere: 1 });
    expect(rows[0].conversion).toBeCloseTo(2 / 3);
    expect(rows[0].medianHoursInStage).toBe(72); // median(48h, 96h)
    expect(rows[1].medianHoursInStage).toBe(96);
    expect(rows[2].medianHoursInStage).toBeNull(); // nobody has left Funded
    expect(rows[2].conversion).toBeNull(); // last stage
  });
  it("client with no history is at its current stage only", () => {
    const rows = stageFunnel(stages, [{ id: "z", createdAt: day(1), currentStageId: "s2" }], []);
    expect(rows.map((r) => r.reached)).toEqual([0, 1, 0]);
  });
  it("zero clients gives zero rows with null rates", () => {
    const rows = stageFunnel(stages, [], []);
    expect(rows.every((r) => r.reached === 0 && r.conversion === null && r.medianHoursInStage === null)).toBe(true);
  });
  it("a backwards move does not double count reach", () => {
    const rows = stageFunnel(stages, [{ id: "a", createdAt: day(1), currentStageId: "s2" }], [
      { clientId: "a", fromStageId: "s1", toStageId: "s2", changedAt: day(2) },
      { clientId: "a", fromStageId: "s2", toStageId: "s1", changedAt: day(3) },
      { clientId: "a", fromStageId: "s1", toStageId: "s2", changedAt: day(4) },
    ]);
    expect(rows.map((r) => r.reached)).toEqual([1, 1, 0]);
  });
});
