import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: { leadIntake: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn().mockResolvedValue({}) }, notification: { create: vi.fn() } } }));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: vi.fn() }));
const resolveInboundClient = vi.fn();
vi.mock("@/lib/clients/inbound-contact", () => ({ resolveInboundClient: (a: unknown) => resolveInboundClient(a) }));
vi.mock("@/lib/stage-engine/create-task-if-not-exists", () => ({ createTaskIfNotExists: vi.fn() }));
const push = vi.fn();
vi.mock("@/lib/attribution/push-hook", () => ({ pushLeadToRm: (...a: unknown[]) => push(...a) }));

import { processLead } from "./ingest";

const base = { source: "meta_leads", externalId: "L-1", leadSource: "Meta Ads", name: "Meera Iyer", phone: "9876501234", answers: { goal: "retire early" }, attribution: { campaign: "Retirement Planning", campaign_id: "111" } };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_ATTRIBUTION;
  resolveInboundClient.mockResolvedValue({ client: { id: "c1", assignedToId: "rm-1", name: "Meera Iyer" }, isNew: true, returnedLead: false });
  push.mockResolvedValue(undefined);
});

describe("processLead and the lead push", () => {
  it("does nothing while the attribution flag is off (the shipping default)", async () => {
    expect(await processLead("ledger-1", base)).toEqual({ status: "created", clientId: "c1" });
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes a NEW lead to its RM once, with the submission's key, answers and cleaned attribution", async () => {
    vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "1");
    await processLead("ledger-1", base);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toMatchObject({ client: { id: "c1", assignedToId: "rm-1", name: "Meera Iyer" }, intakeKey: "meta_leads:L-1", input: { answers: { goal: "retire early" } }, attribution: { campaign: "Retirement Planning", campaign_id: "111", source: "meta_leads", externalId: "L-1" } });
    vi.unstubAllEnvs();
  });

  it("does not push for a returning person (that is a re-enquiry, not a new lead)", async () => {
    vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "1");
    resolveInboundClient.mockResolvedValue({ client: { id: "c9", assignedToId: "rm-1", name: "Meera Iyer" }, isNew: false, returnedLead: false });
    expect((await processLead("ledger-1", base)).status).toBe("duplicate");
    expect(push).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("a failing push never fails or loses the lead", async () => {
    vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "1");
    push.mockRejectedValue(new Error("boom"));
    expect(await processLead("ledger-1", base)).toEqual({ status: "created", clientId: "c1" });
    vi.unstubAllEnvs();
  });
});
