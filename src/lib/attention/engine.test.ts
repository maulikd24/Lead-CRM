import { describe, expect, it } from "vitest";

import { ALLOWED_KINDS, allowedKinds, buildFeed, scoreCandidate, validateDismissal, type AttentionCandidate, type FeedContext, type Scope } from "./engine";
import { ATTENTION_LABEL, ATTENTION_VERSION } from "./constants";

const NOW = new Date("2027-05-10T05:30:00Z"); // 11:00 IST, a Monday
const H = 3_600_000;

function cand(over: Partial<AttentionCandidate> = {}): AttentionCandidate {
  return {
    kind: "task", sourceRef: "t1", subject: { type: "client", id: "c1", label: "Customer C1" }, ownerUserId: "rm1", title: "Call back",
    importance: 3, urgency: 3, confidence: "high", confirmed: true, valueBand: "medium", risk: 3, occurredAt: new Date(NOW.getTime() - H), override: "none", href: "/tasks", ...over,
  };
}
const rmScope: Scope = { userId: "rm1", role: "RM", visibleUserIds: ["rm1"] };
const ctx = (over: Partial<FeedContext> = {}): FeedContext => ({ now: NOW, scope: rmScope, dismissals: [], capacities: {}, ...over });
const refs = (feed: { items: { sourceRef: string }[] }) => feed.items.map((i) => i.sourceRef);

describe("transparent score", () => {
  it("is a labelled heuristic with a why breakdown of all six factors", () => {
    const s = scoreCandidate(cand(), NOW);
    expect(s.why.label).toBe(ATTENTION_LABEL);
    expect(s.why.label).toMatch(/not a probability/i);
    expect(s.why.version).toBe(ATTENTION_VERSION);
    expect(s.why.factors.map((f) => f.key)).toEqual(["importance", "urgency", "confidence", "value", "risk", "decay"]);
    expect(s.score).toBeGreaterThan(0);
    expect(s.score).toBeLessThanOrEqual(100);
    const product = s.why.factors.reduce((p, f) => p * Math.pow(f.value, f.weight), 1);
    expect(s.score).toBeCloseTo(Math.round(product * 1000) / 10, 1);
  });

  it("goes up with importance, urgency, value and risk, and down with lower confidence", () => {
    const base = scoreCandidate(cand(), NOW).score;
    expect(scoreCandidate(cand({ importance: 5 }), NOW).score).toBeGreaterThan(base);
    expect(scoreCandidate(cand({ urgency: 5 }), NOW).score).toBeGreaterThan(base);
    expect(scoreCandidate(cand({ valueBand: "top" }), NOW).score).toBeGreaterThan(base);
    expect(scoreCandidate(cand({ risk: 5 }), NOW).score).toBeGreaterThan(base);
    expect(scoreCandidate(cand({ confidence: "low" }), NOW).score).toBeLessThan(base);
  });

  it("an AI-inferred, unconfirmed item can only be down-ranked, never lifted above a confirmed twin", () => {
    const confirmed = scoreCandidate(cand({ confirmed: true }), NOW).score;
    const inferred = scoreCandidate(cand({ confirmed: false }), NOW).score;
    expect(inferred).toBeLessThan(confirmed);
  });

  it("decays an opportunity as it goes stale but never decays a complaint or an overdue task", () => {
    const fresh = scoreCandidate(cand({ kind: "customer_opportunity", occurredAt: NOW }), NOW).score;
    const old = scoreCandidate(cand({ kind: "customer_opportunity", occurredAt: new Date(NOW.getTime() - 60 * 24 * H) }), NOW).score;
    expect(old).toBeLessThan(fresh);
    const oldTask = scoreCandidate(cand({ kind: "task", occurredAt: new Date(NOW.getTime() - 60 * 24 * H) }), NOW).score;
    const newTask = scoreCandidate(cand({ kind: "task", occurredAt: NOW }), NOW).score;
    expect(oldTask).toBe(newTask);
  });
});

describe("hard overrides outrank score", () => {
  const lowComplaint = cand({ kind: "complaint", sourceRef: "cmp", importance: 1, urgency: 1, risk: 1, valueBand: "low", override: "complaint" });
  const topTask = cand({ kind: "task", sourceRef: "task", importance: 5, urgency: 5, risk: 5, valueBand: "top" });

  it("a barely-scoring complaint is above the highest-scoring task", () => {
    expect(scoreCandidate(lowComplaint, NOW).score).toBeLessThan(scoreCandidate(topTask, NOW).score);
    expect(refs(buildFeed([topTask, lowComplaint], ctx()))).toEqual(["cmp", "task"]);
  });

  it("orders the tiers: critical incident, then compliance, then complaint, then everything else", () => {
    const adminScope: Scope = { userId: "a1", role: "ADMIN", visibleUserIds: null };
    const incident = cand({ kind: "failed_integration", sourceRef: "inc", ownerUserId: null, override: "critical_incident", importance: 1, urgency: 1, risk: 1 });
    const compliance = cand({ kind: "complaint", sourceRef: "cmpl", override: "compliance", importance: 1, urgency: 1, risk: 1 });
    const feed = buildFeed([topTask, lowComplaint, compliance, incident], ctx({ scope: adminScope }));
    expect(refs(feed)).toEqual(["inc", "cmpl", "cmp", "task"]);
  });

  it("inside one tier the score decides", () => {
    const a = cand({ kind: "complaint", sourceRef: "a", override: "complaint", importance: 2 });
    const b = cand({ kind: "complaint", sourceRef: "b", override: "complaint", importance: 5 });
    expect(refs(buildFeed([a, b], ctx()))).toEqual(["b", "a"]);
  });

  it("exposes the override in the why, so the reason it is on top is visible", () => {
    const item = buildFeed([lowComplaint], ctx()).items[0];
    expect(item.why.override).toMatchObject({ tier: "complaint" });
    expect(item.override).toBe("complaint");
  });
});

describe("role scoping", () => {
  const complaint = cand({ kind: "complaint", sourceRef: "cmp", override: "complaint" });
  const anomaly = cand({ kind: "campaign_anomaly", sourceRef: "camp", subject: { type: "campaign", id: "x", label: "Campaign X" }, ownerUserId: null });
  const integration = cand({ kind: "failed_integration", sourceRef: "int", ownerUserId: null, subject: { type: "system", id: "meta", label: "Meta sync" } });
  const approval = cand({ kind: "approval", sourceRef: "app", ownerUserId: null });
  const task = cand({ sourceRef: "t" });

  it("RM: own customers' work only, no system item, no approval, no campaign anomaly", () => {
    const f = buildFeed([complaint, anomaly, integration, approval, task, cand({ sourceRef: "other", ownerUserId: "rm2" })], ctx());
    expect(refs(f).sort()).toEqual(["cmp", "t"]);
  });

  it("RM: a system or approval item is refused by KIND even when it carries the RM's own id (defence in depth)", () => {
    const f = buildFeed([cand({ kind: "failed_integration", sourceRef: "own-int" }), cand({ kind: "approval", sourceRef: "own-app" }), cand({ kind: "campaign_anomaly", sourceRef: "own-camp" }), task], ctx());
    expect(refs(f)).toEqual(["t"]);
  });

  it("MANAGER: their team's customer work; never an approval (Admin inbox today), a system item or a campaign anomaly", () => {
    const scope: Scope = { userId: "m1", role: "MANAGER", visibleUserIds: ["m1", "rm1", "rm2"] };
    const f = buildFeed([complaint, anomaly, integration, approval, cand({ sourceRef: "r2", ownerUserId: "rm2" }), cand({ sourceRef: "out", ownerUserId: "rm9" })], ctx({ scope }));
    expect(refs(f).sort()).toEqual(["cmp", "r2"]);
  });

  it("ADMIN: everything, including system items (failed integrations, agent failures)", () => {
    const scope: Scope = { userId: "a1", role: "ADMIN", visibleUserIds: null };
    const f = buildFeed([complaint, anomaly, integration, approval, task, cand({ kind: "agent_failure", sourceRef: "ag", ownerUserId: null })], ctx({ scope }));
    expect(refs(f)).toContain("int");
    expect(refs(f)).toContain("ag");
    expect(f.items).toHaveLength(6);
  });

  it("MARKETING: campaign anomalies and nothing else, even when handed everything", () => {
    const scope: Scope = { userId: "mk1", role: "MARKETING", visibleUserIds: [] };
    const f = buildFeed([complaint, anomaly, integration, approval, task, cand({ kind: "data_quality", sourceRef: "dq", ownerUserId: null })], ctx({ scope }));
    expect(refs(f)).toEqual(["camp"]);
  });

  it("any other role gets an empty feed", () => {
    for (const role of ["FINANCE", "DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER"] as const) {
      expect(buildFeed([complaint, task, anomaly], ctx({ scope: { userId: "x", role, visibleUserIds: [] } })).items).toEqual([]);
    }
  });

  it("the allowed-kinds table never lets MARKETING near a customer kind (pinned)", () => {
    expect(allowedKinds("MARKETING")).toEqual(["campaign_anomaly"]);
    expect(ALLOWED_KINDS.RM).not.toContain("failed_integration");
  });
});

describe("capacity-aware lanes", () => {
  const many = (n: number, over: Partial<AttentionCandidate> = {}) => Array.from({ length: n }, (_, i) => cand({ sourceRef: `t${i}`, importance: 3, urgency: 3, occurredAt: new Date(NOW.getTime() - i * 60_000), ...over }));

  it("puts only what the RM can do in the 'now' lane and the rest in 'later'", () => {
    const f = buildFeed(many(30), ctx({ capacities: { rm1: { openWorkload: 0 } } }));
    const now = f.items.filter((i) => i.lane === "now").length;
    expect(now).toBeGreaterThan(2);
    expect(now).toBeLessThan(30);
    expect(f.items.filter((i) => i.lane === "later").length).toBe(30 - now);
  });

  it("an RM with a heavy open workload gets a smaller 'now' lane", () => {
    const light = buildFeed(many(30), ctx({ capacities: { rm1: { openWorkload: 0 } } })).items.filter((i) => i.lane === "now").length;
    const heavy = buildFeed(many(30), ctx({ capacities: { rm1: { openWorkload: 40 } } })).items.filter((i) => i.lane === "now").length;
    expect(heavy).toBeLessThan(light);
    expect(heavy).toBeGreaterThanOrEqual(1);
  });

  it("outside working hours the lane shrinks to a short list for the next morning, and a Sunday counts as outside", () => {
    const night = new Date("2027-05-10T14:00:00Z"); // 19:30 IST, after working hours
    const f = buildFeed(many(30), ctx({ now: night, capacities: { rm1: { openWorkload: 0 } } }));
    expect(f.items.filter((i) => i.lane === "now").length).toBeLessThanOrEqual(3);
    expect(f.capacity.rm1.outsideHours).toBe(true);
    const sunday = new Date("2027-05-09T06:00:00Z");
    expect(buildFeed(many(30), ctx({ now: sunday })).capacity.rm1.outsideHours).toBe(true);
  });

  it("outside working hours a heavy workload still leaves a short list (the minimum), so the morning plan is never empty", () => {
    const night = new Date("2027-05-10T14:00:00Z");
    const f = buildFeed(many(30), ctx({ now: night, capacities: { rm1: { openWorkload: 500 } } }));
    expect(f.items.filter((i) => i.lane === "now").length).toBe(3);
  });

  it("a hard override is NEVER pushed to 'later', whatever the workload", () => {
    const items = [...many(30), cand({ kind: "complaint", sourceRef: "cmp", override: "complaint", importance: 1 })];
    const f = buildFeed(items, ctx({ capacities: { rm1: { openWorkload: 500 } } }));
    expect(f.items.find((i) => i.sourceRef === "cmp")?.lane).toBe("now");
  });

  it("many overrides at once are all 'now' even when they outnumber the lane", () => {
    const items = Array.from({ length: 20 }, (_, i) => cand({ kind: "complaint", sourceRef: `cmp${i}`, override: "complaint" }));
    const f = buildFeed(items, ctx({ capacities: { rm1: { openWorkload: 500 } } }));
    expect(f.items.every((i) => i.lane === "now")).toBe(true);
    expect(f.capacity.rm1.deferred).toBe(0);
  });

  it("reports an overloaded RM so a manager can see it", () => {
    const f = buildFeed(many(30), ctx({ capacities: { rm1: { openWorkload: 40 } } }));
    expect(f.capacity.rm1.overloaded).toBe(true);
    expect(f.capacity.rm1.deferred).toBeGreaterThan(0);
  });
});

describe("dismiss and snooze", () => {
  it("hides a dismissed item and an item still snoozed, and brings a snoozed item back when the snooze ends", () => {
    const items = [cand({ sourceRef: "a" }), cand({ sourceRef: "b" }), cand({ sourceRef: "c" })];
    const dismissals = [
      { itemKey: "task:a", status: "DISMISSED" as const, snoozeUntil: null },
      { itemKey: "task:b", status: "SNOOZED" as const, snoozeUntil: new Date(NOW.getTime() + H) },
    ];
    expect(refs(buildFeed(items, ctx({ dismissals })))).toEqual(["c"]);
    expect(refs(buildFeed(items, ctx({ dismissals, now: new Date(NOW.getTime() + 2 * H) }))).sort()).toEqual(["b", "c"]);
  });

  it("an item with a hard override cannot be dismissed, and can be snoozed for 24 hours at most, with a reason", () => {
    const o = { override: "complaint" as const };
    expect(validateDismissal({ ...o, status: "DISMISSED", snoozeUntil: null, reason: "x", now: NOW })).toMatchObject({ ok: false });
    expect(validateDismissal({ ...o, status: "SNOOZED", snoozeUntil: new Date(NOW.getTime() + 48 * H), reason: "x", now: NOW })).toMatchObject({ ok: false });
    expect(validateDismissal({ ...o, status: "SNOOZED", snoozeUntil: new Date(NOW.getTime() + 6 * H), reason: "", now: NOW })).toMatchObject({ ok: false });
    expect(validateDismissal({ ...o, status: "SNOOZED", snoozeUntil: new Date(NOW.getTime() + 6 * H), reason: "Calling after lunch", now: NOW })).toMatchObject({ ok: true });
  });

  it("an ordinary item can be dismissed, or snoozed up to 14 days, never into the past", () => {
    const o = { override: "none" as const };
    expect(validateDismissal({ ...o, status: "DISMISSED", snoozeUntil: null, reason: null, now: NOW })).toMatchObject({ ok: true });
    expect(validateDismissal({ ...o, status: "SNOOZED", snoozeUntil: new Date(NOW.getTime() + 15 * 24 * H), reason: null, now: NOW })).toMatchObject({ ok: false });
    expect(validateDismissal({ ...o, status: "SNOOZED", snoozeUntil: new Date(NOW.getTime() - H), reason: null, now: NOW })).toMatchObject({ ok: false });
    expect(validateDismissal({ ...o, status: "SNOOZED", snoozeUntil: null, reason: null, now: NOW })).toMatchObject({ ok: false });
  });
});
