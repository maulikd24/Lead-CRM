import { beforeEach, describe, expect, it, vi } from "vitest";

const leadIntake = { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { leadIntake: { findUnique: (a: unknown) => leadIntake.findUnique(a), create: (a: unknown) => leadIntake.create(a), update: (a: unknown) => leadIntake.update(a) }, notification: { create: vi.fn() } } }));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: vi.fn() }));
const resolveInboundClient = vi.fn();
vi.mock("@/lib/clients/inbound-contact", () => ({ resolveInboundClient: (a: unknown) => resolveInboundClient(a) }));
vi.mock("@/lib/stage-engine/create-task-if-not-exists", () => ({ createTaskIfNotExists: vi.fn() }));
const record = vi.fn();
vi.mock("@/lib/partners/referral/record", () => ({ recordReferralTouch: (...a: unknown[]) => record(...a) }));
const loadSettings = vi.fn();
vi.mock("@/lib/partners/settings", () => ({ loadWorkspaceSettings: (...a: unknown[]) => loadSettings(...a) }));

import { APP_SIGNUP_SOURCE } from "@/lib/integrations/clevertap/identity";
import { processLead } from "./ingest";

const base = { source: "web", externalId: "s-1", leadSource: "Website/Blog Post", name: "A B", phone: "9876501234" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PARTNER_WORKSPACE_ENABLED = "1";
  leadIntake.update.mockResolvedValue({});
  resolveInboundClient.mockResolvedValue({ client: { id: "client-1", assignedToId: null, name: "A B" }, isNew: true, returnedLead: false });
  loadSettings.mockResolvedValue({ referral: { linkBase: null, lapseDays: 45 } });
  record.mockResolvedValue({ decision: "recorded" });
});

describe("processLead and referral codes", () => {
  it("records the partner code against the resolved client, with the configured lapse window and the source", async () => {
    const r = await processLead("ledger-1", { ...base, partnerCode: "PTR-00001" });
    expect(r).toEqual({ status: "created", clientId: "client-1" });
    expect(record).toHaveBeenCalledWith(expect.anything(), { clientId: "client-1", rawCode: "PTR-00001", source: "web", lapseDays: 45 });
  });
  it("tells the app signup apart from the web form", async () => {
    await processLead("ledger-1", { ...base, source: APP_SIGNUP_SOURCE, partnerCode: "PTR-00001" });
    expect(record.mock.calls[0][1]).toMatchObject({ source: "app" });
  });
  it("writes nothing and reads nothing while the partner workspace flag is off (the shipping default)", async () => {
    delete process.env.PARTNER_WORKSPACE_ENABLED;
    const r = await processLead("ledger-1", { ...base, partnerCode: "PTR-00001" });
    expect(r).toEqual({ status: "created", clientId: "client-1" });
    expect(record).not.toHaveBeenCalled();
    expect(loadSettings).not.toHaveBeenCalled();
  });
  it("does nothing without a code, and does not even read the settings", async () => {
    await processLead("ledger-1", base);
    expect(record).not.toHaveBeenCalled();
    expect(loadSettings).not.toHaveBeenCalled();
  });
  it("also applies to a returning person: their first touch may still be unset", async () => {
    resolveInboundClient.mockResolvedValue({ client: { id: "client-9", assignedToId: null, name: "A B" }, isNew: false, returnedLead: false });
    const r = await processLead("ledger-1", { ...base, partnerCode: "PTR-00001" });
    expect(r.status).toBe("duplicate");
    expect(record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientId: "client-9" }));
  });
  it("a failure in attribution never fails or loses the lead", async () => {
    record.mockRejectedValue(new Error("boom"));
    const r = await processLead("ledger-1", { ...base, partnerCode: "PTR-00001" });
    expect(r).toEqual({ status: "created", clientId: "client-1" });
  });
});
