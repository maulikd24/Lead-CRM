import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: { leadIntake: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn().mockResolvedValue({}) }, notification: { create: vi.fn() } } }));
const logActivity = vi.fn();
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...a) }));
const resolveInboundClient = vi.fn();
vi.mock("@/lib/clients/inbound-contact", () => ({ resolveInboundClient: (a: unknown) => resolveInboundClient(a) }));
vi.mock("@/lib/stage-engine/create-task-if-not-exists", () => ({ createTaskIfNotExists: vi.fn() }));
const routed = vi.fn();
vi.mock("@/lib/planner/intake", () => ({ routeCampaignLead: (...a: unknown[]) => routed(...a) }));
vi.mock("@/lib/planner/db", () => ({ plannerIntakeDeps: () => ({}) }));
const emitRouted = vi.fn();
vi.mock("@/lib/events/producers-emit", () => ({ emitCampaignLeadRouted: (...a: unknown[]) => emitRouted(...a), emitLeadCreated: vi.fn(), emitLeadAssigned: vi.fn() }));

import { processLead } from "./ingest";

const base = { source: "meta_leads", externalId: "L-9", leadSource: "Meta Ads", name: "Meera Iyer", phone: "9876501234", city: "Mumbai", productInterest: "Portfolio check", attribution: { campaign_code: "CP-ABC234", utm_source: "meta" } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  resolveInboundClient.mockResolvedValue({ client: { id: "c1", assignedToId: "rm-7", name: "Meera Iyer" }, isNew: true, returnedLead: false });
  routed.mockResolvedValue({ assignedToId: "rm-7", planId: "pl1", via: "rule", code: "CP-ABC234" });
});

describe("the lead intake asks the planner who owns a campaign lead", () => {
  it("does nothing while the planner flag is off (the shipping default)", async () => {
    await processLead("ledger-1", base);
    expect(routed).not.toHaveBeenCalled();
    expect(resolveInboundClient.mock.calls[0][0].assignedToId).toBeUndefined();
  });

  it("passes the routed owner to the contact resolver, and records and emits the routing", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLANNER", "1");
    expect(await processLead("ledger-1", base)).toEqual({ status: "created", clientId: "c1" });
    expect(routed.mock.calls[0][0]).toMatchObject({ attribution: { campaign_code: "CP-ABC234" }, city: "Mumbai", productInterest: "Portfolio check" });
    expect(resolveInboundClient.mock.calls[0][0].assignedToId).toBe("rm-7");
    expect(emitRouted).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1", planId: "pl1", via: "rule" }));
    expect(logActivity.mock.calls.some((c) => /campaign plan CP-ABC234/.test(JSON.stringify(c)))).toBe(true);
  });

  it("no route means the default assignment decides, untouched", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLANNER", "1");
    routed.mockResolvedValue(null);
    await processLead("ledger-1", base);
    expect(resolveInboundClient.mock.calls[0][0].assignedToId).toBeUndefined();
    expect(emitRouted).not.toHaveBeenCalled();
  });

  it("a returning person is not re-routed", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLANNER", "1");
    resolveInboundClient.mockResolvedValue({ client: { id: "c9", assignedToId: "rm-2", name: "Meera Iyer" }, isNew: false, returnedLead: false });
    await processLead("ledger-1", base);
    expect(emitRouted).not.toHaveBeenCalled();
  });

  it("a failing planner lookup never fails or loses the lead", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLANNER", "1");
    routed.mockRejectedValue(new Error("boom"));
    expect(await processLead("ledger-1", base)).toEqual({ status: "created", clientId: "c1" });
  });
});
