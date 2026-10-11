import { Prisma } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { leadIntake, resolveInboundClient, alertNewLead } = vi.hoisted(() => ({
  leadIntake: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  resolveInboundClient: vi.fn(),
  alertNewLead: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: { leadIntake, notification: { create: vi.fn() } } }));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/clients/inbound-contact", () => ({ resolveInboundClient }));
vi.mock("@/lib/stage-engine/create-task-if-not-exists", () => ({ createTaskIfNotExists: vi.fn() }));
vi.mock("@/lib/attribution/push-hook", () => ({ pushLeadToRm: vi.fn() }));
vi.mock("@/lib/leads/gchat-alert", () => ({ alertNewLead }));

import { ingestLead, processLead } from "./ingest";

const base = { source: "meta_leads", externalId: "L-9", leadSource: "Meta Ads", name: "Meera Iyer", phone: "9876501234", email: "meera@example.test", message: "retire early", attribution: { campaign: "Retirement Planning" } };
const created = { client: { id: "cl_new", assignedToId: "rm-1", name: "Meera Iyer", currentStageId: "st-1" }, isNew: true, returnedLead: false };

beforeEach(() => {
  vi.clearAllMocks();
  leadIntake.update.mockResolvedValue({});
  resolveInboundClient.mockResolvedValue(created);
  alertNewLead.mockResolvedValue("skipped");
});

describe("lead intake and the Google Chat alert", () => {
  it("a new lead fires one alert with only the safe facts, after the ledger is marked CREATED", async () => {
    expect(await processLead("ledger-1", base)).toEqual({ status: "created", clientId: "cl_new" });
    expect(alertNewLead).toHaveBeenCalledTimes(1);
    expect(alertNewLead.mock.calls[0][0]).toEqual({ clientId: "cl_new", assignedToId: "rm-1", currentStageId: "st-1", leadSource: "Meta Ads", campaign: "Retirement Planning" });
    const finishedAt = leadIntake.update.mock.invocationCallOrder[0];
    expect(finishedAt).toBeLessThan(alertNewLead.mock.invocationCallOrder[0]);
  });

  it("a returning person (duplicate) sends no alert", async () => {
    resolveInboundClient.mockResolvedValue({ client: { id: "cl_old", assignedToId: "rm-1", name: "Meera Iyer", currentStageId: "st-1" }, isNew: false, returnedLead: false });
    expect((await processLead("ledger-2", base)).status).toBe("duplicate");
    expect(alertNewLead).not.toHaveBeenCalled();
  });

  it("a rejected alert never fails or loses the lead", async () => {
    alertNewLead.mockRejectedValue(new Error("boom"));
    expect(await processLead("ledger-3", base)).toEqual({ status: "created", clientId: "cl_new" });
    await new Promise((r) => setTimeout(r, 0));
    expect(leadIntake.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CREATED", clientId: "cl_new" }) }));
  });

  it("a replayed submission (same source and externalId) returns the stored outcome and sends no second alert", async () => {
    leadIntake.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }));
    // First lookup is the erased-person check (none), second is the existing ledger row.
    leadIntake.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "ledger-1", status: "CREATED", clientId: "cl_new" });
    expect(await ingestLead(base, {})).toEqual({ status: "replay", clientId: "cl_new", previous: "CREATED" });
    expect(resolveInboundClient).not.toHaveBeenCalled();
    expect(alertNewLead).not.toHaveBeenCalled();
  });
});
