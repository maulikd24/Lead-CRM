import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeProvider } from "@/lib/ai/provider";

// --- shared fakes for the modules the call sites import ---------------------------------------------------------
const clientFindMany = vi.fn(async (_args: unknown) => [{ id: "a" }, { id: "b" }, { id: "c" }]);
const consentFindMany = vi.fn(async (_args: unknown) => [] as unknown[]);
const clientFindManyForSnaps = vi.fn(async (_args: unknown) => [] as unknown[]);
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    client: { findMany: (a: unknown) => (isSnapshotQuery(a) ? clientFindManyForSnaps(a) : clientFindMany(a)) },
    consentRecord: { findMany: (a: unknown) => consentFindMany(a) },
    agentSetting: { findUnique: async () => ({ enabled: true }) },
    agentProposal: { count: async () => 0, create: async () => ({ id: "p" }), findMany: async () => [] },
  },
  basePrisma: {},
}));
const isSnapshotQuery = (a: unknown) => JSON.stringify(a).includes("marketingConsentAt\":{\"not\":null}") && JSON.stringify(a).includes('"id":{"in"');
vi.mock("@/lib/intelligence/agent", () => ({ buildAgentBriefing: vi.fn(async () => null) }));
vi.mock("@/lib/whatsapp/send", () => ({ queueWhatsAppReply: vi.fn() }));

const logActivity = vi.fn(async (_a: unknown) => ({}));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: (a: unknown) => logActivity(a) }));
const sendEmail = vi.fn(async (_m: unknown) => ({ success: true, data: { id: "e1" } }));
vi.mock("@/lib/integrations/registry", () => ({ getAdapter: vi.fn(), getEmailAdapter: async () => ({ sendEmail }) }));
const sendMessage = vi.fn(async (_m: unknown) => ({ id: "m1", status: "SENT" }));
vi.mock("@/lib/messaging/send", () => ({ sendMessage: (m: unknown) => sendMessage(m), substitute: (b: string) => b }));
vi.mock("@/lib/stage-engine/transitions", () => ({ putOnHold: vi.fn(), markNotProceeding: vi.fn() }));
vi.mock("@/lib/stage-engine/next-action", () => ({ syncNextAction: vi.fn() }));

import { nudgerDeps, batchDeps, loadNudgerCandidates } from "@/lib/agents/wiring";
import { draftNudge, type NudgerDeps } from "@/lib/agents/nudger";
import { selectBatch, type SelectDb } from "@/lib/integrations/clevertap/select-batch";
import { executeAction } from "@/lib/journeys/nodes/action";
import { journeyConsentBlock } from "./journeys";
import { applyPushStance, pushStance, pushStanceFor } from "./push";
import { resolvePolicy } from "./policy";
import { coarseMarketingWhere } from "./coarse";
import type { EnforceDeps } from "./enforce";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const NOW = new Date("2026-10-09T10:00:00Z");
const fp = () => new FakeProvider("x");

describe("nudger: flag OFF is identical to before", () => {
  it("nudgerDeps has exactly the original keys (no consent gate)", () => {
    vi.stubEnv("CONSENT_ENFORCEMENT", "");
    expect(Object.keys(nudgerDeps(fp())).sort()).toEqual(["briefing", "isEnabled", "now", "provider", "recentProposals", "save"]);
  });
  it("only the exact value 1 adds the gate", () => {
    vi.stubEnv("CONSENT_ENFORCEMENT", "true");
    expect("consent" in nudgerDeps(fp())).toBe(false);
    vi.stubEnv("CONSENT_ENFORCEMENT", "1");
    expect("consent" in nudgerDeps(fp())).toBe(true);
  });
  it("candidate query is the original shape: take = limit, no AND, no consent filter", async () => {
    vi.stubEnv("CONSENT_ENFORCEMENT", "");
    const ids = await batchDeps(fp()).loadCandidates(10);
    expect(ids).toEqual(["a", "b", "c"]);
    const args = clientFindMany.mock.calls[0][0] as { take: number; where: Record<string, unknown> };
    expect(args.take).toBe(10);
    expect("AND" in args.where).toBe(false);
    expect(JSON.stringify(args)).not.toMatch(/consent/i);
    expect(consentFindMany).not.toHaveBeenCalled();
  });
  it("loadNudgerCandidates without the new argument is unchanged", async () => {
    await loadNudgerCandidates(5);
    expect(JSON.stringify(clientFindMany.mock.calls[0][0])).not.toMatch(/AND|consent/i);
  });
});

describe("nudger: flag ON", () => {
  it("over-fetches with the coarse evidence filter, then keeps only customers the full decision allows", async () => {
    vi.stubEnv("CONSENT_ENFORCEMENT", "1");
    // a: granted row. b: no snapshot (denied). c: granted row but a do-not-contact flag.
    consentFindMany.mockResolvedValueOnce([
      { clientId: "a", id: "1", purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: new Date("2026-01-01"), expiresAt: null },
      { clientId: "c", id: "2", purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: new Date("2026-01-01"), expiresAt: null },
      { clientId: "c", id: "3", purpose: "DO_NOT_CONTACT", channel: null, status: "GRANTED", capturedAt: new Date("2026-02-01"), expiresAt: null },
    ]);
    const ids = await batchDeps(fp()).loadCandidates(2);
    expect(ids).toEqual(["a"]);
    const args = clientFindMany.mock.calls[0][0] as { take: number; where: { AND: unknown[] } };
    expect(args.take).toBe(8);
    expect(JSON.stringify(args.where.AND)).toContain("marketingConsentAt");
  });
  it("record-only marketing skips the coarse filter entirely", () => {
    expect(coarseMarketingWhere(resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: "MARKETING_COMMS" }))).toBeUndefined();
    expect(coarseMarketingWhere(resolvePolicy({}))).toBeDefined();
  });
});

describe("draftNudge consent gate", () => {
  const base = (over: Partial<NudgerDeps> = {}) => {
    const briefing = vi.fn(async () => null);
    const save = vi.fn();
    const deps: NudgerDeps = { briefing, provider: fp(), isEnabled: async () => true, recentProposals: async () => [], save, now: () => NOW, ...over };
    return { deps, briefing, save };
  };
  it("without a gate it behaves as before (goes on to build the briefing)", async () => {
    const { deps, briefing } = base();
    expect(await draftNudge("c1", deps)).toEqual({ status: "skipped", reason: "customer not found" });
    expect(briefing).toHaveBeenCalled();
  });
  it("a denying gate skips with 'no consent' before any briefing, vendor call or save", async () => {
    const provider = fp();
    const { deps, briefing, save } = base({ consent: async () => ({ allowed: false, reason: "no consent" }), provider });
    expect(await draftNudge("c1", deps)).toEqual({ status: "skipped", reason: "no consent" });
    expect(briefing).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  });
  it("an allowing gate lets the normal flow run", async () => {
    const { deps, briefing } = base({ consent: async () => ({ allowed: true }) });
    await draftNudge("c1", deps);
    expect(briefing).toHaveBeenCalled();
  });
  it("the disabled-agent skip still comes first", async () => {
    const consent = vi.fn(async () => ({ allowed: false }));
    const { deps } = base({ isEnabled: async () => false, consent });
    expect(await draftNudge("c1", deps)).toEqual({ status: "skipped", reason: "agent is disabled" });
    expect(consent).not.toHaveBeenCalled();
  });
});

describe("journey send nodes", () => {
  const client = { id: "c1", email: "a@example.com", name: "A", clientCode: "CL-1", assignedToId: null } as never;
  const off: EnforceDeps = { enforced: () => false, load: vi.fn(), now: () => NOW, policy: () => resolvePolicy({}) };
  const denying: EnforceDeps = { enforced: () => true, load: async () => new Map(), now: () => NOW, policy: () => resolvePolicy({}) };

  it("journeyConsentBlock returns null and reads nothing while enforcement is off", async () => {
    const log = vi.fn();
    expect(await journeyConsentBlock("c1", "whatsapp", {}, log, off)).toBeNull();
    expect(off.load).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
  it("blocks, logs 'blocked: no consent' and reports a successful skip", async () => {
    const log = vi.fn();
    const res = await journeyConsentBlock("c1", "whatsapp", {}, log, denying);
    expect(res).toEqual({ success: true, result: { skipped: true, reason: "blocked: no consent" } });
    expect(log).toHaveBeenCalledWith("c1", expect.stringContaining("blocked: no consent"), "blocked: no consent");
  });
  it("a node can opt into service messages, which are allowed by default", async () => {
    expect(await journeyConsentBlock("c1", "whatsapp", { purpose: "SERVICE_COMMS" }, vi.fn(), denying)).toBeNull();
  });
  it("fails closed if the ledger cannot be read", async () => {
    const broken = { ...denying, load: async () => { throw new Error("db"); } };
    expect((await journeyConsentBlock("c1", "email", {}, vi.fn(), broken))?.result.reason).toBe("blocked: consent check failed");
  });

  it("send_email: flag OFF sends exactly as before and never logs a block", async () => {
    vi.stubEnv("CONSENT_ENFORCEMENT", "");
    const res = await executeAction({ actionType: "send_email", config: { subject: "s", body: "b" } } as never, client, "run1");
    expect(res.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logActivity.mock.calls[0][0])).toContain("Journey sent email");
  });
  it("send_message: flag OFF sends exactly as before", async () => {
    vi.stubEnv("CONSENT_ENFORCEMENT", "");
    const res = await executeAction({ actionType: "send_message", config: { channel: "whatsapp", templateId: "t" } } as never, client, "run1");
    expect(res).toEqual({ success: true, result: { messageId: "m1", status: "SENT" } });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
  it("flag ON with no consent: nothing is sent and a 'blocked: no consent' note is logged, for both nodes", async () => {
    vi.stubEnv("CONSENT_ENFORCEMENT", "1");
    consentFindMany.mockResolvedValue([]);
    clientFindManyForSnaps.mockResolvedValue([]);
    const a = await executeAction({ actionType: "send_email", config: { subject: "s", body: "b" } } as never, client, "run1");
    const b = await executeAction({ actionType: "send_message", config: { channel: "sms" } } as never, client, "run1");
    for (const r of [a, b]) expect(r).toEqual({ success: true, result: { skipped: true, reason: "blocked: no consent" } });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logActivity.mock.calls[0][0])).toContain("blocked: no consent");
  });
});
