import { describe, expect, it } from "vitest";

import { SIM_LABEL, simulate, simulateSequence, type SimAction, type TargetFacts } from "./engine";

const NOW = new Date("2027-05-10T05:30:00Z");
const H = 3_600_000;
const D = 24 * H;

const action = (over: Partial<SimAction> = {}): SimAction => ({
  id: "bulk-follow-up", purpose: "SERVICE_COMMS", channels: ["whatsapp", "call", "email"], recentContactHours: 48, frequencyCap: { maxContacts: 3, windowDays: 14 }, aiCallsPerTarget: 0, ...over,
});
const target = (id: string, over: Partial<TargetFacts> = {}): TargetFacts => ({
  id, label: `Customer ${id}`, consent: [], legacyMarketingConsentAt: null, lastContactAt: null, contactsInWindow: 0, openComplaint: false, complianceConcern: false, hasMobile: true, hasEmail: true, ...over,
});
const grant = (purpose: string, channel: string | null = null) => ({ purpose, channel, status: "GRANTED", capturedAt: new Date(NOW.getTime() - 30 * D), id: `${purpose}-${channel}` });
const withdraw = (purpose: string, channel: string | null = null) => ({ purpose, channel, status: "WITHDRAWN", capturedAt: new Date(NOW.getTime() - 1 * D), id: `w-${purpose}-${channel}` });

const run = (a: SimAction, ts: TargetFacts[], opts: Parameters<typeof simulate>[3] = {}) => simulate(a, ts, NOW, opts);
const reasonsOf = (r: ReturnType<typeof simulate>, id: string) => r.suppressed.find((s) => s.id === id)?.reasons ?? [];

describe("simulate(): who is eligible, who is suppressed and why", () => {
  it("is a dry run: labelled, dated, and it changes nothing (pure)", () => {
    const r = run(action(), [target("a")]);
    expect(r.label).toBe(SIM_LABEL);
    expect(r.asOf).toEqual(NOW);
    expect(r.dryRun).toBe(true);
    expect(r.total).toBe(1);
  });

  it("an unremarkable customer is eligible with the first usable channel", () => {
    const r = run(action(), [target("a")]);
    expect(r.eligible).toEqual([{ id: "a", label: "Customer a", channel: "whatsapp" }]);
    expect(r.suppressed).toEqual([]);
  });

  it("consent: a withdrawn purpose suppresses, and nothing is eligible without consent for ANY channel", () => {
    const r = run(action({ purpose: "MARKETING_COMMS" }), [target("a", { consent: [withdraw("MARKETING_COMMS")] }), target("b", { consent: [grant("MARKETING_COMMS")] })], { consentEnforced: true });
    expect(reasonsOf(r, "a")).toContain("consent");
    expect(r.eligible.map((e) => e.id)).toEqual(["b"]);
  });

  it("consent is per channel: WhatsApp withdrawn falls back to the next channel with consent", () => {
    const r = run(action({ purpose: "MARKETING_COMMS" }), [target("a", { consent: [grant("MARKETING_COMMS"), withdraw("MARKETING_COMMS", "whatsapp")] })], { consentEnforced: true });
    expect(r.eligible[0].channel).toBe("call");
  });

  it("do-not-contact suppresses everything, even a granted purpose", () => {
    const dnd = { purpose: "DO_NOT_CONTACT", channel: null, status: "GRANTED", capturedAt: new Date(NOW.getTime() - D), id: "dnd" };
    const r = run(action({ purpose: "MARKETING_COMMS" }), [target("a", { consent: [grant("MARKETING_COMMS"), dnd] })], { consentEnforced: true });
    expect(reasonsOf(r, "a")).toContain("do_not_contact");
    expect(r.eligible).toEqual([]);
  });

  it("an open complaint suppresses a sales action but not a service action", () => {
    const sales = run(action({ purpose: "MARKETING_COMMS", kind: "sales" }), [target("a", { openComplaint: true, consent: [grant("MARKETING_COMMS")] })], { consentEnforced: true });
    expect(reasonsOf(sales, "a")).toContain("open_complaint");
    const service = run(action({ kind: "service" }), [target("a", { openComplaint: true })]);
    expect(service.eligible.map((e) => e.id)).toEqual(["a"]);
  });

  it("a compliance concern suppresses every outreach", () => {
    expect(reasonsOf(run(action({ kind: "service" }), [target("a", { complianceConcern: true })]), "a")).toContain("compliance_concern");
  });

  it("recent contact within the window suppresses; just outside it does not", () => {
    const r = run(action(), [target("a", { lastContactAt: new Date(NOW.getTime() - 24 * H) }), target("b", { lastContactAt: new Date(NOW.getTime() - 49 * H) })]);
    expect(reasonsOf(r, "a")).toContain("recent_contact");
    expect(r.eligible.map((e) => e.id)).toEqual(["b"]);
  });

  it("the frequency cap suppresses at the cap, not below it", () => {
    const r = run(action(), [target("a", { contactsInWindow: 3 }), target("b", { contactsInWindow: 2 })]);
    expect(reasonsOf(r, "a")).toContain("frequency_cap");
    expect(r.eligible.map((e) => e.id)).toEqual(["b"]);
  });

  it("no usable channel suppresses (no mobile and no email for the channels asked)", () => {
    const r = run(action({ channels: ["whatsapp", "email"] }), [target("a", { hasMobile: false, hasEmail: false })]);
    expect(reasonsOf(r, "a")).toContain("no_channel");
  });

  it("a customer can be suppressed for several reasons and every one is listed", () => {
    const r = run(action(), [target("a", { lastContactAt: new Date(NOW.getTime() - H), contactsInWindow: 9, openComplaint: true })], { consentEnforced: true });
    expect(reasonsOf(r, "a")).toEqual(expect.arrayContaining(["recent_contact", "frequency_cap"]));
  });

  it("counts reasons and splits the eligible by channel", () => {
    const r = run(action(), [target("a"), target("b", { hasMobile: false }), target("c", { hasMobile: false, hasEmail: false }), target("d", { contactsInWindow: 5 })]);
    expect(r.channelSplit).toMatchObject({ whatsapp: 1, call: 0, email: 1 });
    expect(r.reasonCounts).toMatchObject({ no_channel: 1, frequency_cap: 1 });
    expect(r.eligible.length + r.suppressed.length).toBe(r.total);
  });

  it("estimates AI calls and cost for the eligible only, labelled as an assumption", () => {
    const r = run(action({ aiCallsPerTarget: 2 }), [target("a"), target("b"), target("c", { contactsInWindow: 5 })]);
    expect(r.estimate.aiCalls).toBe(4);
    expect(r.estimate.costMinor).toBeGreaterThan(0);
    expect(r.estimate.note).toMatch(/assum/i);
    expect(run(action({ aiCallsPerTarget: 0 }), [target("a")]).estimate).toMatchObject({ aiCalls: 0, costMinor: 0 });
  });

  it("is deterministic: the same input gives the same result", () => {
    const ts = [target("a"), target("b", { contactsInWindow: 9 })];
    expect(run(action(), ts)).toEqual(run(action(), ts));
  });

  it("does not leak personal detail: ids and labels only", () => {
    const r = run(action(), [target("a")]);
    expect(Object.keys(r.eligible[0]).sort()).toEqual(["channel", "id", "label"]);
  });
});

describe("simulateSequence(): the interface journeys will use", () => {
  it("runs each step against the customers still in play and reports per step", () => {
    const steps = [action({ id: "step-1" }), action({ id: "step-2", frequencyCap: { maxContacts: 1, windowDays: 14 } })];
    const out = simulateSequence(steps, [target("a", { contactsInWindow: 1 }), target("b")], NOW, {});
    expect(out.steps.map((s) => s.actionId)).toEqual(["step-1", "step-2"]);
    expect(out.steps[0].result.eligible.length).toBe(2);
    expect(out.steps[1].result.eligible.map((e) => e.id)).toEqual(["b"]);
    expect(out.estimate.aiCalls).toBe(out.steps.reduce((n, s) => n + s.result.estimate.aiCalls, 0));
  });
});
