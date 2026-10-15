import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkConsent, type EnforceDeps } from "@/lib/consent/enforce";
import { resolvePolicy } from "@/lib/consent/policy";
import { whatsappMetaAdapter } from "@/lib/messaging/adapters/whatsapp-meta";
import { approveProposal, type DecideDeps, type StoredProposal } from "./decide";
import { businessNudgeDeps, businessNudgeEnabled, NudgeNotSentError, sendApprovedNudge, type BusinessNudgeDeps } from "./business-nudge";

const fake = vi.hoisted(() => ({
  client: { findUniqueOrThrow: vi.fn() },
  messageTemplate: { findFirst: vi.fn(), findUnique: vi.fn() },
  message: { create: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: fake, basePrisma: fake }));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: vi.fn(async () => undefined) }));
// The real messaging send path, with the Meta adapter as its channel adapter (transport is stubbed with fetch below).
vi.mock("@/lib/messaging/registry", () => ({
  getMessagingAdapter: async () => whatsappMetaAdapter,
  messagingProviderKeyFor: () => "whatsapp_meta",
}));

const DRAFT_TEXT = "Hi Asha, this free text should never leave the building.";

function briefing(over: { programme?: string; topic?: string | null; situations?: string[]; name?: string } = {}) {
  return {
    customer: { name: over.name ?? "Asha Rao", preferredLanguage: "en" },
    whyContactingNow: { programme: over.programme ?? "Complete KYC", topic: over.topic ?? null, reason: "free text reason" },
    currentSituations: (over.situations ?? []).map((key) => ({ key })),
    openIssues: [],
    mustNotDiscuss: [],
  } as never;
}

function consentFrom(rows: { purpose: string; channel: string | null; status: string }[]) {
  const deps: EnforceDeps = {
    enforced: () => true,
    load: async (ids) => new Map(ids.map((id) => [id, { records: rows.map((r) => ({ ...r, capturedAt: new Date("2026-01-01T00:00:00Z") })), legacyMarketingConsentAt: null }])),
    now: () => new Date("2026-10-14T10:00:00Z"),
    policy: () => resolvePolicy({}),
  };
  return async (clientId: string) => {
    const d = await checkConsent(clientId, "MARKETING_COMMS", "whatsapp", deps);
    return { allowed: d.allowed, reason: d.reason };
  };
}

function deps(over: Partial<BusinessNudgeDeps> = {}): BusinessNudgeDeps {
  return {
    enabled: () => true,
    briefing: async () => briefing({ situations: [] }),
    consent: async () => ({ allowed: true, reason: "GRANTED" }),
    findApprovedTemplate: async () => ({ id: "t1" }),
    sendTemplate: vi.fn(async () => ({ id: "m1" })),
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.42" }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await whatsappMetaAdapter.configure({ phoneNumberId: "PHONE1", accessToken: "TOKEN", appSecret: "APPSECRET" }, {});
  fake.client.findUniqueOrThrow.mockResolvedValue({ id: "c1", mobile: "919999999999" });
  fake.messageTemplate.findUnique.mockResolvedValue({ id: "t1", body: "Hi {{firstName}}, shall we finish your KYC?", externalId: "allvest_nudge_kyc_pending", approved: true });
  fake.message.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "m1", ...data }));
  fake.message.update.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("business nudge send", () => {
  it("sends an approved template once through the Cloud API adapter, with the template name and the first name only", async () => {
    // Production wiring for every step except consent (a GRANTED marketing record here): the real template lookup and the real
    // sendMessage path. The stubbed fetch below is the Cloud API transport.
    fake.messageTemplate.findFirst.mockResolvedValue({ id: "t1" });
    const real = businessNudgeDeps(async () => briefing({ programme: "Complete KYC", topic: null }));
    const d = deps({
      briefing: real.briefing,
      findApprovedTemplate: real.findApprovedTemplate,
      sendTemplate: real.sendTemplate,
      consent: consentFrom([{ purpose: "MARKETING_COMMS", channel: "whatsapp", status: "GRANTED" }]),
    });

    const out = await sendApprovedNudge({ clientId: "c1", programme: "Complete KYC", senderUserId: "rm1" }, d);

    expect(out).toEqual({ messageId: "m1", templateName: "allvest_nudge_kyc_pending" });
    expect(fake.messageTemplate.findFirst).toHaveBeenCalledWith({ where: { channel: "whatsapp", externalId: "allvest_nudge_kyc_pending", approved: true }, select: { id: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v20.0/PHONE1/messages");
    const sent = JSON.parse(String(init.body));
    expect(sent.type).toBe("template");
    expect(sent.template.name).toBe("allvest_nudge_kyc_pending");
    expect(sent.template.components[0].parameters).toEqual([{ type: "text", text: "Asha" }]);
    // Free text never reaches the Cloud API: the draft is not an input to the send at all.
    expect(String(init.body)).not.toContain("free text");
    expect(fake.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ provider: "whatsapp_meta", direction: "OUTBOUND", senderUserId: "rm1" }) }));
  });

  it("flag off: sends nothing and leaves the draft with the RM", async () => {
    const sendTemplate = vi.fn(async () => ({ id: "m1" }));
    await expect(sendApprovedNudge({ clientId: "c1", programme: "Complete KYC", senderUserId: "rm1" }, deps({ enabled: () => false, sendTemplate }))).rejects.toThrow(NudgeNotSentError);
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the flag is on only for the exact value 1", () => {
    expect(businessNudgeEnabled({})).toBe(false);
    expect(businessNudgeEnabled({ WA_BUSINESS_NUDGE_ENABLED: "true" })).toBe(false);
    expect(businessNudgeEnabled({ WA_BUSINESS_NUDGE_ENABLED: "1" })).toBe(true);
  });

  it("consent refusal: do-not-contact sends nothing, and so does a withdrawn marketing consent", async () => {
    const sendTemplate = vi.fn(async () => ({ id: "m1" }));

    const dnc = consentFrom([{ purpose: "DO_NOT_CONTACT", channel: null, status: "GRANTED" }]);
    await expect(sendApprovedNudge({ clientId: "c1", programme: "Complete KYC", senderUserId: "rm1" }, deps({ consent: dnc, sendTemplate }))).rejects.toThrow(/consent/);

    const withdrawn = consentFrom([
      { purpose: "MARKETING_COMMS", channel: "whatsapp", status: "GRANTED" },
      { purpose: "MARKETING_COMMS", channel: "whatsapp", status: "WITHDRAWN" },
    ]);
    await expect(sendApprovedNudge({ clientId: "c1", programme: "Complete KYC", senderUserId: "rm1" }, deps({ consent: withdrawn, sendTemplate }))).rejects.toThrow(/consent/);

    expect(sendTemplate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no template match: the nudge is not sent and stays a draft (the approval is released, nothing reaches the Cloud API)", async () => {
    const sendTemplate = vi.fn(async () => ({ id: "m1" }));
    // other_onboarding has no template in the registry: programme First transaction, no funded situation.
    const other = deps({ briefing: async () => briefing({ programme: "First transaction", situations: [] }), sendTemplate });
    await expect(sendApprovedNudge({ clientId: "c1", programme: "First transaction", senderUserId: "rm1" }, other)).rejects.toThrow(/no approved WhatsApp template/);

    // A registry entry whose template is not approved in the database is also a refusal.
    const unapproved = deps({ findApprovedTemplate: async () => null, sendTemplate });
    await expect(sendApprovedNudge({ clientId: "c1", programme: "Complete KYC", senderUserId: "rm1" }, unapproved)).rejects.toThrow(/no approved WhatsApp template/);

    expect(sendTemplate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("through the RM approval: a refused nudge releases the claim, so the draft is still a DRAFT and nothing is sent", async () => {
    const store: StoredProposal = { id: "p1", agentKey: "wa_nudger", clientId: "c1", assignedToId: "rm1", status: "DRAFT", body: DRAFT_TEXT, expiresAt: new Date("2026-10-20T00:00:00Z"), programme: "Complete KYC" };
    const sendTemplate = vi.fn(async () => ({ id: "m1" }));
    const nudge = deps({ briefing: async () => briefing({ programme: "Complete KYC", situations: [] }), findApprovedTemplate: async () => null, sendTemplate });
    const approval: DecideDeps = {
      load: async () => ({ ...store }),
      transition: async (_id, from, to, patch, opts) => {
        if (store.status !== from) return false;
        if (opts?.notExpiredAt && store.expiresAt.getTime() <= opts.notExpiredAt.getTime()) return false;
        Object.assign(store, patch ?? {}, { status: to });
        return true;
      },
      send: async ({ clientId, programme }) => ({ messageId: (await sendApprovedNudge({ clientId, programme, senderUserId: "rm1" }, nudge)).messageId }),
      now: () => new Date("2026-10-14T10:00:00Z"),
    };

    const result = await approveProposal(approval, { proposalId: "p1", user: { id: "rm1", role: "RM" } });

    expect(result.ok).toBe(false);
    expect(store.status).toBe("DRAFT");
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
