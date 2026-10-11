import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { EVENT_DOMAINS, isValidEventTypeName } from "./envelope";
import { EVENT_REGISTRY, eventDef, registeredTypes } from "./registry";

describe("event type naming (the event taxonomy)", () => {
  it("accepts domain.entity.action in lower snake case with a closed domain", () => {
    for (const ok of ["lead.created", "account.kyc.step.completed", "whatsapp.message.received", "customer.consent.granted", "nba.decision.not_now"]) expect(isValidEventTypeName(ok), ok).toBe(true);
  });
  it("rejects unknown domains, bad characters, commands and a missing action", () => {
    for (const bad of ["lead", "Lead.created", "lead.Created", "lead.create", "send.nudge", "foo.bar.created", "lead..created", "lead.created.", "lead.created now", "lead.send_nudge"]) expect(isValidEventTypeName(bad), bad).toBe(false);
  });
  it("the domains are exactly the closed list of the taxonomy", () => {
    expect([...EVENT_DOMAINS].sort()).toEqual(["account", "agent", "call", "campaign", "complaint", "customer", "lead", "nba", "portfolio", "referral", "ticket", "transaction", "whatsapp"]);
  });
});

describe("the event registry", () => {
  const types = registeredTypes();
  it("registers every type of the v1 taxonomy", () => {
    const required = [
      "lead.intake.received", "lead.intake.failed", "lead.created", "lead.deduplicated", "lead.assigned", "lead.contacted", "lead.qualified", "lead.lost", "lead.speed_to_contact.measured",
      "customer.created", "customer.merged", "customer.updated", "customer.stage.changed", "customer.consent.granted", "customer.consent.withdrawn", "customer.goal.created", "customer.goal.updated", "customer.review.completed", "customer.erased",
      "account.kyc.started", "account.kyc.step.completed", "account.kyc.verified", "account.kyc.rejected", "account.opened", "account.funded", "account.closed",
      "transaction.recorded", "transaction.sip.started", "transaction.sip.missed",
      "portfolio.snapshot.updated", "portfolio.holding.changed", "portfolio.external_holding.declared",
      "whatsapp.message.received", "whatsapp.message.sent", "whatsapp.message.delivered", "whatsapp.message.read", "whatsapp.window.expired", "whatsapp.handover.detected", "whatsapp.template.sent",
      "call.logged", "call.recording.available", "call.review.completed",
      "ticket.created", "ticket.status.changed", "ticket.resolved", "ticket.sla.breached",
      "complaint.raised", "complaint.acknowledged", "complaint.resolved",
      "campaign.spend.synced", "campaign.lead.attributed", "campaign.lead.pushed", "campaign.lead.sla.breached", "campaign.funded.attributed", "campaign.conversion.sent", "campaign.conversion.failed", "campaign.autopilot.recommended", "campaign.autopilot.approved", "campaign.autopilot.denied", "campaign.autopilot.applied", "campaign.autopilot.apply.failed",
      "referral.code.issued", "referral.attributed", "referral.flagged", "referral.qualified", "referral.reward.accrued", "referral.reward.clawed_back",
      "nba.decision.created", "nba.decision.suppressed", "nba.decision.accepted", "nba.decision.snoozed", "nba.decision.rejected_wrong", "nba.decision.not_now", "nba.decision.do_not_recommend", "nba.decision.expired", "nba.outcome.linked",
      "agent.run.started", "agent.run.completed", "agent.run.blocked", "agent.run.failed", "agent.proposal.drafted", "agent.proposal.approved", "agent.proposal.rejected", "agent.proposal.sent", "agent.killswitch.toggled",
    ];
    expect(types.sort()).toEqual([...required].sort());
  });
  it("every registered name passes the naming rule, starts at schema version 1 and carries a classification", () => {
    for (const t of types) {
      const d = eventDef(t)!;
      expect(isValidEventTypeName(t), t).toBe(true);
      expect(d.currentVersion, t).toBeGreaterThanOrEqual(1);
      expect(Object.keys(d.schemas).map(Number), t).toContain(d.currentVersion);
      expect(["PUBLIC_AGGREGATE", "INTERNAL", "PERSONAL", "SENSITIVE_PERSONAL"], t).toContain(d.dataClass);
    }
  });
  it("an event that is about a customer says so; only system, intake and campaign facts may have no customer", () => {
    const customerless = types.filter((t) => !eventDef(t)!.customerRequired).sort();
    expect(customerless).toEqual([
      "agent.killswitch.toggled", "agent.run.blocked", "agent.run.completed", "agent.run.failed", "agent.run.started",
      "campaign.autopilot.applied", "campaign.autopilot.apply.failed", "campaign.autopilot.approved", "campaign.autopilot.denied", "campaign.autopilot.recommended", "campaign.spend.synced",
      "lead.intake.failed", "lead.intake.received",
    ]);
  });
  it("metadata schemas accept a minimal valid payload and refuse a wrong type", () => {
    const d = eventDef("whatsapp.message.received")!;
    expect(d.schemas[1].safeParse({ ref: { table: "Message", id: "m1" }, channel: "whatsapp" }).success).toBe(true);
    expect(d.schemas[1].safeParse({ channel: 7 }).success).toBe(false);
  });
  it("metadata schemas strip unknown keys, so a free-text field can never be smuggled into a stored event", () => {
    const parsed = eventDef("lead.created")!.schemas[1].parse({ ref: { table: "Client", id: "c1" }, body: "call me on 9876543210" });
    expect(JSON.stringify(parsed)).not.toContain("9876543210");
  });
  it("the registry is keyed by the type it holds", () => {
    for (const [k, d] of Object.entries(EVENT_REGISTRY)) expect(d.type).toBe(k);
  });
});

describe("the tables the event facts mirror (Wave 1 integration seam)", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const models = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));
  it("every `mirrors` value written as a table name names a real table (a descriptive phrase such as ad spend facts is prose and is skipped)", () => {
    for (const t of registeredTypes()) {
      const m = eventDef(t)!.mirrors;
      if (m && /^[A-Z]\w*$/.test(m)) expect(models.has(m), `${t} mirrors ${m}`).toBe(true);
    }
  });
  it("agent.run.* points at AgentRun (the gateway's trace table, on the train since Wave 1)", () => {
    for (const t of ["agent.run.started", "agent.run.completed", "agent.run.blocked", "agent.run.failed"]) expect(eventDef(t)?.mirrors, t).toBe("AgentRun");
    expect(models.has("AgentRun")).toBe(true);
  });
  it("nba.* keeps its seam until a DecisionRecord table exists: it must not point at a table that is not there", () => {
    if (models.has("DecisionRecord")) {
      for (const t of registeredTypes().filter((x) => x.startsWith("nba.decision."))) expect(eventDef(t)?.mirrors, t).toBe("DecisionRecord");
    } else {
      for (const t of registeredTypes().filter((x) => x.startsWith("nba."))) expect(eventDef(t)?.mirrors, t).toBeNull();
    }
  });
});
