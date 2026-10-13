import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Graph call, the ledger and the ingest pipeline are replaced; this file checks the consent gate and the hand-off to ingest.
const ledger = new Map<string, { status: string; error?: string | null; rawPayload?: unknown }>();
const clients = new Map<string, string>(); // lead phone -> client id (the duplicate rule, simplified)

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    leadIntake: {
      findUnique: vi.fn(async ({ where }: { where: { source_externalId: { externalId: string } } }) => {
        const row = ledger.get(where.source_externalId.externalId);
        return row ? { ...row } : null;
      }),
      upsert: vi.fn(async ({ where, update, create }: { where: { source_externalId: { externalId: string } }; update: object; create: { externalId: string } & object }) => {
        const id = where.source_externalId.externalId;
        ledger.set(id, { ...(ledger.get(id) ?? {}), ...(ledger.has(id) ? update : create) } as never);
        return {};
      }),
    },
  },
}));
vi.mock("@/generated/prisma/client", () => ({ Prisma: {} }));
vi.mock("@/lib/leads/ingest", () => ({
  // Same externalId twice is a replay; the same phone under a new id is a duplicate of the existing client. Both are the ingest pipeline's rules.
  ingestLead: vi.fn(async (input: { externalId: string; phone?: string; consent?: { at: string } }) => {
    if (ledger.has(input.externalId) && ledger.get(input.externalId)?.status === "CREATED") return { status: "replay", previous: "CREATED" };
    const key = input.phone ?? "";
    if (clients.has(key)) return { status: "duplicate", clientId: clients.get(key)! };
    clients.set(key, `client-${clients.size + 1}`);
    ledger.set(input.externalId, { status: "CREATED" });
    return { status: "created", clientId: clients.get(key)! };
  }),
}));

import { ingestLead } from "@/lib/leads/ingest";
import { handleLeadgenChange, NO_CONSENT_REASON } from "./meta";

const PAGE_TOKEN = "PAGE-TOKEN-SECRET";
const graphLead = (id: string, consent: string | null, phone = "+919876543210") => ({
  id,
  platform: "fb",
  campaign_id: "C-123",
  campaign_name: "Broking Q4",
  field_data: [
    { name: "full_name", values: ["Priya Sample"] },
    { name: "phone_number", values: [phone] },
    ...(consent === null ? [] : [{ name: "consent", values: [consent] }]),
  ],
});

function stubGraph(lead: object) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(lead), { status: 200 })));
}

beforeEach(() => {
  ledger.clear();
  clients.clear();
  vi.mocked(ingestLead).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("consent gate", () => {
  it("refuses a lead whose form has no consent yes: nothing is created and the drop holds no personal data", async () => {
    stubGraph(graphLead("L-NO", "no"));
    const outcome = await handleLeadgenChange({ leadgen_id: "L-NO" }, PAGE_TOKEN);
    expect(outcome).toEqual({ status: "rejected", reason: NO_CONSENT_REASON });
    expect(ingestLead).not.toHaveBeenCalled();
    expect(ledger.get("L-NO")).toEqual(expect.objectContaining({ status: "REJECTED" }));
    expect(JSON.stringify([...ledger.entries()])).not.toMatch(/Priya|9876543210/);
  });

  it("refuses a lead with no consent field at all", async () => {
    stubGraph(graphLead("L-NONE", null));
    expect((await handleLeadgenChange({ leadgen_id: "L-NONE" }, PAGE_TOKEN)).status).toBe("rejected");
    expect(ingestLead).not.toHaveBeenCalled();
  });
});

describe("consented lead", () => {
  it("is created once, from the Meta source with the campaign and the consent time", async () => {
    stubGraph(graphLead("L-YES", "yes"));
    const outcome = await handleLeadgenChange({ leadgen_id: "L-YES" }, PAGE_TOKEN);
    expect(outcome).toEqual({ status: "created", clientId: "client-1" });
    const call = vi.mocked(ingestLead).mock.calls[0][0];
    expect(call).toEqual(expect.objectContaining({ source: "meta_leads", externalId: "L-YES", leadSource: "Meta Ads" }));
    expect(call.attribution).toEqual(expect.objectContaining({ campaign: "Broking Q4", campaign_id: "C-123" }));
    expect(call.consent?.at).toEqual(expect.any(String));
  });

  it("a replay of the same leadgen event does not create a second lead", async () => {
    stubGraph(graphLead("L-REPLAY", "yes"));
    await handleLeadgenChange({ leadgen_id: "L-REPLAY" }, PAGE_TOKEN);
    const again = await handleLeadgenChange({ leadgen_id: "L-REPLAY" }, PAGE_TOKEN);
    expect(again.status).toBe("replay");
    expect(clients.size).toBe(1);
  });

  it("the same person submitting a second form is a duplicate of the existing client, not a second client", async () => {
    stubGraph(graphLead("L-A", "yes"));
    await handleLeadgenChange({ leadgen_id: "L-A" }, PAGE_TOKEN);
    stubGraph(graphLead("L-B", "yes"));
    const second = await handleLeadgenChange({ leadgen_id: "L-B" }, PAGE_TOKEN);
    expect(second).toEqual({ status: "duplicate", clientId: "client-1" });
    expect(clients.size).toBe(1);
  });

  it("does not overwrite a ledger row that already holds a created lead when a no-consent event arrives later", async () => {
    ledger.set("L-DONE", { status: "CREATED" });
    stubGraph(graphLead("L-DONE", "no"));
    await handleLeadgenChange({ leadgen_id: "L-DONE" }, PAGE_TOKEN);
    expect(ledger.get("L-DONE")?.status).toBe("CREATED");
  });
});
