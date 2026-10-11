import { describe, expect, it } from "vitest";
import type { ConsentRow } from "@/lib/consent/decision";
import { emptyGateContext, type GateContext } from "./gate-context";
import { resolveChannel } from "./policy";
import { cand, daysAgo, hoursAgo, NOW } from "./test-helpers";

const row = (over: Partial<ConsentRow>): ConsentRow => ({ purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: daysAgo(30), ...over });
const ctx = (over: Partial<GateContext> = {}, rows: ConsentRow[] = []): GateContext => ({ ...emptyGateContext("c1", NOW), ...over, consent: { rows, legacyMarketingConsentAt: null } });

describe("policy and consent gate", () => {
  it("a sales call with marketing consent on file is allowed", () => {
    const r = resolveChannel(cand(), ctx({}, [row({})]));
    expect(r.channel).toBe("call");
    expect(r.policy.consent).toBe("ok");
    expect(r.policy.consentPurpose).toBe("MARKETING_COMMS");
  });

  it("a sales call with no marketing consent is blocked (mirrors the ledger policy), and says why", () => {
    const r = resolveChannel(cand(), ctx());
    expect(r.channel).toBeNull();
    expect(r.policy.consent).toBe("blocked");
    expect(r.blocks.map((b) => b.rule)).toContain("consent_dnd");
    expect(r.blocks[0].because).toMatch(/call/);
  });

  it("do-not-contact blocks every channel, even a service call", () => {
    const rows = [row({ purpose: "DO_NOT_CONTACT", status: "GRANTED" })];
    const service = cand({ sales: false, serviceRecovery: true, programme: "Service / relationship follow-up", assetClass: null });
    expect(resolveChannel(service, ctx({}, rows)).channel).toBeNull();
    expect(resolveChannel(cand({ channel: "whatsapp", action: "WhatsApp" }), ctx({}, rows)).channel).toBeNull();
  });

  it("withdrawn marketing consent on WhatsApp falls back to a call only if call is still allowed", () => {
    const rows = [row({ channel: "whatsapp", status: "WITHDRAWN", capturedAt: daysAgo(2) }), row({ channel: null, capturedAt: daysAgo(60) })];
    const r = resolveChannel(cand({ channel: "whatsapp", action: "WhatsApp" }), ctx({}, rows));
    expect(r.channel).toBe("call");
    expect(r.action).toBe("Call");
    expect(r.blocks.some((b) => b.rule === "consent_dnd" && /whatsapp/.test(b.because))).toBe(true);
  });

  it("a service message needs no opt-in (default allow) but a withdrawal stops it", () => {
    const service = cand({ sales: false, programme: "Complete KYC", assetClass: null, channel: "whatsapp", action: "WhatsApp" });
    expect(resolveChannel(service, ctx({ lastInboundWhatsAppAt: hoursAgo(2) })).channel).toBe("whatsapp");
    const withdrawn = [row({ purpose: "SERVICE_COMMS", channel: "whatsapp", status: "WITHDRAWN" })];
    expect(resolveChannel(service, ctx({ lastInboundWhatsAppAt: hoursAgo(2) }, withdrawn)).channel).toBe("call");
  });

  describe("WhatsApp 24 hour window", () => {
    const wa = cand({ sales: false, programme: "Complete KYC", assetClass: null, channel: "whatsapp", action: "WhatsApp" });
    it("open window: free text is fine", () => {
      const r = resolveChannel(wa, ctx({ lastInboundWhatsAppAt: hoursAgo(3) }));
      expect(r.policy.window).toBe("ok");
      expect(r.channel).toBe("whatsapp");
    });
    it("closed window with an approved template: template only", () => {
      const r = resolveChannel(wa, ctx({ lastInboundWhatsAppAt: hoursAgo(30), approvedTemplateExists: true }));
      expect(r.channel).toBe("whatsapp");
      expect(r.policy.window).toBe("closed");
    });
    it("closed window and no approved template: WhatsApp is blocked and the call is offered", () => {
      const r = resolveChannel(wa, ctx({ lastInboundWhatsAppAt: hoursAgo(30), approvedTemplateExists: false }));
      expect(r.blocks.map((b) => b.rule)).toContain("whatsapp_window");
      expect(r.channel).toBe("call");
    });
    it("no inbound message at all counts as a closed window", () => {
      expect(resolveChannel(wa, ctx({ lastInboundWhatsAppAt: null, approvedTemplateExists: false })).blocks.map((b) => b.rule)).toContain("whatsapp_window");
    });
  });

  it("an internal step (review, task) has no channel and needs no consent", () => {
    const r = resolveChannel(cand({ action: "Review", channel: "none", sales: false }), ctx());
    expect(r.channel).toBe("none");
    expect(r.policy.consentPurpose).toBeNull();
    expect(r.policy.consent).toBe("ok");
  });

  it("an AI Bot owner always needs approval and the policy says who approves", () => {
    const r = resolveChannel(cand({ owner: "AI Bot", sales: false, assetClass: null, programme: "Complete KYC", channel: "whatsapp", action: "WhatsApp" }), ctx({ lastInboundWhatsAppAt: hoursAgo(1) }));
    expect(r.policy.approvalNeeded).toBe(true);
    expect(r.policy.approver).toBe("RM");
  });

  it("flags a reason that fails the copy guardrails", () => {
    const r = resolveChannel(cand({ reason: "This PMS gives guaranteed returns", sales: true }), ctx({}, [row({})]));
    expect(r.policy.guardrails).toBe("flagged");
    expect(resolveChannel(cand(), ctx({}, [row({})])).policy.guardrails).toBe("ok");
  });
});
